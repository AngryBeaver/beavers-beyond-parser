import { NAMESPACE, SETTINGS } from '../definitions.js';
import { BeyondFetcher } from '../modules/BeyondFetcher.js';
import { BeyondParser } from '../modules/BeyondParser.js';
import { JournalBuilder } from '../modules/JournalBuilder.js';
import { NpcBuilder } from '../modules/NpcBuilder.js';
import { ParsedAdventure, ParsedChapter } from '../types.js';

export class ImportAdventureWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-parser',
    window: { title: "Beaver's Beyond Parser", resizable: true },
    position: { width: 660, height: 640 },
    actions: {
      fetch: ImportAdventureWindow._onFetch,
      parsePaste: ImportAdventureWindow._onParsePaste,
      addChapter: ImportAdventureWindow._onAddChapter,
      import: ImportAdventureWindow._onImport,
    },
  };

  static PARTS = {
    main: { template: `modules/${NAMESPACE}/templates/import-adventure-window.hbs` },
  };

  private static _instance: ImportAdventureWindow | null = null;
  private _adventure: ParsedAdventure | null = null;
  private _chapters = new Map<string, ParsedChapter>();

  static open(): void {
    if (!ImportAdventureWindow._instance) {
      ImportAdventureWindow._instance = new ImportAdventureWindow();
    }
    void ImportAdventureWindow._instance.render({ force: true });
  }

  async _prepareContext(_options: object): Promise<object> {
    const proxyUrl = game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '';
    const chapterStatuses =
      this._adventure?.chapterStubs.map((stub) => ({
        title: stub.title,
        url: stub.url,
        done: this._chapters.has(urlSlug(stub.url)),
      })) ?? [];

    return {
      proxyUrl,
      adventure: this._adventure,
      chapterStatuses,
    };
  }

  async close(options?: object): Promise<this> {
    ImportAdventureWindow._instance = null;
    return super.close(options);
  }

  private _setStatus(msg: string): void {
    const el = this.element?.querySelector('.bbp-status');
    if (el) el.textContent = msg;
  }

  static async _onFetch(this: ImportAdventureWindow): Promise<void> {
    const url = (this.element.querySelector('.bbp-url-input') as HTMLInputElement).value.trim();
    if (!url) return void ui.notifications?.warn('Enter a D&D Beyond URL first.');
    this._setStatus('Fetching…');
    try {
      const html = await BeyondFetcher.fetchPage(url);
      this._adventure = BeyondParser.parseToc(html, url);
      this._chapters.clear();
      this._setStatus(
        `Found "${this._adventure.title}" — ${this._adventure.chapterStubs.length} chapter(s)`,
      );
      await this.render();
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
    }
  }

  static _onParsePaste(this: ImportAdventureWindow): void {
    const raw = (this.element.querySelector('.bbp-paste-area') as HTMLTextAreaElement).value.trim();
    const url =
      (this.element.querySelector('.bbp-url-input') as HTMLInputElement).value.trim() || 'pasted';
    if (!raw) return void ui.notifications?.warn('Paste HTML first.');
    this._adventure = BeyondParser.parseToc(raw, url);
    this._chapters.clear();
    this._setStatus(
      `Found "${this._adventure.title}" — ${this._adventure.chapterStubs.length} chapter(s)`,
    );
    void this.render();
  }

  static _onAddChapter(this: ImportAdventureWindow): void {
    const raw = (
      this.element.querySelector('.bbp-chapter-paste') as HTMLTextAreaElement
    ).value.trim();
    if (!raw) return void ui.notifications?.warn('Paste chapter HTML first.');
    const chapter = BeyondParser.parseChapter(raw);
    if (!chapter.title)
      return void ui.notifications?.warn('No chapter title found in pasted HTML.');
    this._chapters.set(chapter.slug, chapter);
    this._setStatus(`Added "${chapter.title}" — ${this._chapters.size} chapter(s) ready`);
    (this.element.querySelector('.bbp-chapter-paste') as HTMLTextAreaElement).value = '';
    void this.render();
  }

  static async _onImport(this: ImportAdventureWindow): Promise<void> {
    if (!this._adventure) return void ui.notifications?.warn('Parse the TOC first.');
    const proxyUrl = (game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '').replace(/\/$/, '');

    const chapters: ParsedChapter[] = [];
    for (const stub of this._adventure.chapterStubs) {
      const slug = urlSlug(stub.url);
      if (this._chapters.has(slug)) {
        chapters.push(this._chapters.get(slug)!);
      } else if (proxyUrl) {
        this._setStatus(`Fetching: ${stub.title}…`);
        try {
          const html = await BeyondFetcher.fetchPage(stub.url);
          chapters.push(BeyondParser.parseChapter(html));
        } catch (err: any) {
          ui.notifications?.warn(`Skipped "${stub.title}": ${err.message}`);
        }
      }
    }

    if (chapters.length === 0) {
      return void ui.notifications?.warn(
        'No chapters to import. Add chapters manually or configure the proxy.',
      );
    }

    this._setStatus('Building actors…');
    try {
      const monsterPathToActorId = await NpcBuilder.build(this._adventure.title, chapters);
      this._setStatus('Building journals…');
      await JournalBuilder.build(this._adventure.title, chapters, monsterPathToActorId);
      await this.close();
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
      ui.notifications?.error(`Import failed: ${err.message}`);
    }
  }
}

function urlSlug(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? '';
}
