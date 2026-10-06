import { ParsedChapter, ParsedSpell, ParsedStatBlock, ProgressFn } from '../types.js';
import { PRIMARY_PACK_MODULES, LEGACY_PACK_MODULES } from '../definitions.js';
import { StatBlockParser } from './StatBlockParser.js';
import { SpellParser } from './SpellParser.js';
import { ImageStore, spellImageTarget } from './ImageStore.js';
import { importFolder } from './ImportFolders.js';
import { BeyondFetcher } from './BeyondFetcher.js';
import { buildItemData, parseItemPage } from './ItemPageParser.js';

/**
 * Key for comparing spell names. Stat blocks write "Heroes’ Feast", link slugs give
 * "heroes feast", compendiums have "Heroes' Feast", and footnoted spells end in "*".
 */
function looseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Name for a spell created from a stat block reference ("mage armor*" → "Mage Armor"). */
function displayName(name: string): string {
  return name
    .replace(/[*]+$/, '')
    .trim()
    .replace(/(^|[ -])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

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
   * Build actor-embeddable item data for a spell.  The UUID stored in
   * spellNameToItemId is either "Item.worldId" (world item) or a full
   * compendium UUID "Compendium.pack.Item.id".  Both are loaded and cloned.
   */
  static async getSpellForActor(
    spellName: string,
    method: string,
    limit: number,
    spellNameToItemId: Map<string, string>,
  ): Promise<Record<string, unknown> | null> {
    let uuid = spellNameToItemId.get(spellName.toLowerCase());
    // Fallback: search compendium packs directly (used by preview / validation)
    if (!uuid) uuid = (await findSpellInPacks(spellName)) ?? undefined;
    if (!uuid) return null;

    let data: any = null;

    if (uuid.startsWith('Compendium.')) {
      const parts = uuid.split('.');
      const itemId = parts[parts.length - 1];
      const packId = parts.slice(1, parts.length - 2).join('.');
      const pack = (game.packs as any).get(packId);
      if (!pack) return null;
      const doc = (await pack.getDocument(itemId)) as any;
      if (!doc) return null;
      data = JSON.parse(JSON.stringify(doc.toObject()));
    } else {
      const worldItemId = uuid.includes('.') ? uuid.split('.').pop()! : uuid;
      const worldItem = (game.items as any)?.get(worldItemId) as any;
      if (!worldItem) return null;
      data = JSON.parse(JSON.stringify(worldItem.toObject()));
    }

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
    data.flags.core.sourceId = uuid;
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

  /**
   * Scan all chapter page HTML for /spells/ links and register any spell
   * not already in spellNameToItemId.  Call this before JournalBuilder.build()
   * so that narrative spell links get rewritten to @UUID references.
   */
  static async importSpellsFromChapters(
    chapters: ParsedChapter[],
    spellNameToItemId: Map<string, string>,
  ): Promise<void> {
    const seen = new Set<string>(spellNameToItemId.keys());
    const folderId = await getSpellFolder();

    const register = async (name: string, pathname: string) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const packUuid = await findSpellInPacks(name);
      if (packUuid) {
        spellNameToItemId.set(key, packUuid);
        return;
      }
      const parsed = await fetchSpellPage(pathname, name);
      const { id } = await getOrCreateWorldSpellItem(parsed?.name ?? name, parsed, folderId);
      if (id) spellNameToItemId.set(key, `Item.${id}`);
    };

    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        const doc = new DOMParser().parseFromString(page.content, 'text/html');
        for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
          const href = a.getAttribute('href') ?? '';
          let pathname: string;
          try {
            pathname = href.startsWith('http') ? new URL(href).pathname : href.split('#')[0];
          } catch {
            continue;
          }
          if (!pathname.includes('/spells/')) continue;

          const slug = pathname.split('/').filter(Boolean).pop() ?? '';
          if (!slug) continue;
          const nameFromSlug = slug.replace(/^\d+-/, '').replace(/-/g, ' ');
          const nameFromText = a.textContent?.trim() ?? '';

          // Register under display text (canonical name) and slug-derived name.
          // rewriteLinks tries nameFromSlug first then text, so both keys are needed.
          if (nameFromText) await register(nameFromText, pathname);
          if (nameFromSlug && nameFromSlug.toLowerCase() !== nameFromText.toLowerCase()) {
            await register(nameFromSlug, pathname);
          }
        }
      }
    }
  }

  /**
   * Resolve the /magic-items/ and /equipment/ links of all chapters, keyed by link path.
   * Items a compendium has are linked there; everything else is imported from its D&D Beyond
   * page into "Items > dndBeyond > Items", so journals do not have to link back to D&D Beyond.
   */
  static async importItemLinks(
    chapters: ParsedChapter[],
    onProgress?: ProgressFn,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // loose item name → UUID, in pack priority order
    const byName = new Map<string, string>();
    for (const pack of resolvedSpellPackList()) {
      try {
        for (const entry of (await pack.getIndex()) as Iterable<any>) {
          const key = looseName(entry.name ?? '');
          if (key && entry.type !== 'spell' && !byName.has(key)) {
            byName.set(key, `Compendium.${pack.collection}.Item.${entry._id}`);
          }
        }
      } catch {
        // skip unavailable/broken packs
      }
    }

    let folderId: string | null | undefined;
    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        const doc = new DOMParser().parseFromString(page.content, 'text/html');
        for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
          let pathname: string;
          try {
            pathname = new URL(a.getAttribute('href') ?? '', 'https://www.dndbeyond.com').pathname;
          } catch {
            continue;
          }
          if (!/^\/(magic-items|equipment)\//.test(pathname) || result.has(pathname)) continue;

          const slug = pathname.split('/').filter(Boolean).pop() ?? '';
          const name = slug.replace(/^\d+-/, '').replace(/-/g, ' ');
          const words = name.split(' ');
          const text = a.textContent?.trim() ?? '';
          const candidates = [
            name,
            name.replace(/ (\d)$/, ' +$1'), // "longsword 1" → "Longsword +1"
            [...words.slice(1), words[0]].join(' '), // "crossbow light" → "Light Crossbow"
            text,
            text.replace(/s$/, ''), // "daggers" → "Dagger"
          ];
          const packUuid = candidates.map((c) => byName.get(looseName(c))).find(Boolean);
          if (packUuid) {
            result.set(pathname, packUuid);
            continue;
          }

          onProgress?.(`Importing item: ${displayName(name)}…`);
          folderId ??= await importFolder('Item', 'Items');
          const id = await importItemPage(pathname, displayName(name), folderId);
          if (id) result.set(pathname, `Item.${id}`);
        }
      }
    }
    return result;
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

    // Check configured spell packs first — link directly, no world copy
    const packUuid = await findSpellInPacks(name);
    if (packUuid) {
      spellNameToItemId.set(name, packUuid);
      return;
    }

    const { id, isNew } = await getOrCreateWorldSpellItem(name, spellData.get(name), folderId);
    if (id) {
      spellNameToItemId.set(name, `Item.${id}`);
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

        // Individual spell attack entries — only real spells carry a /spells/ link.
        // Custom monster actions ("Fire Ray. Ranged Spell Attack:") have no such link.
        if (/(?:melee|ranged)\s+spell\s+attack/i.test(text)) {
          const spellLink = scratch.querySelector<HTMLAnchorElement>('a[href*="/spells/"]');
          if (spellLink) {
            const cleanName = (spellLink.textContent?.trim() ?? '').toLowerCase();
            if (cleanName) await register(cleanName);
          }
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
  const nameLower = looseName(name);

  // Reuse existing world spell in the folder (or anywhere if no folder)
  const existing = (game.items as any)?.find(
    (i: any) =>
      i.type === 'spell' &&
      looseName(i.name) === nameLower &&
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

  // Rich stub for spells not in any compendium
  const activation = parseSpellActivation(parsed?.castingTime ?? '');
  const range = parseSpellRange(parsed?.range ?? '');
  const area = parseSpellArea(parsed?.range ?? '');
  const duration = parseSpellDuration(parsed?.duration ?? '');

  const properties = new Set<string>(parsed?.components ?? []);
  if (parsed?.concentration) properties.add('concentration');
  if (parsed?.ritual) properties.add('ritual');

  const activity = buildSpellActivity(
    parsed?.attackSave ?? '',
    parsed?.damageEffect ?? '',
    activation,
  );

  let img = '';
  if (parsed?.imageUrl) {
    const target = spellImageTarget(name, parsed.imageUrl);
    img = await ImageStore.store(target.entity, target.name, parsed.imageUrl);
  }

  const data: Record<string, unknown> = {
    name: displayName(name),
    type: 'spell',
    folder: folderId,
    ...(img ? { img } : {}),
    system: {
      level: parsed?.level ?? 0,
      school: parsed?.school ?? 'evo',
      description: { value: parsed?.description ?? '' },
      activation,
      range,
      duration,
      materials: { value: parsed?.materialDesc ?? '', consumed: false, cost: 0, supply: 0 },
      properties: [...properties],
      ...(area
        ? {
            target: {
              template: { type: area.type, size: String(area.size), units: area.units },
              affects: {},
            },
          }
        : {}),
      ...(activity ? { activities: { [foundry.utils.randomID()]: activity } } : {}),
    },
  };
  try {
    const item = await (Item as any).create(data);
    return { id: item?.id ?? '', isNew: true };
  } catch {
    return { id: '', isNew: true };
  }
}

// ── Item pages ────────────────────────────────────────────────────────────────

/** Create a world item from a D&D Beyond item page; an item of that name in the folder is reused. */
async function importItemPage(
  pathname: string,
  fallbackName: string,
  folderId: string | null,
): Promise<string | null> {
  try {
    const html = await BeyondFetcher.fetchPage(`https://www.dndbeyond.com${pathname}`);
    const parsed = parseItemPage(new DOMParser().parseFromString(html, 'text/html'), fallbackName);
    if (!parsed) return null;

    const existing = (game.items as any)?.find(
      (i: any) =>
        (i.folder?.id ?? null) === folderId && looseName(i.name) === looseName(parsed.name),
    );
    if (existing) return existing.id;

    const data = buildItemData(parsed);
    if (parsed.imageUrl) {
      const slug = pathname.split('/').filter(Boolean).pop() ?? fallbackName;
      data.img = await ImageStore.store(`items/${slug}`, 'image', parsed.imageUrl);
    }
    const item = await (Item as any).create({ ...data, folder: folderId });
    return item?.id ?? null;
  } catch (err: any) {
    console.warn(`[bbp] could not import item ${pathname}:`, err?.message);
    return null;
  }
}

/** Spell data from the spell's own D&D Beyond page, for spells no compendium has. */
async function fetchSpellPage(pathname: string, name: string): Promise<ParsedSpell | undefined> {
  try {
    const html = await BeyondFetcher.fetchPage(`https://www.dndbeyond.com${pathname}`);
    return SpellParser.parseSpellPage(new DOMParser().parseFromString(html, 'text/html'), name);
  } catch {
    return undefined; // the spell is still created, from its name only
  }
}

// ── Spell folder ("Items > dndBeyond > Spells") ───────────────────────────────

function getSpellFolder(): Promise<string | null> {
  return importFolder('Item', 'Spells');
}

// ── Compendium lookup ─────────────────────────────────────────────────────────

function resolvedSpellPackList(): any[] {
  const primarySet = new Set(PRIMARY_PACK_MODULES);
  const legacySet = new Set(LEGACY_PACK_MODULES);

  const primary: any[] = [];
  const extra: any[] = [];
  const legacy: any[] = [];

  for (const pack of (game.packs as any).contents as any[]) {
    if (pack.documentName !== 'Item') continue;
    const mod = (pack.collection as string).split('.')[0];
    if (primarySet.has(mod)) primary.push(pack);
    else if (legacySet.has(mod)) legacy.push(pack);
    else extra.push(pack);
  }

  primary.sort(
    (a, b) =>
      PRIMARY_PACK_MODULES.indexOf(a.collection.split('.')[0]) -
      PRIMARY_PACK_MODULES.indexOf(b.collection.split('.')[0]),
  );

  return [...primary, ...extra, ...legacy];
}

async function findSpellInPacks(spellName: string): Promise<string | null> {
  const nameLower = looseName(spellName);
  const ordered = resolvedSpellPackList();
  for (const pack of ordered) {
    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => looseName(e.name ?? '') === nameLower);
      if (entry) return `Compendium.${pack.collection}.Item.${entry._id}`;
    } catch {
      // skip unavailable/broken packs
    }
  }
  return null;
}

