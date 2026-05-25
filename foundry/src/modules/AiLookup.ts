import { NAMESPACE, SETTINGS } from '../definitions.js';

const SEMANTIC_SYSTEM = `You are a D&D 5e rules expert. Compare two item descriptions and return exactly one word.

MATCH  — Same ability with equivalent mechanics. Ignore wording, formatting, or flavour differences.
PATCH  — Same ability and the same set of effects, but one or more numeric values differ
         (damage dice, save DC, range, duration, uses, damage type, attack bonus).
         Every effect present in one must also be present in the other — no extra or missing
         conditions, secondary effects, or mechanics.
REJECT — Different abilities entirely, OR one description has an effect, condition, or mechanic
         the other lacks.

When in doubt, return REJECT.`;

const PATCH_SYSTEM = `You are a D&D 5e Foundry VTT expert.
You will receive a Foundry Item data object (JSON) and a target description.
The two describe the same ability but with different numeric values.
Identify every mechanical value in the JSON that differs from the target description
(damage formula, save DC, range, duration, uses.max, attack bonus, damage type, etc.).
Return ONLY a JSON object mapping dot-notation field paths to their correct values.
Example: { "system.damage.parts": [["2d8", "fire"]], "system.save.dc.formula": "14" }
If nothing needs changing, return {}.`;

function aiService(): { call(s: string, u: string, o?: Record<string, unknown>): Promise<{ content: string }> } | null {
  return (game as any)?.['beavers-ai-assistant']?.AiService ?? null;
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

  async classifyMatch(parsedText: string, descriptionText: string): Promise<'MATCH' | 'PATCH' | 'REJECT'> {
    const svc = aiService();
    if (!svc) return 'REJECT';
    try {
      const userPrompt = `Description A:\n${parsedText}\n\nDescription B:\n${descriptionText}`;
      const { content } = await svc.call(SEMANTIC_SYSTEM, userPrompt, { max_tokens: 10, temperature: 0 });
      const word = content.trim().toUpperCase().split(/\s/)[0];
      if (word === 'MATCH') return 'MATCH';
      if (word === 'PATCH') return 'PATCH';
      return 'REJECT';
    } catch {
      return 'REJECT';
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
      const { content } = await svc.call(PATCH_SYSTEM, userPrompt, { max_tokens: 512, temperature: 0 });
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
