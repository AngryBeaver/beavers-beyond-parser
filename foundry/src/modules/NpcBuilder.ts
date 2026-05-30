import { ParsedChapter, ParsedStatBlock } from '../types.js';
import { BeyondFetcher } from './BeyondFetcher.js';
import { StatBlockParser } from './StatBlockParser.js';
import { ItemBuilder } from './ItemBuilder.js';
import { findInCompendium, lookupImg, AiStats } from './CompendiumLookup.js';
import { AiLookup } from './AiLookup.js';

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

const FULL_ABILITY_MAP: Record<string, string> = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};

const AREA_TYPE_MAP: Record<string, string> = {
  sphere: 'sphere', emanation: 'sphere', cone: 'cone',
  cube: 'cube', cylinder: 'cylinder', line: 'line',
};

// ── Public API ────────────────────────────────────────────────────────────────

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
    onProgress?: (msg: string) => void,
  ): Promise<{
    monsterPathToActorId: Map<string, string>;
    spellNameToItemId: Map<string, string>;
    aiStats: AiStats;
    actorsCreated: number;
  }> {
    const monsterPathToActorId = new Map<string, string>();
    const emptySpellMap = new Map<string, string>();
    const aiStats: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };

    // Collect unique monster refs from inline stat-block stubs + <a> links in pages
    const monsterRefMap = new Map<string, string>(); // pathname → name

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

    for (const [monsterHref, name] of monsterRefMap) {
      onProgress?.(`Building actors: ${name}: checking packs…`);
      const packUuid = await findInPacks(name);
      if (packUuid) {
        monsterPathToActorId.set(monsterHref, packUuid);
        continue;
      }

      onProgress?.(`Building actors: ${name}: get StatBlock…`);
      try {
        const html = await BeyondFetcher.fetchPage(`https://www.dndbeyond.com${monsterHref}`);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const statBlocks = StatBlockParser.extractAll(doc);
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

    // Phase 1 — import spells from fetched stat blocks
    const { spellNameToItemId } = await ItemBuilder.importAllSpells(
      pendingCreations.map((p) => p.sb),
    );

    // Phase 2 — create actors
    const totalActors = pendingCreations.length;
    for (let i = 0; i < totalActors; i++) {
      const { originalHref, sb } = pendingCreations[i];
      const pct = Math.round((i / totalActors) * 100);
      const progressWithPct = onProgress
        ? (msg: string) => onProgress(`${msg} [${pct}%]`)
        : undefined;
      onProgress?.(`Building actors: ${sb.name}… [${pct}%]`);
      const actor = (await Actor.create(
        (await buildActorData(sb, dndBeyondFolderId, spellNameToItemId, progressWithPct, aiStats)) as any,
      )) as Actor | null | undefined;
      if (actor?.id) {
        monsterPathToActorId.set(originalHref, `Actor.${actor.id}`);
      }
    }

    return { monsterPathToActorId, spellNameToItemId, aiStats, actorsCreated: pendingCreations.length };
  }

  static async createSingle(sb: ParsedStatBlock, doc?: Document): Promise<{ aiStats: AiStats }> {
    const aiStats: AiStats = { calls: 0, match: 0, patch: 0, iconSuggest: 0, iconMiss: 0 };
    const folderId = await findOrCreateDndBeyondActorFolder();
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

// ── Pack / folder helpers ─────────────────────────────────────────────────────

async function findInPacks(monsterName: string): Promise<string | null> {
  const nameLower = monsterName.toLowerCase();
  const allPacks = (game.packs as any).contents as any[];
  for (const pack of allPacks) {
    if (pack.metadata?.type !== 'Actor') continue;
    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => e.name?.toLowerCase() === nameLower);
      if (entry) return `Compendium.${pack.collection}.Actor.${entry._id}`;
    } catch {
      // skip unavailable/broken packs
    }
  }
  return null;
}

