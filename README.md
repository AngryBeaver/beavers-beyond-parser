# Beaver's Beyond Parser

> **Complexity: Medium** — Requires Docker installed and basic familiarity with the terminal to run the proxy container. If you've never used Docker before, this module is not plug-and-play.

A Foundry VTT module that imports D&D Beyond adventures into Foundry journals. Each chapter becomes a `JournalEntry`; each heading becomes a `JournalEntryPage`.

## What's in this repo

| Directory | What it is |
|---|---|
| [`foundry/`](./foundry) | The Foundry VTT module — install this in your Foundry instance |
| [`proxy-parser/`](./proxy-parser) | Node.js proxy server — fetches D&D Beyond pages server-side (bypasses browser CORS) |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- A D&D Beyond account with the adventure purchased
- Your `CobaltSession` cookie value from D&D Beyond (log in to DDB in your browser → DevTools → Application → Cookies → copy `CobaltSession`)

## Setup

### 1 — Run the proxy container

Copy `.env.example` to `.env` in the `proxy-parser/` directory and fill in your `CobaltSession`:

```
proxy-parser/.env
-----------------
COBALT_SESSION=your_session_value_here
PORT=3001
```

Then start the container:

```bash
docker compose -f beyond-parser-compose.yml up -d
```

The proxy listens on `http://localhost:3001`. Stop it with:

```bash
docker compose -f beyond-parser-compose.yml down
```

### 2 — Install the Foundry module

Download `beavers-beyond-parser.zip` from the [latest GitHub release](../../releases/latest) and install it in Foundry VTT via **Add-on Modules → Install Module → Install from zip**.

Or use the manifest URL from the release's `module.json`.

### 3 — Configure the module

In Foundry VTT → **Game Settings → Module Settings → Beaver's Beyond Parser**:

- **Parser Proxy URL**: `http://localhost:3001` (default — change only if you run the proxy on a different host/port)

### 4 — Import an adventure

Open the importer from either location (GM only):

- **Journal Entries sidebar** → click the **Import Adventure** button in the header, next to Create Entry and Create Folder.
- **Game Settings → Module Settings → Beaver's Beyond Parser** → click the **Import Adventure** button.

Then:

1. Paste the D&D Beyond adventure URL (e.g. `https://www.dndbeyond.com/sources/cm`) and click **Fetch**.
2. The module parses the table of contents and lists all chapters.
3. Click **Import to Foundry** — the proxy fetches each chapter and builds journals automatically.

**No proxy?** You can also paste raw HTML manually: open D&D Beyond → View Source (`Ctrl+U`) → select all → paste into the text area.

## Building from source

```bash
pnpm install
cd foundry && pnpm build
```

## Releasing a new version

Push a commit to `main` whose message starts with `release v` followed by a semver, e.g.:

```
release v0.2.0
```

GitHub Actions will:
1. Typecheck the foundry module
2. Build and publish a release zip + `module.json` to GitHub Releases
3. Build and push the Docker image to DockerHub as `angrybeaver/beyond-parser:0.2.0` and `:latest`

Requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets set in the repository settings.
