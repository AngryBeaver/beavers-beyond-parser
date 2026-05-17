import { ParsedChapter, ParsedStatBlock } from '../types.js';
import { ItemBuilder } from './ItemBuilder.js';

// ── Mapping tables ────────────────────────────────────────────────────────────

const DAMAGE_TYPE_MAP: Record<string, string> = {
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
};

const CONDITION_MAP: Record<string, string> = {
  blinded: 'blinded',
  charmed: 'charmed',
  deafened: 'deafened',
  diseased: 'diseased',
  exhaustion: 'exhaustion',
  frightened: 'frightened',
  grappled: 'grappled',
  incapacitated: 'incapacitated',
  invisible: 'invisible',
  paralyzed: 'paralyzed',
  petrified: 'petrified',
  poisoned: 'poisoned',
  prone: 'prone',
  restrained: 'restrained',
  stunned: 'stunned',
  unconscious: 'unconscious',
};

const LANGUAGE_MAP: Record<string, string> = {
  common: 'common',
  draconic: 'draconic',
  dwarvish: 'dwarvish',
  elvish: 'elvish',
  giant: 'giant',
  gnomish: 'gnomish',
  goblin: 'goblin',
  halfling: 'halfling',
  orc: 'orc',
  abyssal: 'abyssal',
  celestial: 'celestial',
  infernal: 'infernal',
  primordial: 'primordial',
  sylvan: 'sylvan',
  undercommon: 'undercommon',
  'deep speech': 'deep',
  druidic: 'druidic',
  "thieves' cant": 'cant',
  aquan: 'aquan',
  auran: 'auran',
  ignan: 'ignan',
  terran: 'terran',
};

const SKILL_MAP: Record<string, { key: string; ability: string }> = {
  acrobatics: { key: 'acr', ability: 'dex' },
  'animal handling': { key: 'ani', ability: 'wis' },
  arcana: { key: 'arc', ability: 'int' },
  athletics: { key: 'ath', ability: 'str' },
  deception: { key: 'dec', ability: 'cha' },
  history: { key: 'his', ability: 'int' },
  insight: { key: 'ins', ability: 'wis' },
  intimidation: { key: 'itm', ability: 'cha' },
  investigation: { key: 'inv', ability: 'int' },
  medicine: { key: 'med', ability: 'wis' },
  nature: { key: 'nat', ability: 'int' },
  perception: { key: 'prc', ability: 'wis' },
  performance: { key: 'prf', ability: 'cha' },
  persuasion: { key: 'per', ability: 'cha' },
  religion: { key: 'rel', ability: 'int' },
  'sleight of hand': { key: 'slt', ability: 'dex' },
  stealth: { key: 'ste', ability: 'dex' },
  survival: { key: 'sur', ability: 'wis' },
};

const SECTION_ACTIVATION: Record<string, string> = {
  actions: 'action',
  'bonus actions': 'bonus',
  reactions: 'reaction',
  'legendary actions': 'legendary',
  'lair actions': 'lair',
  'mythic actions': 'legendary',
};

// ── Public API ────────────────────────────────────────────────────────────────

export class NpcBuilder {
  /**
   * Build all NPCs for an adventure.
   * Phase 1: import every spell referenced across all stat blocks into
   *          "Items > dndBeyond > Spells" (deduplication built-in).
   * Phase 2: create Actor documents with embedded items sourced from those
   *          world items.
   * Returns both ID maps so callers can rewrite journal + spell links.
   */
  static async build(
    adventureTitle: string,
    chapters: ParsedChapter[],
    doc?: Document,
  ): Promise<{ monsterPathToActorId: Map<string, string>; spellNameToItemId: Map<string, string> }> {
    const monsterPathToActorId = new Map<string, string>();
    const emptySpellMap = new Map<string, string>();

    if (!chapters.some((c) => c.statBlocks.length > 0)) {
      return { monsterPathToActorId, spellNameToItemId: emptySpellMap };
    }

    // Phase 1 — import all spells across every chapter up front
    const allStatBlocks = chapters.flatMap((c) => c.statBlocks);
    const { spellNameToItemId } = await ItemBuilder.importAllSpells(allStatBlocks, doc);

    const adventureFolder = (await Folder.create({
      name: adventureTitle,
      type: 'Actor',
      color: '#5b4a2e',
    })) as Folder;

    // Phase 2 — create actors
    let count = 0;
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if (chapter.statBlocks.length === 0) continue;

      const chapterFolder = (await Folder.create({
        name: `${String(i + 1).padStart(2, '0')} - ${chapter.title}`,
        type: 'Actor',
        folder: adventureFolder?.id ?? null,
      })) as Folder;

      for (const sb of chapter.statBlocks) {
        const actor = (await Actor.create(
          buildActorData(sb, chapterFolder?.id ?? null, spellNameToItemId) as any,
        )) as Actor | null | undefined;
        if (actor?.id && sb.monsterHref) {
          monsterPathToActorId.set(sb.monsterHref, actor.id);
        }
        count++;
      }
    }