async function findOrCreateDndBeyondActorFolder(): Promise<string | null> {
  try {
    let folder = (game.folders as any)?.find(
      (f: any) => f.type === 'Actor' && f.name === 'dndbeyond' && !f.folder,
    ) as any;
    if (!folder) {
      folder = await (Folder as any).create({ name: 'dndbeyond', type: 'Actor' });
    }
    return folder?.id ?? null;
  } catch {
    return null;
  }
}

// ── Actor data builder ────────────────────────────────────────────────────────

async function buildActorData(
  sb: ParsedStatBlock,
  folderId: string | null,
  spellNameToItemId: Map<string, string>,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
): Promise<Record<string, unknown>> {
  const movement = parseMovement(sb.speed);
  const senses = parseSenses(sb);
  const traits = parseTraits(sb);
  const skills = parseSkills(sb);
  const items = await buildItems(sb, spellNameToItemId, onProgress, aiStats);

  return {
    name: sb.name,
    type: 'npc',
    img: sb.imageUrl || undefined,
    folder: folderId,
    items,
    system: {
      attributes: {
        hp: { value: sb.hp, min: 0, max: sb.hp, formula: cleanFormula(sb.hpFormula) },
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

async function buildItems(
  sb: ParsedStatBlock,
  spellNameToItemId: Map<string, string>,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];

  // Pre-group all entries across sections so we know the total count upfront.
  type Grouped = { entryHtml: string; activationType: string | null; isPassive: boolean };
  const allEntries: Grouped[] = [];

  for (const section of sb.sections) {
    const headingLower = section.heading.toLowerCase();
    const activationType = SECTION_ACTIVATION[headingLower] ?? null;
    const isPassive = !activationType && headingLower !== 'actions';

    // DDB renders spellcasting as several consecutive <p> elements: a named header
    // ("Spellcasting.", "Innate Spellcasting.") followed by nameless spell-list
    // paragraphs ("At will: …", "Cantrips (at will): …", "1st level (4 slots): …").
    // Group each nameless paragraph onto the preceding named entry so that
    // buildItemsFromEntry sees all the /spells/ links in one pass.
    const grouped: string[] = [];
    for (const html of section.entries) {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const hasName = !!extractEntryName(doc.body.firstElementChild ?? doc.body);
      if (!hasName && grouped.length > 0) {
        grouped[grouped.length - 1] += '\n' + html;
      } else {
        grouped.push(html);
      }
    }

    for (const entryHtml of grouped) {
      allEntries.push({ entryHtml, activationType, isPassive });
    }
  }

  for (const { entryHtml, activationType, isPassive } of allEntries) {
    items.push(
      ...(await buildItemsFromEntry(entryHtml, activationType, isPassive, spellNameToItemId, sb.name, onProgress, aiStats)),
    );
  }

  return items;
}

interface SpellRef {
  lookup: string;  // bare spell name for compendium lookup
  display: string; // name + qualifier for the Foundry item ("levitate (self only)")
}

/**
 * Extract spells from /spells/ links in a merged spellcasting entry element.
 * Each line of the text content corresponds to one original paragraph; the
 * line prefix determines the casting method and slot limit for the links on
 * that line.  Any parenthetical qualifier immediately following a link
 * ("(self only)", "(Slaad Form Only)") is captured in SpellRef.display so
 * the actor item can be named accordingly while the bare name is still used
 * for compendium lookup.  Returns an empty array when no /spells/ links are found.
 */
function extractSpellsFromLinks(
  el: Element,
): Array<{ method: string; limit: number; spells: SpellRef[] }> {
  const allLinks = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href*="/spells/"]'));
  if (allLinks.length === 0) return [];

  const result: Array<{ method: string; limit: number; spells: SpellRef[] }> = [];
  const lines = (el.textContent ?? '').split('\n');
  let linkIdx = 0;

  for (const line of lines) {
    if (linkIdx >= allLinks.length) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Determine method and limit from the line prefix
    let method: string | null = null;
    let limit = 0;
    const perDayM = trimmed.match(/^(\d+)\s*\/\s*day(?:\s+each)?\s*:/i);
    if (/^at will\s*:/i.test(trimmed)) {
      method = 'atwill';
    } else if (perDayM) {
      method = 'innate'; limit = parseInt(perDayM[1], 10);
    } else if (/^cantrips?\s*(?:\([^)]*\))?\s*:/i.test(trimmed)) {
      method = 'atwill';
    } else if (/^\d+(?:st|nd|rd|th)\s+level\s*(?:\([^)]*\))?\s*:/i.test(trimmed)) {
      method = 'prepared';
    }

    // Advance through links that appear on this line, capturing qualifiers.
    const lineLower = trimmed.toLowerCase();
    const lineSpells: SpellRef[] = [];
    let searchFrom = 0;
    while (linkIdx < allLinks.length) {
      const lt = (allLinks[linkIdx].textContent ?? '').trim().toLowerCase();
      if (!lt) { linkIdx++; continue; }
      const ltPos = lineLower.indexOf(lt, searchFrom);
      if (ltPos === -1) break;

      // Capture any parenthetical qualifier immediately after the link text
      const afterLink = lineLower.slice(ltPos + lt.length);
      const qualM = afterLink.match(/^\s*(\([^)]+\))/);
      const qualifier = qualM ? qualM[1] : '';
      const display = qualifier ? `${lt} ${qualifier}` : lt;

      if (method !== null) lineSpells.push({ lookup: lt, display });
      searchFrom = ltPos + lt.length + (qualM?.[0].length ?? 0);
      linkIdx++;
    }
    if (lineSpells.length) result.push({ method: method!, limit, spells: lineSpells });
  }

  return result;
}

