import { ParsedSpell, ParsedStatBlock } from '../types.js';
import { StatBlockParser } from './StatBlockParser.js';
import { SpellParser } from './SpellParser.js';

// Module-level cache — "dndBeyond > Spells" folder ID, created once per session
let _spellFolderId: string | null | undefined;

// ── Public API ────────────────────────────────────────────────────────────────

export class ItemBuilder {
  /**
   * Pre-import every spell referenced by the given stat blocks into
   * "Items > dndBeyond > Spells".  Deduplicates by name — if the world item
   * already exists it is reused unchanged.  Compendium spells are imported as
   * full items; unknown spells become minimal stubs.
   *
   * Returns the name→id map needed by getSpellForActor and journal rewriting.
   */
  static async importAllSpells(
    statBlocks: ParsedStatBlock[],
    doc?: Document,
  ): Promise<{ spellNameToItemId: Map<string, string>; created: number; reused: number }> {
    const spellData = doc ? SpellParser.extractAll(doc) : new Map<string, ParsedSpell>();
    return importAllSpellsInternal(statBlocks, spellData);
  }

  /**
   * Convenience wrapper for ImportItemWindow: parse stat blocks from a document
   * and import their spells, returning the same result shape.
   */
  static async importSpellsFromDoc(
    doc: Document,
  ): Promise<{ spellNameToItemId: Map<string, string>; created: number; reused: number }> {
    const statBlocks = StatBlockParser.extractAll(doc);
    return ItemBuilder.importAllSpells(statBlocks, doc);
  }

  /**
   * Build actor-embeddable item data for a spell that was already imported.
   * Sources data from the world item (deduplicating), applies method / uses
   * override, and sets flags.core.sourceId back to the world item.
   *
   * Synchronous — all world items must be imported first via importAllSpells.
   */
  static getSpellForActor(
    spellName: string,
    method: string,
    limit: number,
    spellNameToItemId: Map<string, string>,
  ): Record<string, unknown> | null {
    const worldItemId = spellNameToItemId.get(spellName.toLowerCase());
    if (!worldItemId) return null;

    const worldItem = (game.items as any)?.get(worldItemId) as any;
    if (!worldItem) return null;

    const data = JSON.parse(JSON.stringify(worldItem.toObject())) as any;
    delete data._id;
    data.folder = null;
    data.system = data.system ?? {};
    data.system.method = method;
    if (limit > 0) {
      data.system.uses = {
        max: String(limit),
        spent: 0,
        recovery: [{ period: 'day', type: 'recoverAll' }],
      };
    } else {
      data.system.uses = { max: null, spent: 0, recovery: [] };
    }
    data.flags = data.flags ?? {};
    data.flags.core = data.flags.core ?? {};
    data.flags.core.sourceId = `Item.${worldItemId}`;
    return data;
  }

  /**
   * Import a single spell by name into "Items > dndBeyond > Spells".
   * Checks for an existing world item first, then tries the compendium,
   * then creates a stub using any parsed data from the spell's detail page.
   */
  static async importSpellByName(
    name: string,
    parsed?: ParsedSpell,
  ): Promise<{ id: string; isNew: boolean }> {
    const folderId = await getSpellFolder();
    return getOrCreateWorldSpellItem(name, parsed, folderId);
  }

  /** Parse "At will:" / "N/day each:" lines from plain text. */
  static parseSpellLists = parseSpellLists;
}

// ── Spell import ──────────────────────────────────────────────────────────────

async function importAllSpellsInternal(
  statBlocks: ParsedStatBlock[],
  spellData: Map<string, ParsedSpell>,
): Promise<{ spellNameToItemId: Map<string, string>; created: number; reused: number }> {
  const spellNameToItemId = new Map<string, string>();
  const seen = new Set<string>();
  let created = 0;
  let reused = 0;

  const folderId = await getSpellFolder();

  const register = async (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const { id, isNew } = await getOrCreateWorldSpellItem(name, spellData.get(name), folderId);
    if (id) {
      spellNameToItemId.set(name, id);
      if (isNew) created++;
      else reused++;
    }
  };

  for (const sb of statBlocks) {
    for (const section of sb.sections) {
      for (const entryHtml of section.entries) {
        const scratch = new DOMParser().parseFromString(`<p>${entryHtml}</p>`, 'text/html');
        const text = scratch.body.textContent ?? '';

        // Spellcasting lists: "At will: …" / "N/day each: …"
        for (const { spells } of parseSpellLists(text)) {
          for (const spellName of spells) await register(spellName);
        }

        // Individual spell attack entries: "Shocking Grasp (Cantrip). Melee Spell Attack:…"
        if (/(?:melee|ranged)\s+spell\s+attack/i.test(text)) {
          const rawName =
            scratch.querySelector('strong')?.textContent?.trim().replace(/\.$/, '') ?? '';
          const cleanName = rawName.replace(/\s*\(cantrip\)/i, '').trim().toLowerCase();
          if (cleanName) await register(cleanName);
        }
      }
    }
  }

  return { spellNameToItemId, created, reused };
}

// ── World item creation ───────────────────────────────────────────────────────

async function getOrCreateWorldSpellItem(
  name: string,
  parsed: ParsedSpell | undefined,
  folderId: string | null,
): Promise<{ id: string; isNew: boolean }> {
  const nameLower = name.toLowerCase();

  // Reuse existing world spell in the folder (or anywhere if no folder)
  const existing = (game.items as any)?.find(
    (i: any) =>
      i.type === 'spell' &&
      i.name.toLowerCase() === nameLower &&
      (folderId ? i.folder?.id === folderId : true),
  ) as any;
  if (existing) return { id: existing.id, isNew: false };

  // Import full compendium item — preserves all spell data, description, activities
  const compendiumData = await findSpellInCompendium(name);
  if (compendiumData) {
    const itemData = JSON.parse(JSON.stringify(compendiumData)) as any;
    delete itemData._id;
    itemData.folder = folderId;
    try {
      const item = await (Item as any).create(itemData);
      if (item?.id) return { id: item.id, isNew: true };
    } catch {
      // fall through to stub
    }
  }

  // Minimal stub for spells not in any compendium
  const data: Record<string, unknown> = {
    name,
    type: 'spell',
    folder: folderId,
    system: {
      level: parsed?.level ?? 0,
      school: parsed?.school ?? 'evo',
      description: { value: parsed?.description ?? '' },
      activation: { type: 'action', value: 1 },
      ...(parsed?.components?.length ? { properties: parsed.components } : {}),
    },
  };
  try {
    const item = await (Item as any).create(data);
    return { id: item?.id ?? '', isNew: true };
  } catch {
    return { id: '', isNew: true };
  }
}

// ── Spell folder ("Items > dndBeyond > Spells") ───────────────────────────────

async function getSpellFolder(): Promise<string | null> {
  if (_spellFolderId !== undefined) return _spellFolderId;
  _spellFolderId = await getOrCreateSpellFolder();
  return _spellFolderId;
}

async function getOrCreateSpellFolder(): Promise<string | null> {
  try {
    let parent = (game.folders as any)?.find(
      (f: any) => f.type === 'Item' && f.name === 'dndBeyond' && !f.folder,
    ) as any;
    if (!parent) {
      parent = await (Folder as any).create({ name: 'dndBeyond', type: 'Item' });
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

// ── Spell list parsing ────────────────────────────────────────────────────────

function parseSpellLists(
  text: string,
): Array<{ method: string; limit: number; spells: string[] }> {
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
  return text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