    if (count > 0) {
      ui.notifications?.info(`Created ${count} NPC(s) in Actors → "${adventureTitle}".`);
    }
    return { monsterPathToActorId, spellNameToItemId };
  }

  static async createSingle(sb: ParsedStatBlock, doc?: Document): Promise<void> {
    const { spellNameToItemId } = await ItemBuilder.importAllSpells([sb], doc);
    const actor = (await Actor.create(
      buildActorData(sb, null, spellNameToItemId) as any,
    )) as Actor | null | undefined;
    if (actor) {
      ui.notifications?.info(`Created NPC "${sb.name}".`);
    }
  }
}

// ── Actor data builder ────────────────────────────────────────────────────────

function buildActorData(
  sb: ParsedStatBlock,
  folderId: string | null,
  spellNameToItemId: Map<string, string>,
): Record<string, unknown> {
  const movement = parseMovement(sb.speed);
  const senses = parseSenses(sb);
  const traits = parseTraits(sb);
  const skills = parseSkills(sb);
  const items = buildItems(sb, spellNameToItemId);

  return {
    name: sb.name,
    type: 'npc',
    img: sb.imageUrl || undefined,
    folder: folderId,
    items,
    system: {
      attributes: {
        hp: { value: sb.hp, min: 0, max: sb.hp, formula: sb.hpFormula },
        ac: { flat: sb.ac, calc: 'flat' },
        movement: { ...movement, units: 'ft' },
        senses: { ranges: senses.ranges, units: 'ft', special: senses.special },
      },
      abilities: {
        str: { value: sb.abilities.str },
        dex: { value: sb.abilities.dex },
        con: { value: sb.abilities.con },
        int: { value: sb.abilities.int },
        wis: { value: sb.abilities.wis },
        cha: { value: sb.abilities.cha },
      },
      skills,
      details: {
        cr: parseCr(sb.cr),
        biography: { value: sb.cleanHtml },
      },
      traits: {
        di: { value: traits.di, custom: traits.diCustom, bypasses: traits.diBypasses },
        dr: { value: traits.dr, custom: traits.drCustom, bypasses: traits.drBypasses },
        dv: { value: traits.dv, custom: traits.dvCustom },
        ci: { value: traits.ci, custom: traits.ciCustom },
        languages: { value: traits.languages, custom: traits.langCustom },
      },
    },
  };
}

// ── Items ─────────────────────────────────────────────────────────────────────

function buildItems(
  sb: ParsedStatBlock,
  spellNameToItemId: Map<string, string>,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  for (const section of sb.sections) {
    const headingLower = section.heading.toLowerCase();
    const activationType = SECTION_ACTIVATION[headingLower] ?? null;
    const isPassive = !activationType && headingLower !== 'actions';

    for (const entryHtml of section.entries) {
      items.push(...buildItemsFromEntry(entryHtml, activationType, isPassive, spellNameToItemId));
    }
  }

  return items;
}

