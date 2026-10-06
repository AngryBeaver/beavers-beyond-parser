import { NAMESPACE, SETTINGS } from '../definitions.js';
import { importAdventure } from '../modules/AdventureImporter.js';
import { AiLookup } from '../modules/AiLookup.js';
import { estimateCost } from '../modules/AiCostEstimate.js';

export class ImportAdventureWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-parser',
    window: { title: 'Import Adventures from D&D Beyond', resizable: true },
    position: { width: 480, height: 460 },
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

  private _importing = false;

  /** While an import runs the button is replaced by a progress bar, so it cannot be started twice. */
  private _setImporting(importing: boolean): void {
    this._importing = importing;
    const root = this.element as HTMLElement | undefined;
    root
      ?.querySelector<HTMLElement>('[data-action="import"]')
      ?.toggleAttribute('hidden', importing);
    root?.querySelector<HTMLElement>('.bbp-progress')?.toggleAttribute('hidden', !importing);
    const input = root?.querySelector<HTMLInputElement>('.bbp-url-input');
    if (input) input.disabled = importing;
    if (importing) this._setProgress(0);
  }

  private _setProgress(fraction: number): void {
    const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
    const root = this.element as HTMLElement | undefined;
    const bar = root?.querySelector<HTMLProgressElement>('.bbp-progress progress');
    if (bar) bar.value = pct;
    const label = root?.querySelector('.bbp-progress-pct');
    if (label) label.textContent = `${pct}%`;
  }

  private _setStatus(msg: string): void {
    const el = this.element?.querySelector('.bbp-status');
    if (el) el.textContent = msg;
  }

  static async _onImport(this: ImportAdventureWindow): Promise<void> {
    const url = (this.element.querySelector('.bbp-url-input') as HTMLInputElement).value.trim();
    if (!url) return void ui.notifications?.warn('Enter a D&D Beyond adventure URL first.');

    if (this._importing) return;
    this._setImporting(true);
    try {
      const { chapters, journals, pages, actorsCreated, aiStats } = await importAdventure(url, {
        onProgress: (msg, fraction) => {
          this._setStatus(msg);
          if (fraction !== undefined) this._setProgress(fraction);
        },
      });

      const iconPart =
        aiStats.iconSuggest + aiStats.iconMiss > 0
          ? `, ${aiStats.iconSuggest} icon hit(s), ${aiStats.iconMiss} icon miss(es)`
          : '';
      const aiPart =
        aiStats.calls > 0
          ? ` | AI: ${aiStats.calls} calls, ${aiStats.match} semantic match, ${aiStats.patch} patched${iconPart}`
          : '';
      this._setStatus(
        `Done — ${chapters} chapter(s), ${journals} journal(s), ${pages} page(s), ${actorsCreated} actor(s)${aiPart}.`,
      );
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
      ui.notifications?.error(`Import failed: ${err.message}`);
    } finally {
      this._setImporting(false);
    }
  }
}
