import { NAMESPACE, SETTINGS } from '../definitions.js';

const SEMANTIC_SYSTEM = `You are a D&D 5e rules expert comparing two ability descriptions.
Ignore: formatting differences, bold/italic markup, punctuation, whitespace,
flavour text that adds no game mechanic.
Return NO if ANY mechanical value differs: attack bonus, damage dice or formula,
save DC, save ability, damage type, range, duration, area size, number of uses,
conditions applied.
Respond with exactly one word: YES or NO.`;

const PATCH_SYSTEM = `You are a D&D 5e Foundry VTT expert.
You will receive a Foundry Item data object (JSON) and a target description text.
Identify every game-mechanical value in the item data that differs from the target
description (attack bonus, damage formula, save DC, range, uses.max, etc.).
Return ONLY a JSON object with dot-notation field paths as keys and the correct
values from the target description as values.
Example: { "system.attack.bonus": "5", "system.save.dc.formula": "14" }
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

  async semanticMatch(parsedText: string, descriptionText: string): Promise<boolean> {
    const svc = aiService();
    if (!svc) return false;
    try {
      const userPrompt = `Description A:\n${parsedText}\n\nDescription B:\n${descriptionText}`;
      const { content } = await svc.call(SEMANTIC_SYSTEM, userPrompt, { max_tokens: 10, temperature: 0 });
      return content.trim().toUpperCase().startsWith('YES');
    } catch {
      return false;
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
