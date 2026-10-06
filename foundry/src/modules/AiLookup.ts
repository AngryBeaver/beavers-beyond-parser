import { NAMESPACE, SETTINGS } from '../definitions.js';
import type { AiStats } from './CompendiumLookup.js';

const SEMANTIC_SYSTEM = `You are a D&D 5e rules expert. Compare two item descriptions and return exactly one word.

MATCH  — Same ability with equivalent mechanics. Ignore wording, formatting, or flavour differences.
PATCH  — Same ability and the same set of effects, but one or more numeric values differ
         (damage dice, save DC, range, duration, uses, damage type, attack bonus).
         Every effect present in one must also be present in the other — no extra or missing
         conditions, secondary effects, or mechanics.
REJECT — Different abilities entirely, OR one description has an effect, condition, or mechanic
         the other lacks.

When in doubt, return REJECT.`;

const ICON_SYSTEM = `You are a D&D 5e Foundry VTT expert. Given an item name and description, pick the single best matching icon from the list below.
Each line is a slash-separated path without extension. Return ONLY that exact path (e.g. weapons/swords/longsword).
Return exactly "miss" if no icon fits well. No other text.`;

const PATCH_SYSTEM = `You are a D&D 5e Foundry VTT expert.
You will receive a Foundry Item data object (JSON) and a target description.
The two describe the same ability but with different numeric values.
Identify every mechanical value in the JSON that differs from the target description
(damage formula, save DC, range, duration, uses.max, attack bonus, damage type, etc.).
Return ONLY a JSON object mapping dot-notation field paths to their correct values.
Example: { "system.damage.parts": [["2d8", "fire"]], "system.save.dc.formula": "14" }
If nothing needs changing, return {}.`;

function aiService(): {
  call(s: string, u: string, o?: Record<string, unknown>): Promise<{ content: string }>;
} | null {
  return (game as any)?.['beavers-ai-assistant']?.AiService?.getDefault?.() ?? null;
}

// ── Icon index cache ──────────────────────────────────────────────────────────

let _iconPaths: string[] | null = null;
let _iconPromptCache: Map<string, string> | null = null;

async function loadIconPaths(): Promise<string[]> {
  if (_iconPaths) return _iconPaths;
  const major = parseInt(((game as any).version as string)?.split('.')[0] ?? '0', 10);
  for (let v = major; v >= 13; v--) {
    try {
      const resp = await fetch(`modules/${NAMESPACE}/vtt${v}-icons.json`);
      if (resp.ok) {
        _iconPaths = (await resp.json()) as string[];
        return _iconPaths;
      }
    } catch {
      /* try older version */
    }
  }
  _iconPaths = [];
  return _iconPaths;
}

// Category prefixes used to filter icon list by item type.
const ICON_CATEGORIES: Record<string, string[]> = {
  weapon: ['weapons/', 'equipment/'],
  spell: ['magic/', 'consumables/', 'skills/'],
  feat: ['skills/', 'magic/', 'equipment/', 'consumables/', 'creatures/'],
  save: ['skills/', 'environment/', 'magic/'],
};

function buildPromptList(paths: string[], itemType?: string): string {
  const cacheKey = itemType ?? '__all__';
  if (!_iconPromptCache) _iconPromptCache = new Map();
  if (_iconPromptCache.has(cacheKey)) return _iconPromptCache.get(cacheKey)!;

  const prefixes = itemType ? (ICON_CATEGORIES[itemType] ?? null) : null;
  const filtered = prefixes
    ? paths.filter((p) => prefixes.some((pre) => p.startsWith(pre)))
    : paths;

  const result = filtered.map((p) => p.replace(/\.[^.]+$/, '')).join('\n');
  _iconPromptCache.set(cacheKey, result);
  return result;
}

export const AiLookup = {
  isAvailable(): boolean {
    return !!(game as any).modules?.get('beavers-ai-assistant')?.active;
  },

  isEnabled(): boolean {
    try {
      return !!(game.settings.get(NAMESPACE, SETTINGS.AI_SUPPORT_ENABLED) as boolean);
    } catch {
      return false;
    }
  },

  isConfigured(): boolean {
    return !!(game as any)?.['beavers-ai-assistant']?.AiService?.isConfigured();
  },

  async classifyMatch(
    parsedText: string,
    descriptionText: string,
  ): Promise<'MATCH' | 'PATCH' | 'REJECT'> {
    const svc = aiService();
    if (!svc) return 'REJECT';
    try {
      const userPrompt = `Description A:\n${parsedText}\n\nDescription B:\n${descriptionText}`;
      const { content } = await svc.call(SEMANTIC_SYSTEM, userPrompt, {
        max_tokens: 10,
        temperature: 0,
      });
      const word = content.trim().toUpperCase().split(/\s/)[0];
      if (word === 'MATCH') return 'MATCH';
      if (word === 'PATCH') return 'PATCH';
      return 'REJECT';
    } catch {
      return 'REJECT';
    }
  },

  async suggestIcon(
    name: string,
    description: string,
    stats: AiStats,
    itemType?: 'weapon' | 'spell' | 'feat' | 'save',
  ): Promise<string | null> {
    const svc = aiService();
    if (!svc) return null;
    const paths = await loadIconPaths();
    if (paths.length === 0) return null;
    const listText = buildPromptList(paths, itemType);
    const userPrompt = `Item: ${name}\nDescription: ${description}\n\nAvailable icons:\n${listText}`;
    stats.calls++;
    try {
      const { content } = await svc.call(ICON_SYSTEM, userPrompt, {
        max_tokens: 80,
        temperature: 0,
      });
      const raw = content
        .trim()
        .replace(/\\/g, '/')
        .replace(/\.[^.]+$/, '');
      if (!raw || raw.toLowerCase() === 'miss') {
        stats.iconMiss++;
        return null;
      }
      // Verify the stem exists in the index and resolve the full path with extension
      const lower = raw.toLowerCase();
      const match = paths.find((p) => p.replace(/\.[^.]+$/, '').toLowerCase() === lower);
      if (!match) {
        console.warn(`[bbp] AI slop: hallucinated icon path "${raw}"`);
        stats.iconMiss++;
        return null;
      }
      stats.iconSuggest++;
      return `icons/${match}`;
    } catch (err) {
      console.warn(`[bbp] suggestIcon failed for "${name}":`, err);
      stats.iconMiss++;
      return null;
    }
  },

  async patchMechanics(
    data: Record<string, unknown>,
    parsedText: string,
  ): Promise<Record<string, unknown> | null> {
    const svc = aiService();
    if (!svc) return null;
    try {
      const userPrompt = `Item data:\n${JSON.stringify(data, null, 2)}\n\nTarget description:\n${parsedText}`;
      const { content } = await svc.call(PATCH_SYSTEM, userPrompt, {
        max_tokens: 512,
        temperature: 0,
      });
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const patches = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const cloned = foundry.utils.deepClone(data);
      for (const [path, value] of Object.entries(patches)) {
        (foundry.utils as any).setProperty(cloned, path, value);
      }
      return cloned;
    } catch {
      return null;
    }
  },
};