function buildItemsFromEntry(
  entryHtml: string,
  activationType: string | null,
  isPassive: boolean,
  spellNameToItemId: Map<string, string>,
): Record<string, unknown>[] {
  const scratch = new DOMParser().parseFromString(`<p>${entryHtml}</p>`, 'text/html');
  const text = scratch.body.textContent ?? '';

  const nameEl = scratch.querySelector('strong');
  const name = nameEl?.textContent?.trim().replace(/\.$/, '') ?? '';
  if (!name) return [];

  const descHtml = `<p>${entryHtml}</p>`;

  // Spell attacks — source from pre-imported world item, fall back to weapon-type
  const isMeleeSpell = /melee\s+spell\s+attack/i.test(text);
  const isRangedSpell = /ranged\s+spell\s+attack/i.test(text);
  if (isMeleeSpell || isRangedSpell) {
    const cleanName = name.replace(/\s*\(cantrip\)/i, '').trim();
    const spellItem = ItemBuilder.getSpellForActor(cleanName, 'atwill', 0, spellNameToItemId);
    if (spellItem) return [spellItem];
    return [buildSpellAttackItem(name, text, descHtml, isMeleeSpell)];
  }

  // Weapon attacks
  const isMelee = /melee\s+weapon\s+attack/i.test(text);
  const isRanged = /ranged\s+weapon\s+attack/i.test(text);
  if (isMelee || isRanged) {
    return [buildWeaponItem(name, text, descHtml, isMelee)];
  }

  // Spellcasting feature — keep the feat item + add each spell from world items
  const spellLists = ItemBuilder.parseSpellLists(text);
  if (spellLists.length > 0) {
    const result: Record<string, unknown>[] = [];
    result.push(buildFeatItem(name, descHtml, activationType, isPassive));
    const seen = new Set<string>();
    for (const { method, limit, spells } of spellLists) {
      for (const spellName of spells) {
        if (seen.has(spellName)) continue;
        seen.add(spellName);
        const spellItem = ItemBuilder.getSpellForActor(spellName, method, limit, spellNameToItemId);
        if (spellItem) result.push(spellItem);
      }
    }
    return result;
  }

  return [buildFeatItem(name, descHtml, activationType, isPassive)];
}

// ── Spell attack fallback item ────────────────────────────────────────────────

function buildSpellAttackItem(
  name: string,
  text: string,
  descHtml: string,
  isMelee: boolean,
): Record<string, unknown> {
  const attackM = text.match(/([+-]\d+)\s+to\s+hit/i);
  const attackBonus = attackM ? attackM[1].replace('+', '') : '0';

  const damageM = text.match(/[Hh]it.*?(\d+)\s*\(([^)]+)\)\s+([\w]+)\s+damage/);
  const baseWeaponDamage = damageM
    ? {
        custom: { enabled: true, formula: damageM[2].trim() },
        types: [DAMAGE_TYPE_MAP[damageM[3].toLowerCase()] ?? damageM[3].toLowerCase()],
      }
    : {};

  const reachM = text.match(/reach\s+(\d+)\s+ft/i);
  const rangeM = text.match(/range\s+(\d+)(?:\/(\d+))?\s+ft/i);

  const activityId = foundry.utils.randomID();
  return {
    name,
    type: 'weapon',
    system: {
      description: { value: descHtml },
      equipped: true,
      proficient: null,
      type: { value: 'natural' },
      damage: { base: baseWeaponDamage },
      range: {
        reach: reachM ? parseInt(reachM[1], 10) : isMelee ? 5 : undefined,
        value: rangeM ? parseInt(rangeM[1], 10) : undefined,
        long: rangeM?.[2] ? parseInt(rangeM[2], 10) : undefined,
        units: 'ft',
      },
      activities: {
        [activityId]: {
          type: 'attack',
          activation: { type: 'action', value: 1 },
          attack: {
            bonus: attackBonus,
            flat: true,
            type: { value: isMelee ? 'melee' : 'ranged', classification: 'spell' },
          },
          damage: { includeBase: true, parts: [] },
        },
      },
    },
  };
}

// ── Weapon item ───────────────────────────────────────────────────────────────

