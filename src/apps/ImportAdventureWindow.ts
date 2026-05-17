import { NAMESPACE, SETTINGS } from '../definitions.js';
import { BeyondFetcher } from '../modules/BeyondFetcher.js';
import { BeyondParser } from '../modules/BeyondParser.js';
import { JournalBuilder } from '../modules/JournalBuilder.js';
import { ParsedAdventure } from '../types.js';

export class ImportAdventureWindow extends Application {
  private parsed: ParsedAdventure | null = null;

  static get defaultOptions(): ApplicationOptions {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'beavers-beyond-parser',
      title: "Beaver's Beyond Parser",
      template: 'modules/beavers-beyond-parser/templates/import-adventure-window.hbs',
      width: 660,
      height: 580,
      resizable: true,
    });
  }

  static open(): ImportAdventureWindow {
    const existing = Object.values(ui.windows).find((w) => w.id === 'beavers-beyond-parser');
    if (existing) {
      existing.bringToTop();
      return existing as ImportAdventureWindow;
    }
    const win = new ImportAdventureWindow();
    win.render(true);
    return win;
  }

  getData(): object {
    return {
      cobaltToken: game.settings.get(NAMESPACE, SETTINGS.COBALT_TOKEN) as string,
      parsed: this.parsed,
    };
  }

  activateListeners(html: JQuery): void {
    super.activateListeners(html);
    html.find('[data-action="save-token"]').on('click', () => this._onSaveToken(html));
    html.find('[data-action="fetch"]').on('click', () => this._onFetch(html));
    html.find('[data-action="parse-paste"]').on('click', () => this._onParsePaste(html));
    html.find('[data-action="import"]').on('click', () => this._onImport());
  }

  private async _onSaveToken(html: JQuery): Promise<void> {
    const token = html.find('.bbp-token-input').val() as string;
    await game.settings.set(NAMESPACE, SETTINGS.COBALT_TOKEN, token.trim());
    ui.notifications?.info('cobalt-token saved.');
  }

  private async _onFetch(html: JQuery): Promise<void> {
    const url = (html.find('.bbp-url-input').val() as string).trim();
    if (!url) return void ui.notifications?.warn('Enter a D&D Beyond URL first.');
    this._setStatus(html, 'Fetching page…');
    try {
      const pageHtml = await BeyondFetcher.fetchPage(url);
      this._loadParsed(html, BeyondParser.parse(pageHtml, url));
    } catch (err: any) {
      this._setStatus(html, `Error: ${err.message}`);
    }
  }

  private _onParsePaste(html: JQuery): void {
    const raw = (html.find('.bbp-paste-area').val() as string).trim();
    const url = (html.find('.bbp-url-input').val() as string).trim() || 'pasted';
    if (!raw) return void ui.notifications?.warn('Paste HTML content first.');
    this._loadParsed(html, BeyondParser.parse(raw, url));
  }

  private _loadParsed(html: JQuery, adventure: ParsedAdventure): void {
    this.parsed = adventure;
    this._setStatus(
      html,
      `Ready: "${adventure.title}" — ${adventure.chapters.length} chapter(s)`,
    );
    this.render();
  }

  private async _onImport(): Promise<void> {
    if (!this.parsed) return void ui.notifications?.warn('Nothing parsed yet.');
    try {
      await JournalBuilder.build(this.parsed);
      this.close();
    } catch (err: any) {
      ui.notifications?.error(`Import failed: ${err.message}`);
    }
  }

  private _setStatus(html: JQuery, msg: string): void {
    html.find('.bbp-status').text(msg);
  }
}
