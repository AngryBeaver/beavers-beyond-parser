# Compendium Lookup + AI Fallback — Task List

Goal: after parsing a trait/feat/action name, look it up in compendium packs before
generating a fresh item. If an exact text match is found, reuse the compendium item.
If no text match, fall back to AI semantic matching when enabled. As a last resort,
clone the best structural candidate and let AI patch the differing mechanics.
Show a cost estimate in each import window when AI is enabled.

---

## Phase 1 — Compendium Lookup Core  (beavers-beyond-parser)

### T1.1 — Define pack priority order
File: `foundry/src/definitions.ts`

Add constant `COMPENDIUM_ITEM_PACK_PRIORITY`:

```ts
export const COMPENDIUM_ITEM_PACK_PRIORITY = [
  // Primary — core rulebooks (highest priority)
  'dnd-players-handbook.items',
  'dnd-monster-manual.items',
  'dnd-dungeon-masters-guide.items',
  // Secondary — any packs the user added via the MONSTER_PACKS setting (inserted at runtime)
  // Legacy — dnd5e built-in packs (lowest priority)
  'dnd5e.items',
  'dnd5e.spells',
  'dnd5e.classfeatures',
  'dnd5e.monsterfeatures',
  'dnd5e.backgrounds',
  'dnd5e.equipment',
  'dnd5e.tradegoods',
];
```

At runtime, build the ordered list as:
1. Entries from `COMPENDIUM_ITEM_PACK_PRIORITY` that are present in `game.packs`
2. Any packs from the `MONSTER_PACKS` setting **not already in the list** (inserted after
   the primary group, before the legacy dnd5e group)
