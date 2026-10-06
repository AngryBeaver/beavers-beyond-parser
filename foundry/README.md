# Beaver's Beyond Parser

![Latest Release](https://img.shields.io/github/v/release/AngryBeaver/beavers-beyond-parser)
![Foundry Core Compatible Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-beyond-parser%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Foundry Systems](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fsystem%3FnameType%3Draw%26showVersion%3D1%26style%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-beyond-parser%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Download Count](https://img.shields.io/github/downloads/AngryBeaver/beavers-beyond-parser/total?color=green)

![Setup Complexity](https://img.shields.io/badge/setup%20complexity-3%2F5-orange)

Imports content you own on D&D Beyond into Foundry VTT (dnd5e):

- **Adventures** become journals: one `JournalEntry` per chapter, one page per heading, with links between
  chapters, monsters and spells rewritten to Foundry links.
- **Monsters** become NPC actors with their actions, traits and spells.
- **Spells** are linked from your compendiums, or created when no compendium has them.
- **Images** (portraits / tokens, maps, artwork) are copied into your Foundry data, so everything works offline.

## ⚠️ Setup ⚠️

<div style="background-color: #171713; border-left: 4px solid #e68a00; padding: 15px; margin: 10px 0; border-radius: 4px;">

**⚠️ Medium Complexity Warning ⚠️**
This module is not plug-and-play. Besides the module itself you have to run a small Docker container and copy a
cookie out of your browser. If you have never used Docker or your browser's developer tools, expect to spend some
time on the steps below.
</div>
Stuck? Feed this documentation to your AI of choice (ChatGPT, Claude, etc.) and it will likely be able to guide you
through the setup.

### Requirements

- Foundry VTT 13 or 14 with the **dnd5e** system (5.3 or newer, including 6.x)
- [Docker](https://www.docker.com/products/docker-desktop/) on the machine your browser runs on
- A D&D Beyond account that owns the content you want to import

### 1 — Get your CobaltSession cookie

The proxy fetches pages from D&D Beyond as you, so it needs your session cookie.

1. Log in to [dndbeyond.com](https://www.dndbeyond.com) in your browser.
2. Open the developer tools (`F12`) → **Application** (Chrome / Edge) or **Storage** (Firefox) → **Cookies** →
   `https://www.dndbeyond.com`.
3. Copy the value of the cookie named `CobaltSession`.

Treat this value like a password: anyone who has it can act as you on D&D Beyond. It expires after a while; when
imports start failing with *"DDB rejected CobaltSession"*, copy a fresh one and restart the container.

### 2 — Start the proxy

Browsers are not allowed to read D&D Beyond pages from inside Foundry, so a small proxy does it for them.

```bash
docker run -d --name beyond-parser --restart unless-stopped \
  -p 3001:3001 \
  -e COBALT_SESSION=paste_your_cookie_value_here \
  angrybeaver/beyond-parser:latest
```

Open <http://localhost:3001/health> — it should answer `{"ok":true}`.

To change the cookie later: `docker rm -f beyond-parser`, then run the command again with the new value.
To update the proxy: `docker pull angrybeaver/beyond-parser:latest`, then remove and start it again.

> The proxy has no authentication and hands out content from your D&D Beyond account. Keep it on your own machine
> (`localhost`) and do not expose port 3001 to the internet.

### 3 — Install and configure the module

Install the module in Foundry with this manifest URL:

```
https://github.com/AngryBeaver/beavers-beyond-parser/releases/latest/download/module.json
```

Enable it in your world, then check **Game Settings → Configure Settings → Beaver's Beyond Parser**:

| Setting | Meaning |
|---|---|
| **Parser Proxy URL** | Where the proxy runs. The default `http://localhost:3001` matches the command above. |
| **Enable AI Support** | Optional. Uses the [beavers-ai-assistant](https://github.com/AngryBeaver/beavers-ai-assistant) module to match monster features against compendium items. Leave it off if you do not use that module. |

## Usage

All importers are GM only and sit in the header of the matching sidebar tab.

| Sidebar | Button | Paste |
|---|---|---|
| Journal | **Import Adventure** | The adventure's main page, e.g. `https://www.dndbeyond.com/sources/dnd/lmop` |
| Actors | **Import Monster** | A monster page, e.g. `https://www.dndbeyond.com/monsters/16907-goblin` |
| Items | **Import Items** | A spell page (`https://www.dndbeyond.com/spells/…`) |

An adventure import also imports every monster and spell the adventure links to. Monsters and spells that already
exist in one of your compendiums (for example the official Player's Handbook or Monster Manual modules) are linked
instead of imported again. New actors land in the `dndbeyond` actor folder, new spells in `dndBeyond → Spells`.

## Images

Every image an import references is copied into your Foundry user data under `beyond/` before the documents are
created. Imported content therefore works offline, and tokens render on the canvas.

```
beyond/
  index.json                           which D&D Beyond image each copy came from
  monsters/16907-goblin/portrait.png   one folder per monster, named after its D&D Beyond id
  sources/lmop/map-1-1-cragmaw-hideout.jpg
  spells/schools/evocation.png
```

Images are stored per entity, not under their D&D Beyond file name. Importing something again reuses the existing
copy, and when D&D Beyond has replaced the artwork in the meantime the copy is overwritten instead of stored twice.

If the proxy cannot deliver images (not running, or an old version), the import still works but keeps links to
D&D Beyond. Those images need an internet connection and do not show up as tokens on the canvas.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| *"Proxy URL not set"* or the import window reports the proxy as unavailable | The container is not running, or **Parser Proxy URL** points to the wrong address. Check <http://localhost:3001/health>. |
| *"DDB rejected CobaltSession"* | The cookie expired or was copied incompletely. Get a fresh one and restart the container. |
| A chapter or monster is skipped | Your D&D Beyond account does not own that content. |
| *"images are not copied locally"* | The proxy is older than the module. Pull the latest image and restart the container. |
| Tokens of earlier imports are blank on the canvas | They still link to D&D Beyond. Delete the actor and import it again. |
