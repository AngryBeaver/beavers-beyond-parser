# Monster Import Validation & Optimization Project

## Goal

Validate and optimize the beavers-beyond-parser monster import pipeline by comparing what the parser
produces against known-good compendium entries (`dnd5e.monsters` SRD pack), then fix any discrepancies.

## Setup

| Component | Location | Purpose |
|-----------|----------|---------|
| Parser module | `C:\ssc\beavers-beyond-parser\foundry\` | Foundry VTT module that imports monsters |
| AI assistant module | `C:\ssc\beavers-ai-assistant\foundry\` | Socket API into Foundry, AI service |
| Proxy service | `http://localhost:3001` | Fetches D&D Beyond pages (requires valid CobaltSession) |
| Local AI | `http://localhost:8080` | gemma-4-e4b-it for semantic matching |
| Foundry | `http://localhost:14363` | Running instance with SRD compendium, world "starter" |

Foundry credentials (ai-assistant user): see `.env` (gitignored).

## Architecture Changes Made

### beavers-ai-assistant (Foundry module + client library)

1. **`foundry/src/services/AiService.ts`** — Added `AiService.getDefault()` that reads the
   configured provider from game settings, eliminating the no-arg `get()` call bug.

2. **`foundry/src/api/ActorApi.ts`** (new) — Socket API for querying the Foundry compendium and
   world actors:
   - `listCompendiumActors(packId?)` — all actors in a pack (or all Actor packs)
   - `queryCompendiumActor(name, packId?)` — full actor JSON from compendium
   - `readWorldActor(nameOrId)` — actor from the world
   - `deleteWorldActor(nameOrId)` — delete a world actor

3. **`foundry/src/api/SocketApi.ts`** — Added the four Actor API cases.

4. **`client/src/index.ts`** — Added `listCompendiumActors`, `queryCompendiumActor`,
   `readWorldActor`, `deleteWorldActor` methods. Added `#channelRequest` for multi-channel socket
   support (bbp uses its own `module.beavers-beyond-parser` channel).
   Socket auth uses `extraHeaders: { Cookie: cookie }` — required for Foundry v14 (not `?session=`).

5. **`client/src/types.ts`** — Added `ActorSummary` type.

### beavers-beyond-parser (Foundry module)

1. **`foundry/module.json`** — Added `"socket": true` so Foundry routes `module.beavers-beyond-parser`
   channel traffic server-side. Requires a full server restart (not just F5) to take effect.

2. **`foundry/src/beavers-beyond-parser.ts`** — Added `module.beavers-beyond-parser` socket listener
   in the `ready` hook. Handles the `previewMonsterImport` action (GM-only).

3. **`foundry/src/modules/NpcBuilder.ts`** — Multiple parser fixes:
   - `previewMonsterImport(url, { skipAi })` static method: parses DDB page and returns actor data
     without calling `Actor.create()`. `skipAi: true` skips AI lookup for fast validation runs.
   - `buildAttackItem`: `flat: false, bonus: ''` so Foundry auto-calculates attack bonus from
     ability mod + proficiency instead of setting a hardcoded flat value.
   - `parseDamageList`: handles "bludgeoning, piercing, **and** slashing" patterns and
     multi-type segments like "Piercing **and** Slashing from Nonmagical Attacks".
   - `buildArmorItems`: maps DDB short armor tokens (`"plate"`, `"leather"`, `"hide"`, etc.) to
     canonical Foundry item names (`"Plate Armor"`, `"Leather Armor"`, etc.).
   - Legendary/lair action header feat: emits a `[feat] Legendary Actions` item before the
     individual legendary action entries, matching the compendium structure.

4. **`foundry/src/modules/ItemBuilder.ts`** — `getSpellForActor` now falls back to searching
   compendium packs directly when `spellNameToItemId` is empty (as in preview/validation runs).

## Validation Workflow

