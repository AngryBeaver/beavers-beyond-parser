import { ParsedStatBlock } from '../../types.js';
import { AiStats } from '../CompendiumLookup.js';
import { parseMovement, parseSenses, parseSkills } from './statParser.js';
import { parseTraits } from './traitParser.js';
import { buildItems } from './itemsBuilder.js';
import { cleanFormula, parseCr } from './helpers.js';
import { importFolder } from '../ImportFolders.js';

/** dnd5e 6.0 moved the movement speeds from `movement.walk` etc. into `movement.speeds`. */
function movementData(speeds: Record<string, number>): Record<string, unknown> {
  const hasSpeedsField = !foundry.utils.isNewerVersion('6.0.0', game.system?.version ?? '0');
  return { ...(hasSpeedsField ? { speeds } : speeds), units: 'ft' };
}

export async function buildActorData(
  sb: ParsedStatBlock,
  folderId: string | null,
  spellNameToItemId: Map<string, string>,
  onProgress?: (msg: string) => void,
  aiStats?: AiStats,
  skipAi = false,
): Promise<Record<string, unknown>> {
  const movement = parseMovement(sb.speed);
  const senses = parseSenses(sb);
  const traits = parseTraits(sb);
  const skills = parseSkills(sb);
  const items = await buildItems(sb, spellNameToItemId, onProgress, aiStats, skipAi);

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
        movement: movementData(movement),
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

export async function findInPacks(monsterName: string): Promise<string | null> {
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

export async function findOrCreateDndBeyondActorFolder(): Promise<string | null> {
  return importFolder('Actor');
}
