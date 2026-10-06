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

// The icon library has ~7000 entries. Offering all of them at once costs tens of thousands of
// tokens per item, so the search runs in two small steps: pick a folder, then an icon in it.
// The lists sit in the system prompt and the item comes last, so the model server can reuse
// the list prefix between items.
const ICON_FOLDER_SYSTEM = `You are a D&D 5e Foundry VTT expert. Given an item name and description, pick the icon folder most likely to contain a fitting icon.
Return ONLY one folder path exactly as listed. Return exactly "miss" if no folder fits. No other text.

Folders:
`;

const ICON_FILE_SYSTEM = `You are a D&D 5e Foundry VTT expert. Given an item name and description, pick the single best matching icon.
Return ONLY one icon name exactly as listed. Return exactly "miss" if no icon fits well. No other text.

Icons:
`;

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
let _iconFolders: Map<string, string[]> | null = null;

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

/** Icon paths grouped by folder ("magic/fire" → its icons). */
function iconFolders(paths: string[]): Map<string, string[]> {
  if (_iconFolders) return _iconFolders;
  _iconFolders = new Map();
  for (const path of paths) {
    const cut = path.lastIndexOf('/');
    if (cut < 0) continue; // loose files at the top level are logos, not item icons
    const folder = path.slice(0, cut);
    if (!_iconFolders.has(folder)) _iconFolders.set(folder, []);
    _iconFolders.get(folder)!.push(path);
  }
  return _iconFolders;
}

const stem = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/** The model's answer as one clean line: no quotes, backslashes or trailing punctuation. */
function cleanAnswer(content: string): string {
  return (content.trim().split('\n')[0] ?? '')
    .replace(/\\/g, '/')
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
    .toLowerCase();
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

    const prefixes = itemType ? (ICON_CATEGORIES[itemType] ?? null) : null;
    const folders = [...iconFolders(paths).keys()].filter(
      (f) => !prefixes || prefixes.some((pre) => f.startsWith(pre)),
    );
    const item = `Item: ${name}\nDescription: ${description}`;
    const miss = (reason?: string): null => {
      if (reason) console.warn(`[bbp] AI slop: ${reason}`);
      stats.iconMiss++;
      return null;
    };

    try {
      // Step 1: folder
      stats.calls++;
      const folderAnswer = cleanAnswer(
        (
          await svc.call(ICON_FOLDER_SYSTEM + folders.join('\n'), item, {
            max_tokens: 30,
            temperature: 0,
          })
        ).content,
      );
      if (!folderAnswer || folderAnswer === 'miss') return miss();
      const folder = folders.find((f) => f.toLowerCase() === folderAnswer.replace(/\/$/, ''));
      if (!folder) return miss(`unknown icon folder "${folderAnswer}" for "${name}"`);

      // Step 2: icon inside that folder
      const files = iconFolders(paths).get(folder)!;
      stats.calls++;
      const fileAnswer = cleanAnswer(
        (
          await svc.call(ICON_FILE_SYSTEM + files.map(stem).join('\n'), item, {
            max_tokens: 40,
            temperature: 0,
          })
        ).content,
      );
      if (!fileAnswer || fileAnswer === 'miss') return miss();
      // tolerate an answer that repeats the folder or the extension
      const wanted = stem(fileAnswer);
      const match = files.find((f) => stem(f).toLowerCase() === wanted);
      if (!match) return miss(`unknown icon "${fileAnswer}" in ${folder} for "${name}"`);

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