async function buildItemsFromEntry(
  entryHtml: string,
  activationType: string | null,
  isPassive: boolean,
  spellNameToItemId: Map<string, string>,
  actorName?: string,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
): Promise<Record<string, unknown>[]> {
  // Use <div> wrapper so that entries merged across multiple paragraphs (joined
  // with \n by buildItems) are valid HTML — <p> cannot contain block siblings.
  const scratch = new DOMParser().parseFromString(`<div>${entryHtml}</div>`, 'text/html');
  const el = scratch.body.firstElementChild ?? scratch.body;
  const text = el.textContent ?? '';

  const rawName = extractEntryName(el);
  if (!rawName) return [];
  const { name, uses, activationCost } = parseNameParens(rawName);

  const progress = (phase: string) => {
    if (actorName) onProgress?.(`Building actors: ${actorName}: action ${name}: ${phase}`);
  };

  progress('parse');

  // Strip form-restriction parentheticals for lookup ("Bite (Slaad Form Only)" → "Bite").
  // parseNameParens already removed usage parens (Recharge, X/Day, Costs X Actions),
  // so anything remaining in parens is a qualifier that shouldn't affect the lookup.
  const lookupName = name.replace(/\s*\([^)]+\)/g, '').trim() || name;

  // Build description: each merged segment (separated by \n) gets its own <p>
  const descHtml = entryHtml.split('\n').map((h) => `<p>${h}</p>`).join('');

  // Weapon attacks: compendium descriptions never match stat block attack text.
  // Skip findInCompendium entirely — only fetch the image from the pack index.
  const isMelee = /melee\s+weapon\s+attack/i.test(text);
  const isRanged = /ranged\s+weapon\s+attack/i.test(text);

  let compendiumItem: Record<string, unknown> | null = null;
  let fallbackImg: string | null = null;
  const useAi = AiLookup.isAvailable() && AiLookup.isEnabled() && AiLookup.isConfigured();

  if (isMelee || isRanged) {
    fallbackImg = await lookupImg(lookupName);
  } else {
    if (useAi) progress('semantic AI search');
    ({ item: compendiumItem, img: fallbackImg } = await findInCompendium(lookupName, text, { useAi, aiStats }));
  }

  if (compendiumItem) {
    if (uses) {
      const sys = (compendiumItem.system as Record<string, unknown>) ?? {};
      compendiumItem.system = { ...sys, uses };
    }
    if (activationCost !== 1) {
      const acts = ((compendiumItem.system as any)?.activities ?? {}) as Record<string, any>;
      for (const act of Object.values(acts)) {
        if (act?.activation) act.activation.value = activationCost;
      }
    }
    return [compendiumItem];
  }

  // Normal build path — collect into `built` so fallbackImg can be applied uniformly
  let built: Record<string, unknown>[];

  // Spell attacks — only entries with a /spells/ link are real compendium spells.
  // Custom monster actions like "Fire Ray. Ranged Spell Attack:" have no such link → weapon.
  const isMeleeSpell = /melee\s+spell\s+attack/i.test(text);
  const isRangedSpell = /ranged\s+spell\s+attack/i.test(text);
  if (isMeleeSpell || isRangedSpell) {
    const spellLink = el.querySelector<HTMLAnchorElement>('a[href*="/spells/"]');
    if (spellLink) {
      // Real spell — use link text as canonical name (avoids "(Cantrip)" from <strong>)
      const spellName = spellLink.textContent?.trim() ?? name;
      const spellItem = await ItemBuilder.getSpellForActor(spellName, 'atwill', 0, spellNameToItemId);
      built = spellItem ? [spellItem] : [buildAttackItem(spellName, entryHtml, isMeleeSpell, 'spell')];
    } else {
      // No spell link → custom weapon attack (Fire Ray, Claw, etc.)
      built = [buildAttackItem(name, entryHtml, isMeleeSpell, 'weapon', uses, activationCost)];
    }
  } else if (isMelee || isRanged) {
    built = [buildAttackItem(name, entryHtml, isMelee, 'weapon', uses, activationCost)];
  } else {
    // Spellcasting feature — /spells/ links are the canonical source; fall back to
    // text parsing only when no links are present (e.g. older inline stat blocks).
    const linkGroups = extractSpellsFromLinks(el);
    const textGroups = linkGroups.length === 0 ? ItemBuilder.parseSpellLists(text) : [];

    if (linkGroups.length > 0 || textGroups.length > 0) {
      const spellResult: Record<string, unknown>[] = [];
      spellResult.push(buildFeatItem(name, descHtml, activationType, isPassive, uses, activationCost));
      const seen = new Set<string>();

      if (linkGroups.length > 0) {
        for (const { method, limit, spells } of linkGroups) {
          for (const spell of spells) {
            if (seen.has(spell.lookup)) continue;
            seen.add(spell.lookup);
            const spellItem = await ItemBuilder.getSpellForActor(spell.lookup, method, limit, spellNameToItemId);
            if (spellItem) {
              if (spell.display !== spell.lookup) {
                spellItem.name = (spellItem.name as string) + spell.display.slice(spell.lookup.length);
              }
              spellResult.push(spellItem);
            }
          }
        }
      } else {
        for (const { method, limit, spells } of textGroups) {
          for (const spellName of spells) {
            if (seen.has(spellName)) continue;
            seen.add(spellName);
            const spellItem = await ItemBuilder.getSpellForActor(spellName, method, limit, spellNameToItemId);
            if (spellItem) spellResult.push(spellItem);
          }
        }
      }

      built = spellResult;
    } else {
      const saveM = text.match(
        /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw/i,
      );
      built = saveM
        ? [buildSaveItem(name, descHtml, activationType, saveM, text, uses, activationCost)]
        : [buildFeatItem(name, descHtml, activationType, isPassive, uses, activationCost)];
    }
  }

  if (fallbackImg) {
    for (const item of built) {
      if (!item.img) item.img = fallbackImg;
    }
  } else if (useAi && aiStats) {
    progress('AI icon search');
    const iconType = (isMelee || isRanged) ? 'weapon' : 'feat';
    const suggested = await AiLookup.suggestIcon(name, text, aiStats, iconType);
    if (suggested) {
      for (const item of built) {
        if (!item.img) item.img = suggested;
      }
    }
  }
  return built;
}

