import { ParsedSpell, ParsedStatBlock } from '../types.js';
import { StatBlockParser } from './StatBlockParser.js';

// ── Public API ────────────────────────────────────────────────────────────────

export class ItemBuilder {
  /**
   * Parse stat blocks from a document, extract all spellcasting entries,
   * and import each spell: compendium hit = no-op (already available),
   * miss = create a world item stub in "campaignName > Spells".
   * Returns counts for the status message.
   */
  static async importSpellsFromDoc(
    doc: Document,
    campaignName: string,
  ): Promise<{ found: number; created: number }> {
    const statBlocks = StatBlockParser.extractAll(doc);
    const spellData = StatBlockParser.extractSpellData(doc);
    const getSpellFolder = makeSpellFolderGetter(campaignName);
    return importSpellsFromStatBlocks(statBlocks, spellData, getSpellFolder);
  }

  /**
   * Resolve a spell name to actor-embeddable item data.
   * Looks up the compendium first; falls back to a world stub.
   * The returned object has no _id so Actor.create embeds it directly.
   */
  static async resolveSpellForActor(
    spellName: string,
    method: string,
    limit: number,
    spellData: Map<string, ParsedSpell>,
    getSpellFolder: () => Promise<string | null>,
  ): Promise<Record<string, unknown> | null> {
    return resolveSpell(spellName, method, limit, spellData, getSpellFolder);
  }

  /** Lazy folder getter — creates "campaignName > Spells" on first use. */
  static makeSpellFolderGetter = makeSpellFolderGetter;

  /** Parse "At will:" / "N/day each:" lines from plain text. */
  static parseSpellLists = parseSpellLists;
}

// ── Spell import (world items) ────────────────────────────────────────────────

async function importSpellsFromStatBlocks(
  statBlocks: ParsedStatBlock[],
  spellData: Map<string, ParsedSpell>,
  getSpellFolder: () => Promise<string | null>,
): Promise<{ found: number; created: number }> {
  const seen = new Set<string>();
  let found = 0;
  let created = 0;

  for (const sb of statBlocks) {
    for (const section of sb.sections) {
      for (const entryHtml of section.entries) {
        const scratch = new DOMParser().parseFromString(`<p>${entryHtml}</p>`, 'text/html');
        const text = scratch.body.textContent ?? '';
        const lists = parseSpellLists(text);

        for (const { spells } of lists) {
          for (const spellName of spells) {
            if (seen.has(spellName)) continue;
            seen.add(spellName);

            const inCompendium = await findSpellInCompendium(spellName);
            if (inCompendium) {
              found++;
            } else {
              const parsed = spellData.get(spellName.toLowerCase());
              const folderId = await getSpellFolder();
              await createWorldSpellItem(spellName, parsed, folderId);
              created++;
            }
          }
        }
      }
    }
  }

  return { found, created };
}

// ── Spell resolution (for actor embedding) ────────────────────────────────────

async function resolveSpell(
  spellName: string,
  method: string,
  limit: number,
  spellData: Map<string, ParsedSpell>,
  getSpellFolder: () => Promise<string | null>,
): Promise<Record<string, unknown> | null> {
  const compendiumData = await findSpellInCompendium(spellName);
  if (compendiumData) {
    return cloneSpellWithUsage(compendiumData, method, limit);
  }

  const parsed = spellData.get(spellName.toLowerCase());
  const folderId = await getSpellFolder();
  return getOrCreateWorldSpell(spellName, parsed, method, limit, folderId);
}

// ── Compendium lookup ─────────────────────────────────────────────────────────

async function findSpellInCompendium(name: string): Promise<Record<string, unknown> | null> {
  if (!(game.packs as any)?.contents) return null;
  const nameLower = name.toLowerCase();
  const PRIORITY = ['dnd5e.spells', 'dnd-players-handbook.spells'];

  const allPacks = (game.packs as any).contents as any[];
  const ordered: any[] = [
    ...PRIORITY.map((id) => (game.packs as any).get(id)).filter(Boolean),
    ...allPacks.filter((p: any) => p.documentName === 'Item' && !PRIORITY.includes(p.collection)),
  ];

  for (const pack of ordered) {
    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => e.name?.toLowerCase() === nameLower);
      if (!entry) continue;
      const doc = (await pack.getDocument(entry._id)) as any;
      if (doc?.type === 'spell') return doc.toObject();
    } catch {
      // skip broken/locked packs
    }
  }

  return null;
}

