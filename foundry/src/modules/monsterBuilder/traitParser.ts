import { ParsedStatBlock } from '../../types.js';
import { DAMAGE_TYPE_MAP, CONDITION_MAP, LANGUAGE_MAP } from './maps.js';

export interface TraitResult {
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

export function parseTraits(sb: ParsedStatBlock): TraitResult {
  const result: TraitResult = {
    di: [], diCustom: '', diBypasses: [],
    dr: [], drCustom: '', drBypasses: [],
    dv: [], dvCustom: '',
    ci: [], ciCustom: '',
    languages: [], langCustom: '',
  };

  for (const { label, value } of sb.data) {
    switch (label) {
      case 'Damage Immunities': {
        const { known, custom, bypasses } = parseDamageList(value);
        result.di = known; result.diCustom = custom; result.diBypasses = bypasses;
        break;
      }
      case 'Damage Resistances': {
        const { known, custom, bypasses } = parseDamageList(value);
        result.dr = known; result.drCustom = custom; result.drBypasses = bypasses;
        break;
      }
      case 'Damage Vulnerabilities': {
        const { known, custom } = parseDamageList(value);
        result.dv = known; result.dvCustom = custom;
        break;
      }
      case 'Condition Immunities': {
        const { known, custom } = parseConditionList(value);
        result.ci = known; result.ciCustom = custom;
        break;
      }
      case 'Languages': {
        const { known, custom } = parseLanguageList(value);
        result.languages = known; result.langCustom = custom;
        break;
      }
    }
  }
  return result;
}

export function parseDamageList(text: string): { known: string[]; custom: string; bypasses: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  const bypasses: string[] = [];

  // DDB uses semicolons to separate distinct clauses.  Drop any clause that ends with a
  // "(from SpellName)" parenthetical — those are conditional resistances from active spells,
  // not permanent traits (e.g. Archmage: "Nonmagical BPS (from Stoneskin)").
  const clauses = text.split(/;/).filter(c => !/\(\s*from\s+\w/i.test(c));
  const filtered = clauses.join(',');

  if (/nonmagical/i.test(filtered)) bypasses.push('mgc');
  if (/silvered/i.test(filtered)) bypasses.push('sil');
  if (/adamantine/i.test(filtered)) bypasses.push('ada');

  for (const part of filtered.split(/[,]/)) {
    const clean = part.trim().toLowerCase().replace(/^(and|or)\s+/, '');
    for (const seg of clean.split(/\s+(?:and|or)\s+/)) {
      const s = seg.trim();
      const matched = Object.keys(DAMAGE_TYPE_MAP).find((k) => s.startsWith(k));
      if (matched) {
        known.push(DAMAGE_TYPE_MAP[matched]);
      } else if (s && !/^(from|that|aren't|nonmagical|weapon|attacks?|silvered|adamantine)\b/i.test(s)) {
        unknown.push(seg.trim());
      }
    }
  }

  return { known, bypasses, custom: unknown.join(', ') };
}

export function parseConditionList(text: string): { known: string[]; custom: string } {
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

export function parseLanguageList(text: string): { known: string[]; custom: string } {
  const known: string[] = [];
  const cantSpeakParts: string[] = [];
  const genuineUnknown: string[] = [];
  let hasOpenQualifier = false;

  // Normalize typographic quotes (DDB sometimes uses curly apostrophes/quotes)
  const norm = text.replace(/’/g, "'").replace(/‘/g, "'");

  // Split on "understands" to separate spoken languages from understood-only ones.
  // E.g. "Goblin, understands Common and Giant but can't speak them"
  const uIdx = norm.search(/\bunderstands?\b/i);
  const speaksPart = uIdx >= 0 ? norm.slice(0, uIdx) : norm;
  const understandsPart = uIdx >= 0 ? norm.slice(uIdx) : '';
  const isCantSpeak = /\bbut\s+(?:can(?:'t|not)\s+speak|doesn'?t\s+speak)\b/i.test(understandsPart);

  const addSpoken = (raw: string): void => {
    let clean = raw.trim().toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || /^(and|or|but)\b/.test(clean)) return;
    if (/^plus\b.+\blanguages?\b/i.test(clean) || /\s+plus\s+.+\blanguages?\b/i.test(clean)) {
      hasOpenQualifier = true;
      clean = clean.replace(/\s+plus\s+.+$/, '').trim();
      if (!clean) return;
    } else if (/^plus\b/.test(clean)) {
      return;
    } else {
      clean = clean.replace(/\s+plus\s+.+$/, '').trim();
    }
    const key = LANGUAGE_MAP[clean];
    if (key) {
      known.push(key);
    } else if (clean && !/^\d/.test(clean)) {
      genuineUnknown.push(clean);
    }
  };

  for (const part of speaksPart.split(/[,;]/)) {
    addSpoken(part);
  }

  if (understandsPart) {
    const afterUnderstands = understandsPart
      .replace(/\bunderstands?\s+/i, '')
      .replace(/\s*but\s+.+$/i, '')
      .trim();
    if (isCantSpeak) {
      // "understands X and Y but can't speak" — store as custom text only, not in value[]
      for (const part of afterUnderstands.split(/[,;]|\s+and\s+/)) {
        const clean = part.trim();
        if (clean && !/^(and|or|but)\b/.test(clean.toLowerCase())) cantSpeakParts.push(clean);
      }
    } else {
      // "understands all languages" without restriction — treat as spoken
      for (const part of afterUnderstands.split(/[,;]/)) {
        addSpoken(part);
      }
    }
  }

  // Emit the "custom" enum key when:
  //   - There are open language qualifiers ("plus any two languages") — unstated extras
  //   - The creature has BOTH spoken languages and understood-only ones (mixed speak)
  const hasMixedSpeak = cantSpeakParts.length > 0 && known.length > 0;
  if (hasOpenQualifier || hasMixedSpeak) known.push('custom');

  return { known, custom: [...cantSpeakParts, ...genuineUnknown].join(', ') };
}