function buildWeaponItem(
  name: string,
  text: string,
  descHtml: string,
  isMelee: boolean,
): Record<string, unknown> {
  const attackM = text.match(/([+-]\d+)\s+to\s+hit/i);
  const attackBonus = attackM ? attackM[1].replace('+', '') : '0';

  const damageM = text.match(/[Hh]it.*?(\d+)\s*\(([^)]+)\)\s+([\w]+)\s+damage/);
  const baseWeaponDamage = damageM
    ? {
        custom: { enabled: true, formula: damageM[2].trim() },
        types: [DAMAGE_TYPE_MAP[damageM[3].toLowerCase()] ?? damageM[3].toLowerCase()],
      }
    : {};

  const reachM = text.match(/reach\s+(\d+)\s+ft/i);
  const rangeM = text.match(/range\s+(\d+)(?:\/(\d+))?\s+ft/i);

  const activityId = foundry.utils.randomID();
  return {
    name,
    type: 'weapon',
    system: {
      description: { value: descHtml },
      equipped: true,
      proficient: null,
      type: { value: 'natural' },
      damage: { base: baseWeaponDamage },
      range: {
        reach: reachM ? parseInt(reachM[1], 10) : isMelee ? 5 : undefined,
        value: rangeM ? parseInt(rangeM[1], 10) : undefined,
        long: rangeM?.[2] ? parseInt(rangeM[2], 10) : undefined,
        units: 'ft',
      },
      activities: {
        [activityId]: {
          type: 'attack',
          activation: { type: 'action', value: 1 },
          attack: {
            bonus: attackBonus,
            flat: true,
            type: { value: isMelee ? 'melee' : 'ranged', classification: 'weapon' },
          },
          damage: { includeBase: true, parts: [] },
        },
      },
    },
  };
}

// ── Feat item ─────────────────────────────────────────────────────────────────

function buildFeatItem(
  name: string,
  descHtml: string,
  activationType: string | null,
  isPassive: boolean,
): Record<string, unknown> {
  const activities: Record<string, unknown> = {};

  if (!isPassive && activationType) {
    const actId = foundry.utils.randomID();
    activities[actId] = {
      type: 'utility',
      activation: { type: activationType, value: 1 },
    };
  }

  return {
    name,
    type: 'feat',
    system: {
      description: { value: descHtml },
      ...(Object.keys(activities).length > 0 ? { activities } : {}),
    },
  };
}

// ── Movement ─────────────────────────────────────────────────────────────────

function parseMovement(speed: string): Record<string, number> {
  const m: Record<string, number> = {};
  const walk = speed.match(/^(\d+)/);
  if (walk) m.walk = parseInt(walk[1], 10);
  for (const [key, pattern] of [
    ['fly', /fly\s+(\d+)/i],
    ['swim', /swim\s+(\d+)/i],
    ['burrow', /burrow\s+(\d+)/i],
    ['climb', /climb\s+(\d+)/i],
  ] as [string, RegExp][]) {
    const match = speed.match(pattern);
    if (match) m[key] = parseInt(match[1], 10);
  }
  return m;
}

// ── Senses ───────────────────────────────────────────────────────────────────

function parseSenses(sb: ParsedStatBlock): { ranges: Record<string, number>; special: string } {
  const ranges: Record<string, number> = {};
  let special = '';

  const row = sb.data.find((d) => d.label === 'Senses')?.value ?? '';
  if (!row) return { ranges, special };

  const SENSE_KEYS: Record<string, string> = {
    darkvision: 'darkvision',
    blindsight: 'blindsight',
    tremorsense: 'tremorsense',
    truesight: 'truesight',
  };

  for (const [name, key] of Object.entries(SENSE_KEYS)) {
    const m = row.match(new RegExp(`${name}\\s+(\\d+)`, 'i'));
    if (m) ranges[key] = parseInt(m[1], 10);
  }

  const leftover = row
    .replace(/\b(darkvision|blindsight|tremorsense|truesight)\s+\d+\s*ft\.?/gi, '')
    .replace(/,\s*/g, ' ')
    .trim();
  if (leftover) special = leftover;

  return { ranges, special };
}

// ── Damage/condition traits ───────────────────────────────────────────────────

interface TraitResult {
  di: string[];
  diCustom: string;
  diBypasses: string[];
  dr: string[];
  drCustom: string;
  drBypasses: string[];
  dv: string[];
  dvCustom: string;
  ci: string[];
  ciCustom: string;
  languages: string[];
  langCustom: string;
}

