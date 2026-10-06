import { ARMOR_NAME_MAP } from './maps.js';

export interface UsesConfig {
  max: string;
  spent: number;
  recovery: Array<{ period: string; type: string; formula?: string }>;
}

export interface NameParsed {
  name: string;
  uses: UsesConfig | null;
  activationCost: number;
}

/** Replace Unicode minus/dash variants with ASCII hyphen so Foundry accepts formulas. */
export function cleanFormula(s: string): string {
  return s.replace(/[−–—]/g, '-');
}

export function parseCr(cr: string): number {
  if (!cr) return 0;
  if (cr.includes('/')) {
    const [n, d] = cr.split('/').map(Number);
    return d ? n / d : 0;
  }
  return parseFloat(cr) || 0;
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
export function parseNameParens(rawName: string): NameParsed {
  let s = rawName.replace(/\.$/, '');
  let uses: UsesConfig | null = null;
  let activationCost = 1;

  s = s.replace(/\s*\((\d+)\s*\/\s*(day|short\s+rest|long\s+rest)s?\)/gi, (_, n, period) => {
    if (!uses) {
      const p = /short/i.test(period) ? 'sr' : /long/i.test(period) ? 'lr' : 'day';
      uses = { max: n, spent: 0, recovery: [{ period: p, type: 'recoverAll' }] };
    }
    return '';
  });

  s = s.replace(/\s*\(Recharge\s+(\d+)(?:\s*[–\-]\s*\d+)?\)/gi, (_, min) => {
    if (!uses) {
      uses = {
        max: '1',
        spent: 0,
        recovery: [{ period: 'recharge', type: 'recoverAll', formula: min }],
      };
    }
    return '';
  });

  s = s.replace(/\s*\(Recharges?\s+after\s+[^)]+Rest\)/gi, (match) => {
    if (!uses) {
      const p = /short/i.test(match) ? 'sr' : 'lr';
      uses = { max: '1', spent: 0, recovery: [{ period: p, type: 'recoverAll' }] };
    }
    return '';
  });

  s = s.replace(/\s*\(Costs?\s+(\d+)\s+Actions?\)/gi, (_, n) => {
    activationCost = parseInt(n, 10);
    return '';
  });

  return { name: s.trim(), uses, activationCost };
}

/**
 * Extract the ability name from a stat-block entry element.
 *
 * DDB structures names as one or more <strong> elements (sometimes wrapped in
 * an <em>), followed by a period that terminates the name.
 */
export function extractEntryName(el: Element): string {
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

export function buildArmorItems(acNote: string): Record<string, unknown>[] {
  if (!acNote) return [];
  const items: Record<string, unknown>[] = [];
  for (const part of acNote.split(/[,+]/)) {
    const key = part.trim().toLowerCase();
    const canonicalName = ARMOR_NAME_MAP[key];
    if (canonicalName) {
      items.push({
        name: canonicalName,
        type: 'equipment',
        system: {
          equipped: true,
          quantity: 1,
          description: { value: '' },
          type: { value: key.includes('shield') ? 'shield' : 'light' },
        },
      });
    }
  }
  return items;
}
