import { NAMESPACE, SETTINGS } from '../definitions.js';
import { BeyondFetcher } from '../modules/BeyondFetcher.js';
import { StatBlockParser } from '../modules/StatBlockParser.js';
import { SpellParser } from '../modules/SpellParser.js';
import { ItemBuilder } from '../modules/ItemBuilder.js';

export class ImportItemWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-item',
    window: { title: 'Import Items from D&D Beyond', resizable: true },
    position: { width: 480, height: 420 },
    actions: {
      import: ImportItemWindow._onImport,
    },
  };

  static PARTS = {
    main: { template: `modules/${NAMESPACE}/templates/import-item-window.hbs` },
  };

  private static _instance: ImportItemWindow | null = null;

  static open(): void {
    if (!ImportItemWindow._instance) {
      ImportItemWindow._instance = new ImportItemWindow();
    }
    void ImportItemWindow._instance.render({ force: true });
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

    return { proxyUrl, proxyAvailable };
  }


  async close(options?: object): Promise<this> {
    ImportItemWindow._instance = null;
    return super.close(options);
  }

  private _setStatus(msg: string): void {
    const el = this.element?.querySelector('.bbp-status');
    if (el) el.textContent = msg;
  }

  static async _onImport(this: ImportItemWindow): Promise<void> {
    const url = (
      this.element.querySelector('.bbp-url-input') as HTMLInputElement
    ).value.trim();
    const raw = (
      this.element.querySelector('.bbp-paste-area') as HTMLTextAreaElement
    ).value.trim();

    if (!url && !raw) {
      return void ui.notifications?.warn(
        'Enter a D&D Beyond spell URL or paste stat block HTML first.',
      );
    }

    // ── URL mode ──────────────────────────────────────────────────────────────
    if (url) {
      this._setStatus('Importing spell…');
      try {
        const slug = url.split('/').filter(Boolean).pop() ?? '';
        const nameFromSlug = slug
          .replace(/^\d+-/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

        const proxyUrl = (
          (game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '') as string
        ).replace(/\/$/, '');

        let parsed = undefined;
        if (proxyUrl) {
          try {
            const html = await BeyondFetcher.fetchPage(url);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            parsed = SpellParser.parseSpellPage(doc, nameFromSlug);
          } catch {
            // proxy failed — fall back to compendium/stub
          }
        }

        const { id, isNew } = await ItemBuilder.importSpellByName(nameFromSlug, parsed);
        if (!id) {
          this._setStatus('Failed to import spell.');
        } else {
          this._setStatus(
            isNew
              ? `Done — "${nameFromSlug}" added to Items → dndBeyond → Spells.`
              : `"${nameFromSlug}" already exists — no duplicate created.`,
          );
        }
      } catch (err: any) {
        this._setStatus(`Error: ${err.message}`);
      }
      return;
    }

    // ── HTML paste mode ───────────────────────────────────────────────────────
    this._setStatus('Parsing…');
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const statBlocks = StatBlockParser.extractAll(doc);
      if (statBlocks.length === 0) {
        return void this._setStatus('No stat blocks found in the pasted HTML.');
      }

      this._setStatus('Importing spells…');
      const { created, reused } = await ItemBuilder.importSpellsFromDoc(doc);

      const total = created + reused;
      if (total === 0) {
        this._setStatus('No spellcasting sections found.');
      } else {
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} new spell(s) added to Items → dndBeyond → Spells`);
        if (reused > 0) parts.push(`${reused} already existed`);
        this._setStatus(`Done — ${parts.join(', ')}.`);
      }
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
    }
  }
}