```
validate-monsters.mjs
  └── for each SRD monster in dnd5e.monsters pack:
       ├── fetch DDB search page via proxy: /monsters?filter-search=<name>
       ├── parse HTML → find entry with source "Basic Rules (2014)" → get href
       ├── socket → beavers-beyond-parser → previewMonsterImport(ddbUrl, { skipAi: true })
       │     └── BeyondFetcher → proxy → D&D Beyond monster page
       │         → StatBlockParser → buildActorData (no Actor.create)
       ├── socket → beavers-ai-assistant → queryCompendiumActor(name, 'dnd5e.monsters')
       ├── filterKnownIssues(name, diffs)   ← suppress compendium data errors
       └── diffActors(preview, reference) → report
```

Output: `validation-report.json` + summary table on stdout.

Run options:
```
node validate-monsters.mjs                  # all 331 SRD monsters
node validate-monsters.mjs --limit 30       # first 30
node validate-monsters.mjs --name Goblin    # single monster
```

## Current Validation Status (first 30 monsters)

28/29 pass (1 skipped: "Swarm of Spiders" — not in Basic Rules on DDB).

Remaining diff: **Ancient Bronze Dragon** `items.extra`: "lightning breath", "repulsion breath" —
DDB lists each breath weapon as its own named sub-section, so the parser correctly creates
individual feats. The compendium groups them into a single "Breath Weapons" feat. Hard to detect
without parsing the "the following breath weapons" preamble text. Accepted as-is for now.

## Known False Positives (`validation-known-issues.json`)

| Monster | Field | Reason |
|---------|-------|--------|
| Drider | `weapon[Bite].attackBonus` | Compendium stores `flat=true, bonus=3` (wrong). Our `flat=false, bonus=''` gives correct +6 via auto-calc. |
| Gelatinous Cube | `weapon[Pseudopod].attackBonus` | Same — compendium stores a broken flat bonus. Our auto-calc is correct. |
| Djinni | `items.missing/extra` | Compendium uses "Conjure Air Elemental" (variant name). DDB/SRD spell is "Conjure Elemental". |
| Storm Giant | `items.missing/extra` | Storm Giant compendium entry is broken. Parser output is correct. |

## Scripts

### Validation
| File | Purpose |
|------|---------|
| `validate-monsters.mjs` | Main loop — runs all SRD monsters through import preview and diffs against compendium |
| `validation-known-issues.json` | Suppressed false positives with explanations |
| `validation-report.json` | Output of last validation run (gitignored) |

### Utilities
| File | Purpose |
|------|---------|
| `search-ddb.mjs` | Search D&D Beyond for a monster name and return matching URLs |
| `diff-actor.mjs` | Compare two actor JSON files and print differences |

### Diagnostics (one-off probes, kept for reference)
| File | Purpose |
|------|---------|
| `probe-auth.mjs` | Foundry v14 auth flow exploration |
| `probe-session.mjs` | Socket session/cookie header testing |
| `probe-cookie-header.mjs` | Proved `extraHeaders: { Cookie }` is correct for Foundry v14 |
| `probe-join-flow.mjs` | POST /join auth flow |
| `probe-raw.mjs` | Raw socket message inspection |
| `probe-bbp.mjs` | bbp channel routing diagnostics |
| `probe-game-page.mjs` | Game page HTML inspection |
| `probe-xorn-dr.mjs` | Damage resistance HTML format for Xorn |
| `probe-ac-note.mjs` | AC note HTML format (revealed "plate" vs "plate armor") |
| `probe-dragon-items.mjs` | Compendium vs parsed item lists for dragons |
| `probe-attack-bonus.mjs` | Attack bonus field config for Drider / Gelatinous Cube |

## Build & Deploy

devwatch runs automatically — edit source files and they are built and deployed to Foundry instantly.
Then hit **F5** in the browser to reload the Foundry client.

Manual build if needed:
```powershell
cd C:\ssc\beavers-beyond-parser\foundry
npm run build
```

> Note: changes to `module.json` (e.g. `"socket": true`) require a **full Foundry server restart**,
> not just a browser reload.