async function findSpellInCompendium(name: string): Promise<Record<string, unknown> | null> {
  if (!(game.packs as any)?.contents) return null;
  const nameLower = looseName(name);

  for (const pack of resolvedSpellPackList()) {
    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => looseName(e.name ?? '') === nameLower);
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

function parseSpellLists(text: string): Array<{ method: string; limit: number; spells: string[] }> {
  const result: Array<{ method: string; limit: number; spells: string[] }> = [];

  for (const line of text.split(/[\n\r]+/)) {
    const trimmed = line.trim();

    // "At will: spell1, spell2"  (innate spellcasting)
    const atWill = trimmed.match(/^at will\s*:\s*(.+)/i);
    if (atWill) {
      const spells = splitSpellList(atWill[1]);
      if (spells.length) result.push({ method: 'atwill', limit: 0, spells });
      continue;
    }

    // "N/day each: spell1, spell2"  (innate spellcasting)
    const perDay = trimmed.match(/^(\d+)\s*\/\s*day(?:\s+each)?\s*:\s*(.+)/i);
    if (perDay) {
      const spells = splitSpellList(perDay[2]);
      if (spells.length) result.push({ method: 'innate', limit: parseInt(perDay[1], 10), spells });
      continue;
    }

    // "Cantrips (at will): spell1, spell2"  (prepared spellcasting)
    const cantrips = trimmed.match(/^cantrips?\s*(?:\([^)]*\))?\s*:\s*(.+)/i);
    if (cantrips) {
      const spells = splitSpellList(cantrips[1]);
      if (spells.length) result.push({ method: 'atwill', limit: 0, spells });
      continue;
    }

    // "1st level (4 slots): spell1, spell2"  (prepared spellcasting)
    const levelSlots = trimmed.match(/^\d+(?:st|nd|rd|th)\s+level\s*(?:\([^)]*\))?\s*:\s*(.+)/i);
    if (levelSlots) {
      const spells = splitSpellList(levelSlots[1]);
      if (spells.length) result.push({ method: 'prepared', limit: 0, spells });
      continue;
    }
  }

  return result;
}

