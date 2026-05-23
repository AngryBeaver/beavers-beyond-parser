import { COMPENDIUM_ITEM_PACK_PRIORITY, NAMESPACE, SETTINGS } from '../definitions.js';

// ── T1.2 — Valid item types ───────────────────────────────────────────────────

const VALID_ITEM_TYPES = new Set([
  'weapon', 'spell', 'feat', 'background',
  'consumable', 'equipment', 'tool', 'loot',
]);

// ── T1.3 — Candidate shape ────────────────────────────────────────────────────

export interface CompendiumCandidate {
  packId: string;
  packRank: number;
  name: string;
  type: string;
  img: string;
  descriptionText: string;
  data: Record<string, unknown>;
}

export interface LookupResult {
  item: Record<string, unknown> | null;
  img: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Build the resolved pack priority list at runtime. */
function resolvedPackList(): string[] {
  const primary = COMPENDIUM_ITEM_PACK_PRIORITY.slice(0, 3); // core books
  const legacy = COMPENDIUM_ITEM_PACK_PRIORITY.slice(3);     // dnd5e.*

  // User packs from the MONSTER_PACKS setting, not already in primary/legacy
  const userPacksSetting = (game.settings.get(NAMESPACE, SETTINGS.MONSTER_PACKS) as string) ?? '';
  const userPacks = userPacksSetting
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !primary.includes(s) && !legacy.includes(s));

  // All remaining active Item packs not yet in any list
  const knownSet = new Set([...primary, ...userPacks, ...legacy]);
  const extraPacks: string[] = [];
  for (const pack of (game.packs as any)) {
    if (pack.metadata?.type === 'Item' && !knownSet.has(pack.collection)) {
      extraPacks.push(pack.collection);
      knownSet.add(pack.collection);
    }
  }

  return [...primary, ...userPacks, ...extraPacks, ...legacy];
}

// ── T1.3 — lookupCandidates ───────────────────────────────────────────────────

export async function lookupCandidates(name: string): Promise<CompendiumCandidate[]> {
  const orderedPacks = resolvedPackList();
  const results: CompendiumCandidate[] = [];
  const nameLower = name.toLowerCase();

  for (let rank = 0; rank < orderedPacks.length; rank++) {
    const packId = orderedPacks[rank];
    const pack = (game.packs as any).get(packId);
    if (!pack) continue;

    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => e.name?.toLowerCase() === nameLower);
      if (!entry) continue;

      const doc = await pack.getDocument(entry._id) as any;
      if (!doc) continue;

      const itemType: string = doc.type ?? '';
      if (!VALID_ITEM_TYPES.has(itemType)) continue;

      const raw = doc.toObject() as Record<string, unknown>;
      const descHtml = (raw as any)?.system?.description?.value ?? '';
      const descriptionText = typeof descHtml === 'string' ? stripHtml(descHtml) : '';

      results.push({
        packId,
        packRank: rank,
        name: doc.name ?? name,
        type: itemType,
        img: (raw as any).img ?? '',
        descriptionText,
        data: raw,
      });
    } catch {
      // skip broken/unavailable packs
    }
  }

  return results;
}

// ── T1.4 — textMatchExact ─────────────────────────────────────────────────────

export function textMatchExact(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ── T1.5 — simplifyName ───────────────────────────────────────────────────────

export function simplifyName(name: string): string | null {
  // Possessive: "King's Knife" → "Knife"
  const possessive = name.match(/^.+?'s\s+(.+)$/i);
  if (possessive) return possessive[1];

  // "of (the) X" suffix: "Staff of Fire" → "Staff"
  const ofSuffix = name.match(/^(.+?)\s+of\s+(?:the\s+)?.+$/i);
  if (ofSuffix) return ofSuffix[1].trim();

  // Two-word → last word: "Shadow Blade" → "Blade"
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return words[words.length - 1];

  return null;
}

// ── T1.6 — findInCompendium ───────────────────────────────────────────────────

export async function findInCompendium(
  name: string,
  parsedText: string,
  options?: { useAi?: boolean },
): Promise<LookupResult> {
  // Pass 1 — exact text, original name
  const candidates = await lookupCandidates(name);
  for (const c of candidates) {
    if (!c.descriptionText) continue;
    if (parsedText && textMatchExact(parsedText, c.descriptionText)) {
      return { item: foundry.utils.deepClone(c.data), img: c.img };
    }
  }

  let bestImg: string | null = candidates[0]?.img ?? null;

  // Pass 2 — exact text, simplified name
  const simplified = simplifyName(name);
  let simpleCandidates: CompendiumCandidate[] = [];
  if (simplified) {
    simpleCandidates = await lookupCandidates(simplified);
    for (const c of simpleCandidates) {
      if (!c.descriptionText) continue;
      if (parsedText && textMatchExact(parsedText, c.descriptionText)) {
        return { item: foundry.utils.deepClone(c.data), img: c.img };
      }
    }
    bestImg = bestImg ?? simpleCandidates[0]?.img ?? null;
  }

  // Pass 3 & 4 — AI (deferred to AiLookup; imported lazily to avoid circular deps)
  if (options?.useAi) {
    const { AiLookup } = await import('./AiLookup.js');
    const allCandidates = dedup([...candidates, ...simpleCandidates]);

    // Pass 3 — semantic match
    for (const c of allCandidates) {
      if (!c.descriptionText || !parsedText) continue;
      if (await AiLookup.semanticMatch(parsedText, c.descriptionText)) {
        return { item: foundry.utils.deepClone(c.data), img: c.img };
      }
    }

    // Pass 4 — mechanical patch of best candidate
    const bestCandidate = allCandidates.find((c) => c.descriptionText);
    if (bestCandidate) {
      const patched = await AiLookup.patchMechanics(bestCandidate.data, parsedText);
      if (patched) return { item: patched, img: bestCandidate.img };
    }
  }

  return { item: null, img: bestImg };
}

function dedup(candidates: CompendiumCandidate[]): CompendiumCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.packId}::${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