3. All remaining active `game.packs` of type `Item` not yet in the list (after #2)

This keeps core books first, user packs second, legacy last.

Also add `AI_SUPPORT_ENABLED: 'aiSupportEnabled'` to the `SETTINGS` const.

---

### T1.2 — Define valid item types + description guard
File: `foundry/src/modules/CompendiumLookup.ts` (new file)

Valid types to match against (all others are excluded):

```ts
const VALID_ITEM_TYPES = new Set([
  'weapon', 'spell', 'feat', 'background',
  'consumable', 'equipment', 'tool', 'loot',
]);
```

**Description guard**: only compare description text when the candidate's description
is non-empty after stripping HTML. If a candidate has no meaningful description text,
skip it for text matching (it can still contribute its `img` as a fallback).

---

### T1.3 — Build `lookupCandidates(name)`
File: `foundry/src/modules/CompendiumLookup.ts`

```ts
interface CompendiumCandidate {
  packId: string;
  packRank: number;       // position in resolved priority list (lower = higher priority)
  name: string;
  type: string;           // dnd5e item type
  img: string;
  descriptionText: string; // HTML-stripped, whitespace-collapsed description
  data: Record<string, unknown>; // full toObject() result
}

async function lookupCandidates(name: string): Promise<CompendiumCandidate[]>
```

- Builds the resolved priority list from T1.1
- For each pack (in order): `index.find(e => e.name?.toLowerCase() === name.toLowerCase())`
- If found: load full document, filter by `VALID_ITEM_TYPES`, collect
- `descriptionText` = strip HTML from `system.description.value`, collapse whitespace, trim
- Returns all candidates across all packs ordered by packRank

---

### T1.4 — Build `textMatchExact(a, b)`
File: `foundry/src/modules/CompendiumLookup.ts`

```ts
function textMatchExact(a: string, b: string): boolean
```

- Both inputs are already-normalised description texts (from `descriptionText` above)
- Returns `true` only if the two strings are identical after lowercasing
- Used only when both strings are non-empty (enforced by caller)

---

### T1.5 — Build `simplifyName(name)`
File: `foundry/src/modules/CompendiumLookup.ts`

```ts
function simplifyName(name: string): string | null
```

Returns a simpler search term, or `null` if no rule matches (avoids pointless retries).
Rules (first match wins):

1. Possessive: `"King's Knife"` → `"Knife"`
2. `"of (the) X"` suffix: `"Staff of Fire"` → `"Staff"`
3. Two-word name → last word: `"Shadow Blade"` → `"Blade"`
4. Return `null` if name is single word or nothing matched

---

### T1.6 — Build top-level `findInCompendium(name, parsedText, options?)`
File: `foundry/src/modules/CompendiumLookup.ts`

```ts
export interface LookupResult {
  item: Record<string, unknown> | null;  // cloned + ready item data, or null
  img: string | null;                    // best candidate img if no match found
}

export async function findInCompendium(
  name: string,
  parsedText: string,
  options?: { useAi?: boolean },
): Promise<LookupResult>
```

Flow:

```
candidates = lookupCandidates(name)

// Pass 1 — exact text, original name
for each candidate (pack rank order, skip if descriptionText empty):
  if textMatchExact(parsedText, candidate.descriptionText):
    return { item: deepClone(candidate.data), img: candidate.img }

bestImg = candidates[0]?.img ?? null

// Pass 2 — exact text, simplified name
simplified = simplifyName(name)
if simplified != null:
  simpleCandidates = lookupCandidates(simplified)
  for each candidate (skip if descriptionText empty):
    if textMatchExact(parsedText, candidate.descriptionText):
      return { item: deepClone(candidate.data), img: candidate.img }
  bestImg = bestImg ?? simpleCandidates[0]?.img ?? null

// Pass 3 — AI semantic match (if enabled)
if options?.useAi:
  allCandidates = [candidates, simpleCandidates].flat().unique(by packId+name)
  for each candidate with non-empty descriptionText (pack rank order):
    if await AiLookup.semanticMatch(parsedText, candidate.descriptionText):
      return { item: deepClone(candidate.data), img: candidate.img }

  // Pass 4 — AI mechanical patch (best structural candidate, mechanics differ)
  // Pick the highest-priority candidate with non-empty description that failed semantic.
  // Ask AI to patch the differing game-mechanical fields.
  bestCandidate = first candidate with non-empty descriptionText ?? null
  if bestCandidate:
    patched = await AiLookup.patchMechanics(bestCandidate.data, parsedText)
    if patched:
      return { item: patched, img: bestCandidate.img }

return { item: null, img: bestImg }
```

---

### T1.7 — Wire lookup into `buildItemsFromEntry`
File: `foundry/src/modules/NpcBuilder.ts`

After extracting `name` and `text` (before the weapon/save/feat branch):

```ts
const useAi = AiLookup.isAvailable() && AiLookup.isEnabled() && AiLookup.isConfigured();
const { item: compendiumItem, img: fallbackImg } = await findInCompendium(name, text, { useAi });
```

If `compendiumItem` is found:
- Apply parsed `uses` to `compendiumItem.system.uses` (override)
- Apply `activationCost` to the item's activity `activation.value` (override)
- Return `[compendiumItem]`

If `compendiumItem` is null but `fallbackImg` is set:
- Build item normally (existing weapon/save/feat path)
- Set `item.img = fallbackImg` before returning

---

## Phase 2 — Settings  (beavers-beyond-parser)

### T2.1 — Register `AI_SUPPORT_ENABLED` setting
File: wherever settings are currently registered (`beavers-beyond-parser.ts` or a
`Settings` class, whichever pattern already exists)

```ts
game.settings.register(NAMESPACE, SETTINGS.AI_SUPPORT_ENABLED, {
  name: 'Enable AI Support',
  hint: 'Uses beavers-ai-assistant to semantically match and patch compendium items.',
  scope: 'world',
  config: true,
  type: Boolean,
  default: false,
});
```

---

### T2.2 — Runtime warnings on `ready` hook
File: same settings registration location

After `ready`, if `AI_SUPPORT_ENABLED` is `true`:

- If `!game.modules.get('beavers-ai-assistant')?.active`:
  `ui.notifications.warn('beavers-beyond-parser: AI support is enabled but the beavers-ai-assistant module is not active.')`
- Else if `!game['beavers-ai-assistant']?.AiService?.isConfigured()`:
  `ui.notifications.warn('beavers-beyond-parser: AI support is enabled but beavers-ai-assistant has no API key configured.')`

---

## Phase 3 — Expose AiService  (beavers-ai-assistant)

### T3.1 — Export AiService on the game namespace
Source file that compiles to `src/beavers-ai-assistant.js`

In the `init` hook, after `game[NAMESPACE] = game[NAMESPACE] || {}`:

```js
import { AiService } from './services/AiService.js';
// ...
game[NAMESPACE].AiService = AiService;
```

Other modules can then call:
```js
game['beavers-ai-assistant'].AiService.get().call(systemPrompt, userPrompt, opts)
```

---

### T3.2 — Add `AiService.isConfigured()`
Source for `src/services/AiService.js`

```js
function isConfigured(provider) {
  const resolved = provider ?? game.settings.get(NAMESPACE, SETTINGS.AI_PROVIDER) ?? DEFAULTS.AI_PROVIDER;
  if (resolved === 'claude') return !!game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY);
  return !!game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL);
}
AiService.isConfigured = isConfigured;
```

Exposed via T3.1.

---

### T3.3 — Bump version
File: `module.json`

`1.0.1` → `1.1.0`

---

## Phase 4 — AI Matching + Patching  (beavers-beyond-parser)

### T4.1 — Build `AiLookup.ts`
File: `foundry/src/modules/AiLookup.ts` (new file)

```ts
export const AiLookup = {
  isAvailable(): boolean,   // game.modules.get('beavers-ai-assistant')?.active
  isEnabled(): boolean,     // game.settings.get(NAMESPACE, SETTINGS.AI_SUPPORT_ENABLED)
  isConfigured(): boolean,  // game['beavers-ai-assistant']?.AiService?.isConfigured()
  async semanticMatch(parsedText: string, candidateText: string): Promise<boolean>,
  async patchMechanics(candidateData: Record<string, unknown>, parsedText: string): Promise<Record<string, unknown> | null>,
}
```

**`semanticMatch` prompt** (system):
> You are a D&D 5e rules expert comparing two ability descriptions.
> Ignore: formatting differences, bold/italic markup, punctuation, whitespace,
> flavour text that adds no game mechanic.
> Return NO if ANY mechanical value differs: attack bonus, damage dice or formula,
> save DC, save ability, damage type, range, duration, area size, number of uses,
> conditions applied.
> Respond with exactly one word: YES or NO.

User message: `"Description A:\n{parsedText}\n\nDescription B:\n{candidateText}"`

Call with `{ max_tokens: 10, temperature: 0 }`. Return `true` if response starts with
`"YES"` (case-insensitive).

---

### T4.2 — Build `patchMechanics`
File: `foundry/src/modules/AiLookup.ts`

Invoked when: a compendium candidate was found, exact text failed, semantic failed,
but there IS a structural candidate worth cloning.

**System prompt:**
> You are a D&D 5e Foundry VTT expert.
> You will receive a Foundry Item data object (JSON) and a target description text.
> Identify every game-mechanical value in the item data that differs from the target
> description (attack bonus, damage formula, save DC, range, uses.max, etc.).
> Return ONLY a JSON object with dot-notation field paths as keys and the correct
> values from the target description as values.
> Example: { "system.attack.bonus": "5", "system.save.dc.formula": "14" }
> If nothing needs changing, return {}.

User message:
```
Item data:
{JSON.stringify(candidateData, null, 2)}

Target description:
{parsedText}
```

Call with `{ max_tokens: 512, temperature: 0 }`.

Parse the JSON from the response. Apply each dot-notation path to a deep clone of
`candidateData` using `foundry.utils.setProperty`. Return the patched clone, or
`null` if the response cannot be parsed as valid JSON.

---

### T4.3 — Wire `useAi` flag from import windows
File: `foundry/src/modules/NpcBuilder.ts`

The `useAi` flag (T1.7) already reads `AiLookup.isAvailable/isEnabled/isConfigured`.
No additional wiring needed in NpcBuilder — the flag is evaluated per-item at parse
time.

---

## Phase 5 — Cost Estimation UI  (beavers-beyond-parser)

### Cost model (basis for all estimates)

Assumptions per monster (worst case, AI enabled):
- 5 traits need parsing
- 3 compendium candidates per trait
- 2 traits match (exact or semantic) → 3 traits need full AI treatment
- Semantic check calls: 5 traits × 3 candidates = **15 `semanticMatch` calls**
- Patch calls for unmatched traits: **3 `patchMechanics` calls**

Token estimates:
- `semanticMatch` call: ~200 input tokens + 10 output tokens
- `patchMechanics` call: ~600 input tokens + 300 output tokens

Claude Sonnet 4.6 rates: $3.00 / MTok input, $15.00 / MTok output
Claude Haiku 4.5 rates: $0.80 / MTok input, $4.00 / MTok output

Cost per monster for Sonnet 4.6:
- Semantic: 15 × (200 × $3/1M + 10 × $15/1M) = 15 × ($0.0006 + $0.00015) ≈ $0.011
- Patch:     3 × (600 × $3/1M + 300 × $15/1M) = 3 × ($0.0018 + $0.0045) ≈ $0.019
- **≈ $0.030 per monster (Sonnet 4.6)**

Cost per monster for Haiku 4.5:
- Semantic: 15 × (200 × $0.8/1M + 10 × $4/1M) ≈ $0.0026
- Patch:     3 × (600 × $0.8/1M + 300 × $4/1M) ≈ $0.005
- **≈ $0.008 per monster (Haiku 4.5)**

Local AI: **$0.00** (no token cost)

Presets:
| Scenario            | Monsters | Sonnet 4.6 | Haiku 4.5 | Local |
|---------------------|----------|------------|-----------|-------|
| Single monster      | 1        | ~$0.03     | ~$0.01    | $0.00 |
| Small adventure     | 20       | ~$0.60     | ~$0.16    | $0.00 |
| Full campaign       | 50       | ~$1.50     | ~$0.40    | $0.00 |

---

### T5.1 — Build `AiCostEstimate.ts`
File: `foundry/src/modules/AiCostEstimate.ts` (new file)

```ts
interface CostRow { label: string; claude: string; local: string; }

export function estimateCost(monsterCount: number): CostRow[]
```

Reads `game['beavers-ai-assistant']?.AiService?.model()` to know which Claude model is
configured; look up its rates from a local table (Haiku / Sonnet / Opus).
Returns rows like `[{ label: "~20 monsters", claude: "~$0.60", local: "$0.00" }]`.

---

### T5.2 — Add cost block to `_prepareContext` in all three windows
Files:
- `foundry/src/apps/ImportMonsterWindow.ts`
- `foundry/src/apps/ImportItemWindow.ts`
- `foundry/src/apps/ImportAdventureWindow.ts`

Add to the context object:
```ts
const aiEnabled = AiLookup.isAvailable() && AiLookup.isEnabled() && AiLookup.isConfigured();
const costRows = aiEnabled ? AiCostEstimate.estimateCost(/* per window */) : [];
return { ..., aiEnabled, costRows };
```

Monster window: pass `monsterCount = 1` → single "~1 monster" row.
Item window: pass `monsterCount = 1` (one item is equivalent).
Adventure window: pass both 20 and 50 → two rows labeled "Small adventure" /
"Full campaign".

---

### T5.3 — Add cost block to all three HBS templates
Files:
- `foundry/templates/import-monster-window.hbs`
- `foundry/templates/import-item-window.hbs`
- `foundry/templates/import-adventure-window.hbs`

Insert after the URL `<input>` group and before `<p class="bbp-status">`:

```hbs
{{#if aiEnabled}}
<div class="bbp-ai-cost">
  <span class="bbp-ai-cost-label"><i class="fa-solid fa-robot"></i> AI cost estimate</span>
  <table class="bbp-cost-table">
    <thead><tr><th></th><th>Claude</th><th>Local</th></tr></thead>
    <tbody>
      {{#each costRows}}
      <tr><td>{{this.label}}</td><td>{{this.claude}}</td><td>{{this.local}}</td></tr>
      {{/each}}
    </tbody>
  </table>
</div>
{{/if}}
```

Add minimal CSS for `.bbp-ai-cost` / `.bbp-cost-table` to the existing stylesheet
(small font, muted color, tight row height — it should be informational, not prominent).

---

## Dependency order

```
T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6 → T1.7
T2.1 → T2.2
T3.1 → T3.2 → T3.3          (beavers-ai-assistant; do before Phase 4)
T4.1 → T4.2 → T4.3          (T4.1 needs T3.1; T4.2 needs T4.1)
T5.1 → T5.2 → T5.3          (T5.2 needs T4.1 for isAvailable/isEnabled)

T1.6 must be done before T4.2 extends it
T3.1 must be done before T4.1 (AiService on game object)
T2.1 before T5.2 (reads AI_SUPPORT_ENABLED)
```
