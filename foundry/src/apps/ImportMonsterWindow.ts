import { NAMESPACE, SETTINGS } from '../definitions.js';
import { BeyondFetcher } from '../modules/BeyondFetcher.js';
import { StatBlockParser } from '../modules/StatBlockParser.js';
import { NpcBuilder } from '../modules/NpcBuilder.js';
import { AiLookup } from '../modules/AiLookup.js';
import { estimateCost } from '../modules/AiCostEstimate.js';
import type { AiStats } from '../modules/CompendiumLookup.js';

export class ImportMonsterWindow extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-beyond-monster',
    window: { title: 'Import Monster from D&D Beyond', resizable: true },
    position: { width: 520, height: 240 },
    actions: {
      create: ImportMonsterWindow._onCreate,
    },
  };

  static PARTS = {
    main: { template: `modules/${NAMESPACE}/templates/import-monster-window.hbs` },
  };

  private static _instance: ImportMonsterWindow | null = null;

  static open(): void {
    if (!ImportMonsterWindow._instance) {
      ImportMonsterWindow._instance = new ImportMonsterWindow();
    }
    void ImportMonsterWindow._instance.render({ force: true });
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
    const aiCost = aiEnabled ? estimateCost(1) : null;
    return { proxyUrl, proxyAvailable, aiCost };
  }

  async close(options?: object): Promise<this> {
    ImportMonsterWindow._instance = null;
    return super.close(options);
  }

  private _setStatus(msg: string): void {
    const el = this.element?.querySelector('.bbp-status');
    if (el) el.textContent = msg;
  }

  static async _onCreate(this: ImportMonsterWindow): Promise<void> {
    const url =
      (this.element.querySelector('.bbp-url-input') as HTMLInputElement | null)?.value.trim() ?? '';

    if (!url) {
      return void ui.notifications?.warn('Enter a D&D Beyond monster URL first.');
    }

    this._setStatus('Fetching…');
    try {
      const html = await BeyondFetcher.fetchPage(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const statBlocks = StatBlockParser.extractAll(doc);
      if (statBlocks.length === 0) {
        return void this._setStatus('No stat blocks found.');
      }
      this._setStatus(`Creating ${statBlocks.length} actor(s)…`);
      const totals: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };
      for (const sb of statBlocks) {
        const { aiStats } = await NpcBuilder.createSingle(sb, doc);
        totals.calls += aiStats.calls;
        totals.match += aiStats.match;
        totals.patch += aiStats.patch;
        totals.iconSuggest += aiStats.iconSuggest;
        totals.iconMiss += aiStats.iconMiss;
      }
      const iconPart = (totals.iconSuggest + totals.iconMiss) > 0
        ? `, ${totals.iconSuggest} icon hit(s), ${totals.iconMiss} icon miss(es)`
        : '';
      const aiPart = totals.calls > 0
        ? ` | AI: ${totals.calls} calls, ${totals.match} match, ${totals.patch} patched${iconPart}`
        : '';
      this._setStatus(`Done — created ${statBlocks.length} actor(s)${aiPart}.`);
    } catch (err: any) {
      this._setStatus(`Error: ${err.message}`);
    }
  }
}