// ── Attack item (weapons and spell-attack fallbacks) ──────────────────────────

function spanToDamagePart(span: HTMLElement): Record<string, unknown> {
  const formula = cleanFormula(span.getAttribute('data-dicenotation') ?? '');
  const rawType = span.getAttribute('data-rolldamagetype') ?? '';
  const dmgType = DAMAGE_TYPE_MAP[rawType.toLowerCase()] ?? rawType.toLowerCase();
  return {
    number: null,
    denomination: null,
    bonus: '',
    types: dmgType ? [dmgType] : [],
    custom: { enabled: true, formula },
    scaling: { mode: '', number: null, formula: '' },
  };
}

function buildAttackItem(
  name: string,
  entryHtml: string,
  isMelee: boolean,
  classification: 'weapon' | 'spell',
  uses: UsesConfig | null = null,
  activationCost = 1,
): Record<string, unknown> {
  const scratch = new DOMParser().parseFromString(`<p>${entryHtml}</p>`, 'text/html');
  const text = scratch.body.textContent ?? '';

  // Attack bonus — DDB encodes it in data-dicenotation span; fall back to regex
  const hitSpan = scratch.querySelector<HTMLElement>('[data-rolltype="to hit"]');
  const attackBonus = hitSpan
    ? (hitSpan.textContent?.trim().replace(/^\+/, '') ?? '0')
    : (text.match(/([+-]\d+)\s+to\s+hit/i)?.[1]?.replace('+', '') ?? '0');

  // Damage — all [data-rolltype="damage"] spans; first = base, rest = extra parts
  const dmgSpans = Array.from(scratch.querySelectorAll<HTMLElement>('[data-rolltype="damage"]'));
  let damageBase: Record<string, unknown>;
  let extraParts: Record<string, unknown>[];

  if (dmgSpans.length > 0) {
    damageBase = spanToDamagePart(dmgSpans[0]);
    extraParts = dmgSpans.slice(1).map(spanToDamagePart);
  } else {
    // Regex fallback — primary damage
    const m = text.match(/[Hh]it.*?(\d+)\s*\(([^)]+)\)\s+([\w]+)\s+damage/);
    damageBase = m
      ? {
          number: null,
          denomination: null,
          bonus: '',
          types: [DAMAGE_TYPE_MAP[m[3].toLowerCase()] ?? m[3].toLowerCase()],
          custom: { enabled: true, formula: cleanFormula(m[2].trim()) },
          scaling: { mode: '', number: null, formula: '' },
        }
      : { number: null, denomination: null, bonus: '', types: [], custom: { enabled: false, formula: '' }, scaling: { mode: '', number: null, formula: '' } };

    // Regex fallback — additional "plus N (XdY) type damage" parts
    extraParts = [];
    const plusRe = /\bplus\s+\d+\s+\(([^)]+)\)\s+([\w]+)\s+damage/gi;
    let pm: RegExpExecArray | null;
    while ((pm = plusRe.exec(text)) !== null) {
      const dmgType = DAMAGE_TYPE_MAP[pm[2].toLowerCase()] ?? pm[2].toLowerCase();
      extraParts.push({
        number: null,
        denomination: null,
        bonus: '',
        types: dmgType ? [dmgType] : [],
        custom: { enabled: true, formula: cleanFormula(pm[1].trim()) },
        scaling: { mode: '', number: null, formula: '' },
      });
    }
  }

  const reachM = text.match(/reach\s+(\d+)\s+ft/i);
  const rangeM = text.match(/range\s+(\d+)(?:\/(\d+))?\s+ft/i);

  const activityId = foundry.utils.randomID();
  return {
    name,
    type: 'weapon',
    system: {
      description: { value: `<p>${entryHtml}</p>` },
      equipped: true,
      proficient: null,
      type: { value: 'natural' },
      properties: new Set<string>(),
      damage: { base: damageBase },
      range: {
        reach: reachM ? parseInt(reachM[1], 10) : isMelee ? 5 : null,
        value: rangeM ? parseInt(rangeM[1], 10) : null,
        long: rangeM?.[2] ? parseInt(rangeM[2], 10) : null,
        units: 'ft',
      },
      activities: {
        [activityId]: {
          type: 'attack',
          activation: { type: 'action', value: activationCost },
          attack: {
            bonus: attackBonus,
            flat: true,
            type: { value: isMelee ? 'melee' : 'ranged', classification },
          },
          damage: { includeBase: true, parts: extraParts },
        },
      },
      ...(uses ? { uses } : {}),
    },
  };
}

