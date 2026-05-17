import { NAMESPACE } from '../definitions.js';
import { StatBlockParser } from '../modules/StatBlockParser.js';
import { ItemBuilder } from '../modules/ItemBuilder.js';

export class ImportItemWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-item',
    window: { title: 'Import Spells from D&D Beyond', resizable: true },
    position: { width: 480, height: 360 },
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
    return {};
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
    const raw = (this.element.querySelector('.bbp-paste-area') as HTMLTextAreaElement).value.trim();
    const campaignName =
      (this.element.querySelector('.bbp-folder-input') as HTMLInputElement).value.trim() ||
      'Imported';

    if (!raw) {
      return void ui.notifications?.warn(
        'Paste stat block HTML containing spellcasting sections first.',
      );
    }

    this._setStatus('Parsing…');
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const statBlocks = StatBlockParser.extractAll(doc);
      if (statBlocks.length === 0) {
        return void this._setStatus('No stat blocks found in the pasted HTML.');
      }

      this._setStatus('Importing spells…');
      const { found, created } = await ItemBuilder.importSpellsFromDoc(doc, campaignName);

      const total = found + created;
      if (total === 0) {
        this._setStatus('No spellcasting sections found.');
      } else {
        const parts: string[] = [];
        if (found > 0) parts.push(`${found} from compendium`);
        if (created > 0) parts.push(`${created} created in Items → ${campaignName} → Spells`);
        this._setStatus(`Done — ${parts.join(', ')}.`);
      }
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
    }
  }
}
