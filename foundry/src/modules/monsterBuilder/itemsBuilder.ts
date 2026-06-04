import { ParsedStatBlock } from '../../types.js';
import { ItemBuilder } from '../ItemBuilder.js';
import { findInCompendium, lookupImg, AiStats } from '../CompendiumLookup.js';
import { AiLookup } from '../AiLookup.js';
import { DAMAGE_TYPE_MAP, SECTION_ACTIVATION, FULL_ABILITY_MAP, AREA_TYPE_MAP } from './maps.js';
import { UsesConfig, cleanFormula, parseNameParens, extractEntryName, buildArmorItems } from './helpers.js';

interface SpellRef {
  lookup: string;
  display: string;
}

function spanToDamagePart(span: HTMLElement): Record<string, unknown> {
  const formula = cleanFormula(span.getAttribute('data-dicenotation') ?? '');
  const rawType = span.getAttribute('data-rolldamagetype') ?? '';
  const dmgType = DAMAGE_TYPE_MAP[rawType.toLowerCase()] ?? rawType.toLowerCase();
  return {
    number: null, denomination: null, bonus: '',
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

  const hitSpan = scratch.querySelector<HTMLElement>('[data-rolltype="to hit"]');
  const attackBonus = hitSpan
    ? (hitSpan.textContent?.trim().replace(/^\+/, '') ?? '0')
    : (text.match(/([+-]\d+)\s+to\s+hit/i)?.[1]?.replace('+', '') ?? '0');

  const dmgSpans = Array.from(scratch.querySelectorAll<HTMLElement>('[data-rolltype="damage"]'));
  let damageBase: Record<string, unknown>;
  let extraParts: Record<string, unknown>[];

  if (dmgSpans.length > 0) {
    damageBase = spanToDamagePart(dmgSpans[0]);
    extraParts = dmgSpans.slice(1).map(spanToDamagePart);
  } else {
    const m = text.match(/[Hh]it.*?(\d+)\s*\(([^)]+)\)\s+([\w]+)\s+damage/);
    damageBase = m
      ? {
          number: null, denomination: null, bonus: '',
          types: [DAMAGE_TYPE_MAP[m[3].toLowerCase()] ?? m[3].toLowerCase()],
          custom: { enabled: true, formula: cleanFormula(m[2].trim()) },
          scaling: { mode: '', number: null, formula: '' },
        }
      : { number: null, denomination: null, bonus: '', types: [], custom: { enabled: false, formula: '' }, scaling: { mode: '', number: null, formula: '' } };

    extraParts = [];
    const plusRe = /\bplus\s+\d+\s+\(([^)]+)\)\s+([\w]+)\s+damage/gi;
    let pm: RegExpExecArray | null;
    while ((pm = plusRe.exec(text)) !== null) {
      const dmgType = DAMAGE_TYPE_MAP[pm[2].toLowerCase()] ?? pm[2].toLowerCase();
      extraParts.push({
        number: null, denomination: null, bonus: '',
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
            bonus: '',
            flat: false,
            type: { value: isMelee ? 'melee' : 'ranged', classification },
          },
          damage: { includeBase: true, parts: extraParts },
        },
      },
      ...(uses ? { uses } : {}),
    },
  };
}

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

  return { name, type: 'feat', system: { description: { value: descHtml }, activities: { [activityId]: activity }, ...(uses ? { uses } : {}) } };
}

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

/**
 * Extract spells from /spells/ links in a merged spellcasting entry element.
 */