function parseTraits(sb: ParsedStatBlock): TraitResult {
  const result: TraitResult = {
    di: [],
    diCustom: '',
    diBypasses: [],
    dr: [],
    drCustom: '',
    drBypasses: [],
    dv: [],
    dvCustom: '',
    ci: [],
    ciCustom: '',
    languages: [],
    langCustom: '',
  };

  for (const { label, value } of sb.data) {
    switch (label) {
      case 'Damage Immunities': {
        const { known, custom, bypasses } = parseDamageList(value);
        result.di = known;
        result.diCustom = custom;
        result.diBypasses = bypasses;
        break;
      }
      case 'Damage Resistances': {
        const { known, custom, bypasses } = parseDamageList(value);
        result.dr = known;
        result.drCustom = custom;
        result.drBypasses = bypasses;
        break;
      }
      case 'Damage Vulnerabilities': {
        const { known, custom } = parseDamageList(value);
        result.dv = known;
        result.dvCustom = custom;
        break;
      }
      case 'Condition Immunities': {
        const { known, custom } = parseConditionList(value);
        result.ci = known;
        result.ciCustom = custom;
        break;
      }
      case 'Languages': {
        const { known, custom } = parseLanguageList(value);
        result.languages = known;
        result.langCustom = custom;
        break;
      }
    }
  }
  return result;
}

function parseDamageList(text: string): { known: string[]; custom: string; bypasses: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  const bypasses: string[] = [];

  if (/nonmagical/i.test(text)) bypasses.push('mgc');
  if (/silvered/i.test(text)) bypasses.push('sil');
  if (/adamantine/i.test(text)) bypasses.push('ada');

  for (const part of text.split(/[,;]/)) {
    const clean = part.trim().toLowerCase();
    const matched = Object.keys(DAMAGE_TYPE_MAP).find((k) => clean.startsWith(k));
    if (matched) {
      known.push(DAMAGE_TYPE_MAP[matched]);
    } else if (
      clean &&
      !/^(and|from|that|aren't|nonmagical|weapon|attacks?|silvered|adamantine)\b/i.test(clean)
    ) {
      unknown.push(part.trim());
    }
  }

  return { known, bypasses, custom: unknown.join(', ') };
}

function parseConditionList(text: string): { known: string[]; custom: string } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const part of text.split(/[,;]/)) {
    const clean = part.trim().toLowerCase();
    if (CONDITION_MAP[clean]) {
      known.push(CONDITION_MAP[clean]);
    } else if (clean) {
      unknown.push(part.trim());
    }
  }
  return { known, custom: unknown.join(', ') };
}

function parseLanguageList(text: string): { known: string[]; custom: string } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const part of text.split(/[,;]/)) {
    const clean = part.trim().toLowerCase().replace(/\s+/g, ' ');
    const key = LANGUAGE_MAP[clean];
    if (key) {
      known.push(key);
    } else if (clean && !/^(understands?|but|can't|cannot|speak|the|any)\b/.test(clean)) {
      unknown.push(part.trim());
    }
  }
  return { known, custom: unknown.join(', ') };
}

// ── Skills ───────────────────────────────────────────────────────────────────

function parseSkills(sb: ParsedStatBlock): Record<string, { value: number; ability: string }> {
  const result: Record<string, { value: number; ability: string }> = {};
  const row = sb.data.find((d) => d.label === 'Skills')?.value ?? '';
  if (!row) return result;

  const profBonus = parseInt(sb.profBonus.replace('+', ''), 10) || 2;

  const tokens = row.match(/([A-Z][a-zA-Z\s]+?)\s+([+-]\d+)/g) ?? [];
  for (const token of tokens) {
    const m = token.match(/^(.+?)\s+([+-]\d+)$/);
    if (!m) continue;
    const skillName = m[1].trim().toLowerCase();
    const listedMod = parseInt(m[2], 10);

    const entry = SKILL_MAP[skillName];
    if (!entry) continue;

    const abilityScore = sb.abilities[entry.ability as keyof typeof sb.abilities] ?? 10;
    const abilityMod = Math.floor((abilityScore - 10) / 2);

    let profLevel = 1;
    if (listedMod >= abilityMod + profBonus * 2) profLevel = 2;

    result[entry.key] = { value: profLevel, ability: entry.ability };
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCr(cr: string): number {
  if (!cr) return 0;
  if (cr.includes('/')) {
    const [n, d] = cr.split('/').map(Number);
    return d ? n / d : 0;
  }
  return parseFloat(cr) || 0;
}