// ── Save item ─────────────────────────────────────────────────────────────────

function buildSaveItem(
  name: string,
  descHtml: string,
  activationType: string | null,
  saveMatch: RegExpMatchArray,
  text: string,
  uses: UsesConfig | null,
  activationCost = 1,
): Record<string, unknown> {
  const dc = parseInt(saveMatch[1], 10);
  const ability = FULL_ABILITY_MAP[saveMatch[2].toLowerCase()] ?? 'dex';

  // Damage: "take/takes/taking 28 (8d6) lightning damage" or "or take 44 (8d10) psychic damage"
  const dmgM = text.match(/tak(?:e|es|ing)\s+\d+\s+\(([^)]+)\)\s+([\w]+)\s+damage/i);
  const parts: Record<string, unknown>[] = [];
  if (dmgM) {
    const formula = cleanFormula(dmgM[1].trim());
    const dmgType = DAMAGE_TYPE_MAP[dmgM[2].toLowerCase()] ?? dmgM[2].toLowerCase();
    const diceM = formula.match(/^(\d+)d(\d+)(?:\s*([+-]\s*\d+))?$/i);
    if (diceM) {
      parts.push({
        number: parseInt(diceM[1], 10),
        denomination: parseInt(diceM[2], 10),
        bonus: diceM[3]?.replace(/\s/g, '') ?? '',
        types: dmgType ? [dmgType] : [],
      });
    }
  }

  const onSave = /\bhalf\b.*?\bdamage\b|\bdamage\b.*?\bhalf\b/i.test(text) ? 'half' : 'none';

  // Template: "20-foot-radius sphere" or "10-foot cone"
  const sphereM = text.match(/(\d+)[\s-]foot[\s-]radius\s+(sphere|emanation)/i);
  const shapeM = !sphereM ? text.match(/(\d+)[\s-]foot[\s-](cone|cube|cylinder|line)/i) : null;
  const templateMatch = sphereM ?? shapeM;
  const template = templateMatch
    ? {
        type: AREA_TYPE_MAP[templateMatch[2].toLowerCase()] ?? templateMatch[2].toLowerCase(),
        size: String(parseInt(templateMatch[1], 10)),
        units: 'ft',
      }
    : null;

  const activityId = foundry.utils.randomID();
  const activity: Record<string, unknown> = {
    type: 'save',
    activation: { type: activationType ?? 'action', value: activationCost },
    save: {
      ability: [ability],
      dc: { calculation: '', formula: String(dc) },
    },
    damage: { parts, onSave },
    ...(template ? { target: { template, affects: {} } } : {}),
  };

  const system: Record<string, unknown> = {
    description: { value: descHtml },
    activities: { [activityId]: activity },
    ...(uses ? { uses } : {}),
  };

  return { name, type: 'feat', system };
}