// ── Usage cloning ─────────────────────────────────────────────────────────────

function cloneSpellWithUsage(
  data: Record<string, unknown>,
  method: string,
  limit: number,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(data)) as any;
  delete cloned._id;
  cloned.system = cloned.system ?? {};
  cloned.system.method = method;
  if (limit > 0) {
    cloned.system.uses = {
      max: String(limit),
      spent: 0,
      recovery: [{ period: 'day', type: 'recoverAll' }],
    };
  } else {
    cloned.system.uses = { max: null, spent: 0, recovery: [] };
  }
  return cloned;
}

// ── World spell items ─────────────────────────────────────────────────────────

async function getOrCreateWorldSpell(
  name: string,
  parsed: ParsedSpell | undefined,
  method: string,
  limit: number,
  folderId: string | null,
): Promise<Record<string, unknown>> {
  const existing = folderId
    ? (game.items as any)?.find(
        (i: any) =>
          i.type === 'spell' &&
          i.name.toLowerCase() === name.toLowerCase() &&
          i.folder?.id === folderId,
      )
    : null;

  const worldData: Record<string, unknown> = existing
    ? (existing as any).toObject()
    : await createWorldSpellItem(name, parsed, folderId);

  const actorCopy = JSON.parse(JSON.stringify(worldData)) as any;
  delete actorCopy._id;
  actorCopy.folder = null;
  actorCopy.system = actorCopy.system ?? {};
  actorCopy.system.method = method;
  if (limit > 0) {
    actorCopy.system.uses = {
      max: String(limit),
      spent: 0,
      recovery: [{ period: 'day', type: 'recoverAll' }],
    };
  } else {
    actorCopy.system.uses = { max: null, spent: 0, recovery: [] };
  }
  return actorCopy;
}

async function createWorldSpellItem(
  name: string,
  parsed: ParsedSpell | undefined,
  folderId: string | null,
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    name,
    type: 'spell',
    folder: folderId,
    system: {
      level: parsed?.level ?? 0,
      school: parsed?.school ?? 'evo',
      method: 'innate',
      description: { value: parsed?.description ?? '' },
      activation: { type: 'action', value: 1 },
      ...(parsed?.components?.length ? { properties: parsed.components } : {}),
    },
  };
  try {
    const item = await (Item as any).create(data);
    return (item as any)?.toObject() ?? data;
  } catch {
    return data;
  }
}

// ── Spell folder management ───────────────────────────────────────────────────

function makeSpellFolderGetter(campaignName: string): () => Promise<string | null> {
  let folderId: string | null | undefined;
  return async () => {
    if (folderId !== undefined) return folderId;
    folderId = await getOrCreateSpellFolder(campaignName);
    return folderId;
  };
}

async function getOrCreateSpellFolder(campaignName: string): Promise<string | null> {
  try {
    let parent = (game.folders as any)?.find(
      (f: any) => f.type === 'Item' && f.name === campaignName && !f.folder,
    ) as any;
    if (!parent) {
      parent = await (Folder as any).create({ name: campaignName, type: 'Item' });
    }

    const parentId = parent?.id;
    let spellSub = (game.folders as any)?.find(
      (f: any) => f.type === 'Item' && f.name === 'Spells' && f.folder?.id === parentId,
    ) as any;
    if (!spellSub) {
      spellSub = await (Folder as any).create({
        name: 'Spells',
        type: 'Item',
        folder: parentId ?? null,
      });
    }

    return spellSub?.id ?? null;
  } catch {
    return null;
  }
}

// ── Spell list parsing ────────────────────────────────────────────────────────

function parseSpellLists(text: string): Array<{ method: string; limit: number; spells: string[] }> {
  const result: Array<{ method: string; limit: number; spells: string[] }> = [];

  for (const line of text.split(/[\n\r]+/)) {
    const trimmed = line.trim();

    const atWill = trimmed.match(/^at will\s*:\s*(.+)/i);
    if (atWill) {
      const spells = splitSpellList(atWill[1]);
      if (spells.length) result.push({ method: 'atwill', limit: 0, spells });
      continue;
    }

    const perDay = trimmed.match(/^(\d+)\s*\/\s*day(?:\s+each)?\s*:\s*(.+)/i);
    if (perDay) {
      const spells = splitSpellList(perDay[2]);
      if (spells.length) result.push({ method: 'innate', limit: parseInt(perDay[1], 10), spells });
    }
  }

  return result;
}

function splitSpellList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
