import { ParsedStatBlock } from '../../types.js';
import { SKILL_MAP } from './maps.js';

export function parseMovement(speed: string): Record<string, number> {
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

export function parseSenses(sb: ParsedStatBlock): { ranges: Record<string, number>; special: string } {
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

export function parseSkills(sb: ParsedStatBlock): Record<string, { value: number; ability: string }> {
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
