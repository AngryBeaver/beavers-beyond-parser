import { ParsedChapter, ParsedStatBlock, ProgressFn } from '../../types.js';
import { BeyondFetcher } from '../BeyondFetcher.js';
import { ItemBuilder } from '../ItemBuilder.js';
import { AiStats } from '../CompendiumLookup.js';
import { buildActorData, findInPacks, findOrCreateDndBeyondActorFolder } from './actorBuilder.js';
import { IMonsterParser } from './parsers/IMonsterParser.js';
import { LegacyMonsterParser } from './parsers/LegacyMonsterParser.js';
import { Modern2024MonsterParser } from './parsers/Modern2024MonsterParser.js';
import { StatBlockParser, buildStatBlockHtml } from '../StatBlockParser.js';
import { ImageStore, monsterEntity } from '../ImageStore.js';

const PARSERS: IMonsterParser[] = [new Modern2024MonsterParser(), new LegacyMonsterParser()];

function getParser(html: string): IMonsterParser {
  return (
    PARSERS.find((p) => p.canHandle(html)) ?? {
      canHandle: () => true,
      extractAll: (doc: Document) => StatBlockParser.extractAll(doc),
    }
  );
}

/**
 * Copy the monster's portrait into local storage and point the stat block at the copy.
 * The actor image doubles as its token texture, which the canvas can only load from a
 * same-origin (local) file.
 */
async function localizeImages(sb: ParsedStatBlock, hrefOrUrl: string): Promise<void> {
  if (!sb.imageUrl) return;
  sb.imageUrl = await ImageStore.store(monsterEntity(hrefOrUrl, sb.name), 'portrait', sb.imageUrl);
  sb.cleanHtml = buildStatBlockHtml(sb);
}

export class NpcBuilder {
  /**
   * Build all NPCs for an adventure.
   * For each unique /monsters/ path found in chapter stat-block refs and page
   * links: check configured compendium packs first (first match wins); if not
   * found, fetch the canonical monster page, parse it, and create an Actor in
   * the "dndbeyond" folder.
   * Phase 1: import every spell referenced across fetched stat blocks.
   * Phase 2: create Actor documents.
   * Returns both UUID maps so callers can rewrite journal + spell links.
   */
  static async build(
    chapters: ParsedChapter[],
    onProgress?: ProgressFn,
  ): Promise<{
    monsterPathToActorId: Map<string, string>;
    spellNameToItemId: Map<string, string>;
    aiStats: AiStats;
    actorsCreated: number;
  }> {
    const monsterPathToActorId = new Map<string, string>();
    const emptySpellMap = new Map<string, string>();
    const aiStats: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };

    const monsterRefMap = new Map<string, string>();

    for (const chapter of chapters) {
      for (const ref of chapter.statBlocks) {
        if (ref.monsterHref && !monsterRefMap.has(ref.monsterHref)) {
          monsterRefMap.set(ref.monsterHref, ref.name);
        }
      }
      for (const page of chapter.pages) {
        const pageDoc = new DOMParser().parseFromString(page.content, 'text/html');
        for (const a of Array.from(pageDoc.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).getAttribute('href') ?? '';
          let pathname: string;
          try {
            pathname = href.startsWith('http') ? new URL(href).pathname : href.split('#')[0];
          } catch {
            continue;
          }
          if (!pathname.startsWith('/monsters/') || monsterRefMap.has(pathname)) continue;
          const slug = pathname.split('/').filter(Boolean).pop() ?? '';
          const name = slug
            .replace(/^\d+-/, '')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
          if (name) monsterRefMap.set(pathname, name);
        }
      }
    }

    if (monsterRefMap.size === 0) {
      return { monsterPathToActorId, spellNameToItemId: emptySpellMap, aiStats, actorsCreated: 0 };
    }

    const dndBeyondFolderId = await findOrCreateDndBeyondActorFolder();
    const pendingCreations: Array<{ originalHref: string; sb: ParsedStatBlock }> = [];

