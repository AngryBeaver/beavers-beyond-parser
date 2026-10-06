import { ParsedChapter, ProgressFn } from '../types.js';
import { BeyondFetcher } from './BeyondFetcher.js';
import { BeyondParser } from './BeyondParser.js';
import { ItemBuilder } from './ItemBuilder.js';
import { JournalBuilder } from './JournalBuilder.js';
import { NpcBuilder } from './monsterBuilder/index.js';
import { sourceEntity } from './ImageStore.js';
import { setImportLabel } from './ImportFolders.js';
import type { AiStats } from './CompendiumLookup.js';

export interface AdventureImportOptions {
  /** File this import under its own `dndbeyond/<label>/…` folders, separate from other imports. */
  label?: string;
  /** Import only the first N chapters (for test runs). */
  maxChapters?: number;
  /** `fraction` is the progress of the whole import, 0–1. */
  onProgress?: ProgressFn;
}

export interface AdventureImportResult {
  title: string;
  chapters: number;
  skippedChapters: string[];
  journals: number;
  pages: number;
  actorsCreated: number;
  aiStats: AiStats;
  /** Seconds spent per phase. */
  seconds: { fetch: number; actors: number; spells: number; journals: number; total: number };
}

/** Import a D&D Beyond adventure: actors and spells first, then the journals linking to them. */
export async function importAdventure(
  url: string,
  { label = '', maxChapters, onProgress: report }: AdventureImportOptions = {},
): Promise<AdventureImportResult> {
  // Each step reports its own 0–1 progress; map it onto that step's share of the whole import.
  // Building the actors dominates, above all with AI support.
  let overall = 0;
  let onProgress: ProgressFn | undefined;
  const step = (from: number, to: number): void => {
    overall = from;
    onProgress = report
      ? (msg, fraction) => {
          if (fraction !== undefined) overall = from + (to - from) * Math.min(1, fraction);
          report(msg, overall);
        }
      : undefined;
  };
  step(0, 0.05);

  const started = performance.now();
  let mark = started;
  const lap = (): number => {
    const now = performance.now();
    const seconds = Math.round((now - mark) / 100) / 10;
    mark = now;
    return seconds;
  };

  setImportLabel(label);
  try {
    onProgress?.('Fetching adventure…');
    const adventure = BeyondParser.parseToc(await BeyondFetcher.fetchPage(url), url);
    const stubs = adventure.chapterStubs.slice(0, maxChapters ?? adventure.chapterStubs.length);
    onProgress?.(`Found "${adventure.title}" — fetching ${stubs.length} chapter(s)…`);

    const chapters: ParsedChapter[] = [];
    const skippedChapters: string[] = [];
    for (const [i, stub] of stubs.entries()) {
      onProgress?.(`Fetching: ${stub.title}…`, i / stubs.length);
      try {
        chapters.push(BeyondParser.parseChapter(await BeyondFetcher.fetchPage(stub.url)));
      } catch (err: any) {
        skippedChapters.push(stub.title);
        ui.notifications?.warn(`Skipped "${stub.title}": ${err.message}`);
      }
    }
    if (chapters.length === 0) throw new Error('No chapters fetched.');
    const fetch = lap();

    step(0.05, 0.88);
    onProgress?.('Building actors…');
    const { monsterPathToActorId, spellNameToItemId, aiStats, actorsCreated } =
      await NpcBuilder.build(chapters, onProgress);
    const actors = lap();

    step(0.88, 0.9);
    onProgress?.('Importing spells from journal links…');
    await ItemBuilder.importSpellsFromChapters(chapters, spellNameToItemId);
    const itemPathToUuid = await ItemBuilder.importItemLinks(chapters, onProgress);
    const spells = lap();

    step(0.9, 1);
    onProgress?.('Building journals…');
    const { journals, pages } = await JournalBuilder.build(
      adventure.title,
      chapters,
      monsterPathToActorId,
      spellNameToItemId,
      { itemPathToUuid, imageEntity: sourceEntity(url, adventure.title), onProgress },
    );

    return {
      title: adventure.title,
      chapters: chapters.length,
      skippedChapters,
      journals,
      pages,
      actorsCreated,
      aiStats,
      seconds: {
        fetch,
        actors,
        spells,
        journals: lap(),
        total: Math.round((performance.now() - started) / 100) / 10,
      },
    };
  } finally {
    setImportLabel('');
  }
}