// ── Feat item ─────────────────────────────────────────────────────────────────

function buildFeatItem(
  name: string,
  descHtml: string,
  activationType: string | null,
  isPassive: boolean,
  uses: UsesConfig | null = null,
  activationCost = 1,
): Record<string, unknown> {
  const activities: Record<string, unknown> = {};

  if (!isPassive && activationType) {
    const actId = foundry.utils.randomID();
    activities[actId] = {
      type: 'utility',
      activation: { type: activationType, value: activationCost },
    };
  }

  return {
    name,
    type: 'feat',
    system: {
      description: { value: descHtml },
      ...(Object.keys(activities).length > 0 ? { activities } : {}),
      ...(uses ? { uses } : {}),
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

// ── Entry name extraction ─────────────────────────────────────────────────────

/**
 * Extract the ability name from a stat-block entry element.
 *
 * DDB structures names as one or more <strong> elements (sometimes wrapped in
 * an <em>), followed by a period that terminates the name:
 *
 *   <strong>Multiattack.</strong> The goblin makes…
 *   <em><strong>Claw.</strong> Melee Weapon Attack:…</em>
 *   <em><strong>Shadow</strong><strong> Blade.</strong> Melee…</em>
 *
 * The function collects <strong> text until it finds a period, recursing into
 * <em> when encountered.  It stops as soon as non-whitespace plain text appears
 * after the opening strongs, so later bolded text in the description is ignored.
 */
function extractEntryName(el: Element): string {
  let collected = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === 'EM') {
        const inner = extractEntryName(child);
        if (inner) return inner;
      } else if (child.tagName === 'STRONG') {
        const t = child.textContent ?? '';
        const dot = t.indexOf('.');
        if (dot !== -1) return (collected + t.slice(0, dot)).trim();
        collected += t;
      } else if (collected) {
        break;
      }
    } else if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() && collected) {
      break;
    }
  }
  return collected.replace(/\.$/, '').trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface UsesConfig {
  max: string;
  spent: number;
  recovery: Array<{ period: string; type: string; formula?: string }>;
}