function splitSpellList(text: string): string[] {
  return text
    .split(',')
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim(),
    )
    .filter(Boolean);
}

// ── Spell field converters ────────────────────────────────────────────────────

function parseSpellActivation(castingTime: string): { type: string; value: number | null } {
  if (!castingTime) return { type: 'action', value: 1 };
  if (/bonus\s+action/i.test(castingTime)) return { type: 'bonus', value: 1 };
  if (/reaction/i.test(castingTime)) return { type: 'reaction', value: 1 };
  const m = castingTime.match(/(\d+)\s+(minute|hour)/i);
  if (m) return { type: m[2].toLowerCase(), value: parseInt(m[1], 10) };
  return { type: 'action', value: 1 };
}

function parseSpellRange(rangeText: string): { value: string | null; units: string } {
  const base = rangeText.split('(')[0].trim().toLowerCase();
  if (/^touch/.test(base)) return { value: null, units: 'touch' };
  if (/^self/.test(base)) return { value: null, units: 'self' };
  if (/special|unlimited|sight|any/i.test(base)) return { value: null, units: 'spec' };
  const feetM = rangeText.match(/^(\d+)\s*(?:feet|foot|ft)/i);
  if (feetM) return { value: feetM[1], units: 'ft' };
  const mileM = rangeText.match(/^(\d+)\s*mile/i);
  if (mileM) return { value: mileM[1], units: 'mi' };
  if (!rangeText) return { value: null, units: 'self' };
  return { value: null, units: 'spec' };
}