export function extractSpellsFromLinks(
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
    } else if (/innately cast/i.test(trimmed)) {
      const inlinePerDay = trimmed.match(/\((\d+)\s*\/\s*day\b/i);
      method = 'innate';
      limit = inlinePerDay ? parseInt(inlinePerDay[1], 10) : 1;
    }

    const lineLower = trimmed.toLowerCase();
    const lineSpells: SpellRef[] = [];
    let searchFrom = 0;
    while (linkIdx < allLinks.length) {
      const lt = (allLinks[linkIdx].textContent ?? '').trim().toLowerCase();
      if (!lt) { linkIdx++; continue; }
      const ltPos = lineLower.indexOf(lt, searchFrom);
      if (ltPos === -1) break;

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

export async function buildItems(
  sb: ParsedStatBlock,
  spellNameToItemId: Map<string, string>,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
  skipAi = false,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];

  type Grouped = { entryHtml: string; activationType: string | null; isPassive: boolean };
  const allEntries: Grouped[] = [];

  for (const section of sb.sections) {
    const headingLower = section.heading.toLowerCase();
    const activationType = SECTION_ACTIVATION[headingLower] ?? null;
    const isPassive = !activationType && headingLower !== 'actions';

    if (headingLower === 'legendary actions' || headingLower === 'lair actions') {
      const firstHtml = section.entries[0] ?? '';
      const firstDoc = new DOMParser().parseFromString(`<div>${firstHtml}</div>`, 'text/html');
      const firstEl = firstDoc.body.firstElementChild ?? firstDoc.body;
      const isUnnamed = !extractEntryName(firstEl);
      const description = isUnnamed ? (firstEl.textContent?.trim() ?? '') : '';
      items.push({
        name: section.heading,
        type: 'feat',
        system: {
          description: { value: description ? `<p>${description}</p>` : '' },
          activation: { type: '', cost: null },
        },
      });
    }

    const grouped: string[] = [];
    let suboptionKeyword: string | null = null;
    for (const html of section.entries) {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const el = doc.body.firstElementChild ?? doc.body;
      const rawName = extractEntryName(el);
      const hasName = !!rawName;
      const fullText = (el.textContent ?? '').toLowerCase();

      const isSuboption =
        suboptionKeyword !== null &&
        hasName &&
        grouped.length > 0 &&
        rawName.toLowerCase().includes(suboptionKeyword);

      if ((!hasName && grouped.length > 0) || isSuboption) {
        grouped[grouped.length - 1] += '\n' + html;
      } else {
        grouped.push(html);
        const followingMatch = fullText.match(/one of the following\s+(\w+)/);
        suboptionKeyword = followingMatch ? followingMatch[1].replace(/s$/, '') : null;
      }
    }

    for (const entryHtml of grouped) {
      allEntries.push({ entryHtml, activationType, isPassive });
    }
  }

  for (const { entryHtml, activationType, isPassive } of allEntries) {
    items.push(
      ...(await buildItemsFromEntry(entryHtml, activationType, isPassive, spellNameToItemId, sb.name, onProgress, aiStats, skipAi)),
    );
  }

  items.push(...buildArmorItems(sb.acNote));
  return items;
}

export async function buildItemsFromEntry(
  entryHtml: string,
  activationType: string | null,
  isPassive: boolean,
  spellNameToItemId: Map<string, string>,
  actorName?: string,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
  skipAi = false,
): Promise<Record<string, unknown>[]> {
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

  const lookupName = name.replace(/\s*\([^)]+\)/g, '').trim() || name;
  const descHtml = entryHtml.split('\n').map((h) => `<p>${h}</p>`).join('');

  const isMelee = /melee\s+weapon\s+attack/i.test(text);
  const isRanged = /ranged\s+weapon\s+attack/i.test(text);

  let compendiumItem: Record<string, unknown> | null = null;
  let fallbackImg: string | null = null;
  const useAi = !skipAi && AiLookup.isAvailable() && AiLookup.isEnabled() && AiLookup.isConfigured();

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

  let built: Record<string, unknown>[];

  const isMeleeSpell = /melee\s+spell\s+attack/i.test(text);
  const isRangedSpell = /ranged\s+spell\s+attack/i.test(text);
  if (isMeleeSpell || isRangedSpell) {
    const spellLink = el.querySelector<HTMLAnchorElement>('a[href*="/spells/"]');
    if (spellLink) {
      const spellName = spellLink.textContent?.trim() ?? name;
      const spellItem = await ItemBuilder.getSpellForActor(spellName, 'atwill', 0, spellNameToItemId);
      built = spellItem ? [spellItem] : [buildAttackItem(spellName, entryHtml, isMeleeSpell, 'spell')];
    } else {
      built = [buildAttackItem(name, entryHtml, isMeleeSpell, 'weapon', uses, activationCost)];
    }
  } else if (isMelee || isRanged) {
    built = [buildAttackItem(name, entryHtml, isMelee, 'weapon', uses, activationCost)];
  } else {
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