interface NameParsed {
  name: string;
  uses: UsesConfig | null;
  activationCost: number;
}

/**
 * Strip parenthetical usage/recharge/cost annotations from a raw ability name
 * and convert them to structured dnd5e data.
 *
 * Handled patterns (case-insensitive):
 *   (X/Day)                                → day recovery, max X
 *   (X/Short Rest) / (X/Long Rest)         → sr / lr recovery, max X
 *   (Recharge X-Y) / (Recharge X)          → recharge period, formula = X (min d6 roll)
 *   (Recharges after a Short or Long Rest) → sr recovery, max 1
 *   (Recharges after a Long Rest)          → lr recovery, max 1
 *   (Recharges after a Short Rest)         → sr recovery, max 1
 *   (Costs X Actions)                      → activationCost = X
 */
function parseNameParens(rawName: string): NameParsed {
  let s = rawName.replace(/\.$/, '');
  let uses: UsesConfig | null = null;
  let activationCost = 1;

  // (X/Day), (X/Short Rest), (X/Long Rest)
  s = s.replace(/\s*\((\d+)\s*\/\s*(day|short\s+rest|long\s+rest)s?\)/gi, (_, n, period) => {
    if (!uses) {
      const p = /short/i.test(period) ? 'sr' : /long/i.test(period) ? 'lr' : 'day';
      uses = { max: n, spent: 0, recovery: [{ period: p, type: 'recoverAll' }] };
    }
    return '';
  });

  // (Recharge X-Y) or (Recharge X) — X is the minimum roll on a d6
  s = s.replace(/\s*\(Recharge\s+(\d+)(?:\s*[–\-]\s*\d+)?\)/gi, (_, min) => {
    if (!uses) {
      uses = { max: '1', spent: 0, recovery: [{ period: 'recharge', type: 'recoverAll', formula: min }] };
    }
    return '';
  });

  // (Recharges after a Short or Long Rest) / (Recharges after a Long Rest) / (Recharges after a Short Rest)
  s = s.replace(/\s*\(Recharges?\s+after\s+[^)]+Rest\)/gi, (match) => {
    if (!uses) {
      const p = /short/i.test(match) ? 'sr' : 'lr';
      uses = { max: '1', spent: 0, recovery: [{ period: p, type: 'recoverAll' }] };
    }
    return '';
  });

  // (Costs X Actions) — for legendary actions
  s = s.replace(/\s*\(Costs?\s+(\d+)\s+Actions?\)/gi, (_, n) => {
    activationCost = parseInt(n, 10);
    return '';
  });

  return { name: s.trim(), uses, activationCost };
}

/** Replace Unicode minus/dash variants with ASCII hyphen so Foundry accepts formulas. */
function cleanFormula(s: string): string {
  return s.replace(/[−–—]/g, '-');
}

function parseCr(cr: string): number {
  if (!cr) return 0;
  if (cr.includes('/')) {
    const [n, d] = cr.split('/').map(Number);
    return d ? n / d : 0;
  }
  return parseFloat(cr) || 0;
}
