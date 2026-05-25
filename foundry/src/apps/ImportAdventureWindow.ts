import { NAMESPACE, SETTINGS } from '../definitions.js';
import { BeyondFetcher } from '../modules/BeyondFetcher.js';
import { BeyondParser } from '../modules/BeyondParser.js';
import { ItemBuilder } from '../modules/ItemBuilder.js';
import { JournalBuilder } from '../modules/JournalBuilder.js';
import { NpcBuilder } from '../modules/NpcBuilder.js';
import { ParsedChapter } from '../types.js';
import { AiLookup } from '../modules/AiLookup.js';
import { estimateCost } from '../modules/AiCostEstimate.js';

export class ImportAdventureWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-parser',
    window: { title: 'Import Adventures from D&D Beyond', resizable: true },
    position: { width: 480, height: 260 },
    actions: {
      import: ImportAdventureWindow._onImport,
    },
  };

  static PARTS = {
    main: { template: `modules/${NAMESPACE}/templates/import-adventure-window.hbs` },
  };

  private static _instance: ImportAdventureWindow | null = null;

  static open(): void {
    if (!ImportAdventureWindow._instance) {
      ImportAdventureWindow._instance = new ImportAdventureWindow();
    }
    void ImportAdventureWindow._instance.render({ force: true });
  }

  async _prepareContext(_options: object): Promise<object> {
    const proxyUrl = ((game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '') as string).replace(
      /\/$/,
      '',
    );

    let proxyAvailable = false;
    if (proxyUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
        proxyAvailable = resp.ok;
      } catch {
        proxyAvailable = false;
      } finally {
        clearTimeout(timeout);
      }
    }

    const aiEnabled = AiLookup.isAvailable() && AiLookup.isEnabled() && AiLookup.isConfigured();
    const aiCost = aiEnabled ? estimateCost(20, 50) : null;
    return { proxyUrl, proxyAvailable, aiCost };
  }

  async close(options?: object): Promise<this> {
    ImportAdventureWindow._instance = null;
    return super.close(options);
  }

  private _setStatus(msg: string): void {
    const el = this.element?.querySelector('.bbp-status');
    if (el) el.textContent = msg;
  }

  static async _onImport(this: ImportAdventureWindow): Promise<void> {
    const url = (this.element.querySelector('.bbp-url-input') as HTMLInputElement).value.trim();
    if (!url) return void ui.notifications?.warn('Enter a D&D Beyond adventure URL first.');

    this._setStatus('Fetching adventure…');
    try {
      const tocHtml = await BeyondFetcher.fetchPage(url);
      const adventure = BeyondParser.parseToc(tocHtml, url);
      this._setStatus(
        `Found "${adventure.title}" — fetching ${adventure.chapterStubs.length} chapter(s)…`,
      );

      const chapters: ParsedChapter[] = [];
      for (const stub of adventure.chapterStubs) {
        this._setStatus(`Fetching: ${stub.title}…`);
        try {
          const html = await BeyondFetcher.fetchPage(stub.url);
          chapters.push(BeyondParser.parseChapter(html));
        } catch (err: any) {
          ui.notifications?.warn(`Skipped "${stub.title}": ${err.message}`);
        }
      }

      if (chapters.length === 0) {
        return void this._setStatus('No chapters fetched.');
      }

      this._setStatus('Building actors…');
      const { monsterPathToActorId, spellNameToItemId } = await NpcBuilder.build(
        adventure.title,
        chapters,
      );
      this._setStatus('Importing spells from journal links…');
      await ItemBuilder.importSpellsFromChapters(chapters, spellNameToItemId);
      this._setStatus('Building journals…');
      await JournalBuilder.build(
        adventure.title,
        chapters,
        monsterPathToActorId,
        spellNameToItemId,
      );
      await this.close();
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
      ui.notifications?.error(`Import failed: ${err.message}`);
    }
  }
}