    // Looking the monsters up is the first fifth of this step, building them the rest.
    let looked = 0;
    for (const [monsterHref, name] of monsterRefMap) {
      onProgress?.(
        `Building actors: ${name}: checking packs…`,
        (looked++ / monsterRefMap.size) * 0.2,
      );
      const packUuid = await findInPacks(name);
      if (packUuid) {
        monsterPathToActorId.set(monsterHref, packUuid);
        continue;
      }

      onProgress?.(`Building actors: ${name}: get StatBlock…`);
      try {
        const html = await BeyondFetcher.fetchPage(`https://www.dndbeyond.com${monsterHref}`);
        const parser = getParser(html);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const statBlocks = parser.extractAll(doc);
        if (statBlocks.length > 0) {
          pendingCreations.push({ originalHref: monsterHref, sb: statBlocks[0] });
        }
      } catch (err: any) {
        ui.notifications?.warn(`Could not fetch monster "${name}": ${err.message}`);
      }
    }

    if (pendingCreations.length === 0 && monsterPathToActorId.size === 0) {
      return { monsterPathToActorId, spellNameToItemId: emptySpellMap, aiStats, actorsCreated: 0 };
    }

    const { spellNameToItemId } = await ItemBuilder.importAllSpells(
      pendingCreations.map((p) => p.sb),
    );

    const totalActors = pendingCreations.length;
    for (let i = 0; i < totalActors; i++) {
      const { originalHref, sb } = pendingCreations[i];
      const fraction = 0.2 + (i / totalActors) * 0.8;
      const itemProgress = onProgress ? (msg: string) => onProgress(msg, fraction) : undefined;
      onProgress?.(`Building actors: ${sb.name}…`, fraction);
      await localizeImages(sb, originalHref);
      const actor = (await Actor.create(
        (await buildActorData(
          sb,
          dndBeyondFolderId,
          spellNameToItemId,
          itemProgress,
          aiStats,
        )) as any,
      )) as Actor | null | undefined;
      if (actor?.id) {
        monsterPathToActorId.set(originalHref, `Actor.${actor.id}`);
      }
    }

    return {
      monsterPathToActorId,
      spellNameToItemId,
      aiStats,
      actorsCreated: pendingCreations.length,
    };
  }

  /**
   * Fetch a D&D Beyond monster URL, parse the stat block, build actor data,
   * and return it WITHOUT creating any Foundry document.  Used by the external
   * validation tooling to compare parsed output against compendium reference data.
   */
  static async previewMonsterImport(
    url: string,
    { skipAi = false }: { skipAi?: boolean } = {},
  ): Promise<{
    actorData: Record<string, unknown>;
    name: string;
    aiStats: AiStats;
    /** Time spent building the actor (parsing, compendium lookup, AI), without the page fetch. */
    buildMs: number;
  } | null> {
    try {
      const html = await BeyondFetcher.fetchPage(url);
      const parser = getParser(html);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const statBlocks = parser.extractAll(doc);
      if (statBlocks.length === 0) return null;
      const sb = statBlocks[0];
      const aiStats: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };
      const started = performance.now();
      const actorData = await buildActorData(sb, null, new Map(), undefined, aiStats, skipAi);
      return {
        actorData,
        name: sb.name,
        aiStats,
        buildMs: Math.round(performance.now() - started),
      };
    } catch (err: unknown) {
      console.warn('[bbp] previewMonsterImport failed:', (err as Error)?.message);
      return null;
    }
  }

  /** `sourceUrl` is the monster page the stat block came from; it identifies the entity for image storage. */
  static async createSingle(
    sb: ParsedStatBlock,
    doc?: Document,
    sourceUrl = '',
  ): Promise<{ aiStats: AiStats }> {
    const aiStats: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };
    const folderId = await findOrCreateDndBeyondActorFolder();
    await localizeImages(sb, sb.monsterHref || sourceUrl);
    const { spellNameToItemId } = await ItemBuilder.importAllSpells([sb], doc);
    const actor = (await Actor.create(
      (await buildActorData(sb, folderId, spellNameToItemId, undefined, aiStats)) as any,
    )) as Actor | null | undefined;
    if (actor) {
      ui.notifications?.info(`Created NPC "${sb.name}".`);
    }
    return { aiStats };
  }
}
