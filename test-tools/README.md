# test-parser

Node.js scripts for validating and debugging the beavers-beyond-parser monster import pipeline.

## Prerequisites

- Foundry VTT running at `http://localhost:14363` with the `beavers-beyond-parser` and `beavers-ai-assistant` modules active, world "starter" loaded.
- Proxy service running at `http://localhost:3001` with a valid CobaltSession (fetches D&D Beyond pages).
- Node.js 18+.
- Dependencies installed: `npm install` (run once from this directory).

## Setup

Copy `.env.example` to `.env` and fill in your Foundry credentials:

```
cp .env.example .env
```

`.env` is gitignored and is the only place credentials are stored.

## Running scripts

All scripts read credentials from `.env` automatically — no flags needed.

### Validate all SRD monsters

Compares parser output against the `dnd5e.monsters` SRD compendium for every monster:

```
node validate-monsters.mjs
```

Options:

```
node validate-monsters.mjs --limit 10          # first 10 monsters only
node validate-monsters.mjs --name Goblin       # single monster
node validate-monsters.mjs --pack dnd5e.monsters  # explicit pack (default)
```

Output is printed to stdout and written to `validation-report.json`.

### Search D&D Beyond

Look up a monster by name and print its DDB URL:

```
node search-ddb.mjs "Adult Black Dragon"
node search-ddb.mjs "Goblin"
```

### Diff two actor JSON files

Compare a parsed actor JSON against a reference JSON and print differences:

```
node diff-actor.mjs preview.json reference.json
```

### Probe scripts

One-off diagnostic scripts kept for reference. Run any directly:

```
node probe-attack-bonus.mjs     # inspect attack bonus fields for specific monsters
node probe-dragon-items.mjs     # compare compendium vs parsed item lists for dragons
node probe-issues-6-7.mjs       # mephit innate spells + language "custom" key investigation
node probe-ac-note.mjs          # armor class note HTML format
node probe-breath-weapons.mjs   # breath weapon HTML structure
node probe-xorn-dr.mjs          # damage resistance HTML for Xorn
node probe-mephit-spells.mjs    # innate spellcasting HTML for Dust Mephit
node probe-auth.mjs             # Foundry v14 auth endpoint exploration
node probe-raw.mjs              # raw socket event inspection
node probe-bbp.mjs              # bbp socket channel diagnostics
node probe-session.mjs          # socket session/cookie header testing
node probe-cookie-header.mjs    # extraHeaders Cookie auth
node probe-join-flow.mjs        # full POST /join auth flow
node probe-game-page.mjs        # /game page HTML inspection
```

## Known false positives

`validation-known-issues.json` lists compendium data errors that cause diffs in validation — our parser output is correct, the compendium entry is wrong. Each entry explains the discrepancy.

## Headless import tests

These scripts drive a running Foundry world in headless Chrome. Put a GM user into `.env`
(`FOUNDRY_URL`, `FOUNDRY_USER` = user name, `FOUNDRY_PASS`).

| Script | What it does |
|---|---|
| `run-adventure.mjs --label <name> [--ai] [--model <m>] [--chapters N] <url>` | Complete adventure import, filed under `dndbeyond/<label>/…` (actors, items, journals). Runs never share documents, so the same adventure can be imported repeatedly with different settings. Timing goes to `runs/<label>/adventure.json`. |
| `audit-import.mjs --label <name>` | Read-only quality report of a run: portraits, tokens, item icons, broken links, images, leftover D&D Beyond markup. Use `audit-import.mjs "<journal folder>"` for an import made without a label. |
| `run-import.mjs --label <name> [--ai] [--model <m>]` | Monster-only comparison through the preview API. Creates nothing in the world; results go to `runs/<label>/`. |
| `compare-runs.mjs <baseline> <run> …` | Compares `run-import.mjs` runs: time, AI calls, what the AI changed per item. |
| `bench-ai.mjs [model …]` | Times the importer's AI prompts directly against LocalAI. |
| `analyze-links.mjs <url>` | Runs the journal link rewriter on an adventure without Foundry and lists links it cannot resolve. |

The runs only ever write inside the importer's own folders (`dndbeyond` for actors and journals,
`dndBeyond` for items) and the `beyond/` image directory.
