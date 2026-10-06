import { PRIMARY_PACK_MODULES, LEGACY_PACK_MODULES } from '../definitions.js';

// ── T1.2 — Valid item types ───────────────────────────────────────────────────

const VALID_ITEM_TYPES = new Set([
  'weapon',
  'spell',
  'feat',
  'background',
  'consumable',
  'equipment',
  'tool',
  'loot',
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

export interface AiStats {
  calls: number;
  match: number;
  patch: number;
  iconSuggest: number;
  iconMiss: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build the resolved pack priority list at runtime. */
function resolvedPackList(): string[] {
  const primarySet = new Set(PRIMARY_PACK_MODULES);
  const legacySet = new Set(LEGACY_PACK_MODULES);

  const primary: string[] = [];
  const extra: string[] = [];
  const legacy: string[] = [];

  for (const pack of (game.packs as any).contents as any[]) {
    if (pack.metadata?.type !== 'Item') continue;
    const mod = (pack.collection as string).split('.')[0];
    if (primarySet.has(mod)) primary.push(pack.collection);
    else if (legacySet.has(mod)) legacy.push(pack.collection);
    else extra.push(pack.collection);
  }

  return [...primary, ...extra, ...legacy];
}

// ── lookupImg ─────────────────────────────────────────────────────────────────

/** Return the image for the first compendium entry whose name matches, using the index only. */
export async function lookupImg(name: string): Promise<string | null> {
  const orderedPacks = resolvedPackList();
  const nameLower = name.toLowerCase();
  for (const packId of orderedPacks) {
    const pack = (game.packs as any).get(packId);
    if (!pack) continue;
    try {
      const index = await pack.getIndex();
      const entry = (index as any).find((e: any) => e.name?.toLowerCase() === nameLower);
      if (entry?.img) return entry.img as string;
    } catch {
      // skip unavailable packs
    }
  }
  return null;
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

      const doc = (await pack.getDocument(entry._id)) as any;
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
  options?: { useAi?: boolean; aiStats?: AiStats },
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
    const stats = options.aiStats;

    // Pass 3 — classify each candidate; return on first MATCH, hold first PATCH as fallback
    let patchCandidate: CompendiumCandidate | null = null;
    for (const c of allCandidates) {
      if (!c.descriptionText || !parsedText) continue;
      const result = await AiLookup.classifyMatch(parsedText, c.descriptionText);
      if (stats) stats.calls++;
      if (result === 'MATCH') {
        if (stats) stats.match++;
        return { item: foundry.utils.deepClone(c.data), img: c.img };
      }
      if (result === 'PATCH' && !patchCandidate) patchCandidate = c;
    }

    // Pass 4 — patch the best PATCH candidate
    if (patchCandidate) {
      if (stats) stats.calls++;
      const patched = await AiLookup.patchMechanics(patchCandidate.data, parsedText);
      if (patched) {
        if (stats) stats.patch++;
        return { item: patched, img: patchCandidate.img };
      }
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