function parseSpellArea(rangeText: string): { type: string; size: number; units: string } | null {
  const areaM = rangeText.match(
    /\((\d+)[\s-]*(foot|feet|ft|mile)[s\s-]*(cone|cube|cylinder|line|radius|emanation|sphere|square)/i,
  );
  if (!areaM) return null;
  const AREA_MAP: Record<string, string> = {
    cone: 'cone',
    cube: 'cube',
    cylinder: 'cylinder',
    line: 'line',
    radius: 'radius',
    emanation: 'radius',
    sphere: 'sphere',
    square: 'square',
  };
  return {
    type: AREA_MAP[areaM[3].toLowerCase()] ?? areaM[3].toLowerCase(),
    size: parseInt(areaM[1], 10),
    units: /mile/i.test(areaM[2]) ? 'mi' : 'ft',
  };
}

function parseSpellDuration(durationText: string): { value: string | null; units: string } {
  if (!durationText) return { value: null, units: 'inst' };
  const t = durationText.toLowerCase();
  if (/instantaneous/i.test(t)) return { value: null, units: 'inst' };
  if (/until\s+dispelled/i.test(t)) return { value: null, units: 'disp' };
  if (/permanent/i.test(t)) return { value: null, units: 'perm' };
  const roundM = t.match(/(\d+)\s*round/i);
  if (roundM) return { value: roundM[1], units: 'round' };
  const minuteM = t.match(/(\d+)\s*minute/i);
  if (minuteM) return { value: minuteM[1], units: 'minute' };
  const hourM = t.match(/(\d+)\s*hour/i);
  if (hourM) return { value: hourM[1], units: 'hour' };
  const dayM = t.match(/(\d+)\s*day/i);
  if (dayM) return { value: dayM[1], units: 'day' };
  return { value: null, units: 'spec' };
}

const DAMAGE_TYPE_MAP_SPELLS: Record<string, string> = {
  acid: 'acid',
  bludgeoning: 'bludgeoning',
  cold: 'cold',
  fire: 'fire',
  force: 'force',
  lightning: 'lightning',
  necrotic: 'necrotic',
  piercing: 'piercing',
  poison: 'poison',
  psychic: 'psychic',
  radiant: 'radiant',
  slashing: 'slashing',
  thunder: 'thunder',
  healing: 'healing',
};

const SAVE_ABILITY_MAP: Record<string, string> = {
  str: 'str',
  strength: 'str',
  dex: 'dex',
  dexterity: 'dex',
  con: 'con',
  constitution: 'con',
  int: 'int',
  intelligence: 'int',
  wis: 'wis',
  wisdom: 'wis',
  cha: 'cha',
  charisma: 'cha',
};

function parseDamageParts(
  damageEffect: string,
): Array<{ number: number; denomination: number; bonus: string; types: string[] }> {
  const parts: Array<{ number: number; denomination: number; bonus: string; types: string[] }> = [];
  const m = damageEffect.match(/(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s+(\w+)/i);
  if (!m) return parts;
  const dmgType = DAMAGE_TYPE_MAP_SPELLS[m[4].toLowerCase()] ?? m[4].toLowerCase();
  parts.push({
    number: parseInt(m[1], 10),
    denomination: parseInt(m[2], 10),
    bonus: m[3] ?? '',
    types: [dmgType],
  });
  return parts;
}

function buildSpellActivity(
  attackSave: string,
  damageEffect: string,
  activation: { type: string; value: number | null },
): Record<string, unknown> | null {
  const as = attackSave.toLowerCase();
  const damageParts = parseDamageParts(damageEffect);

  // Save activity
  const saveAbilityM = as.match(
    /\b(str|dex|con|int|wis|cha|strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i,
  );
  if (saveAbilityM && /save/i.test(as)) {
    const ability = SAVE_ABILITY_MAP[saveAbilityM[1].toLowerCase()] ?? 'dex';
    return {
      type: 'save',
      activation,
      save: {
        ability: [ability],
        dc: { calculation: 'spellcasting', formula: '' },
      },
      damage: { parts: damageParts, onSave: 'half' },
    };
  }

  // Attack activity
  if (/melee/i.test(as)) {
    return {
      type: 'attack',
      activation,
      attack: { type: { value: 'melee', classification: 'spell' }, flat: false },
      damage: { parts: damageParts, includeBase: true },
    };
  }
  if (/ranged/i.test(as)) {
    return {
      type: 'attack',
      activation,
      attack: { type: { value: 'ranged', classification: 'spell' }, flat: false },
      damage: { parts: damageParts, includeBase: true },
    };
  }

  return null;
}
