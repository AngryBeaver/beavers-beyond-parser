# Beaver's Beyond Parser

![Latest Release](https://img.shields.io/github/v/release/AngryBeaver/beavers-beyond-parser)
![Foundry Core Compatible Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-beyond-parser%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Foundry Systems](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fsystem%3FnameType%3Draw%26showVersion%3D1%26style%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-beyond-parser%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Download Count](https://img.shields.io/github/downloads/AngryBeaver/beavers-beyond-parser/total?color=green)

![Setup Complexity](https://img.shields.io/badge/setup%20complexity-3%2F5-orange)

A Foundry VTT module that imports D&D Beyond adventures, monsters and spells you own into Foundry (dnd5e),
including local copies of all images.

**Installing and using the module: see [foundry/README.md](./foundry/README.md).** In short: start the proxy
container with your D&D Beyond session cookie, install the module, paste a D&D Beyond URL.

```bash
docker run -d --name beyond-parser --restart unless-stopped \
  -p 3001:3001 -e COBALT_SESSION=paste_your_cookie_value_here \
  angrybeaver/beyond-parser:latest
```

## What's in this repo

| Directory | What it is |
|---|---|
| [`foundry/`](./foundry) | The Foundry VTT module |
| [`proxy-parser/`](./proxy-parser) | Node.js proxy — fetches D&D Beyond pages and images server-side (browsers are blocked by CORS). Published as the `angrybeaver/beyond-parser` Docker image |
| [`test-tools/`](./test-tools) | Scripts that validate imported monsters against the dnd5e compendiums |

## Building from source

```bash
pnpm install
cd foundry
pnpm build        # into foundry/dist
pnpm devbuild     # into the Foundry modules folder set as "devDir" in foundry/package.json
pnpm test
```

Run the proxy from source instead of the published image:

```bash
cp proxy-parser/.env.example proxy-parser/.env   # then fill in COBALT_SESSION
pnpm build:proxy
docker compose -f beyond-parser-compose.yml up -d
```

## Releasing a new version

Push a commit to the default branch whose message starts with `release v` followed by a semver, e.g.:

```
release v0.2.0
```

GitHub Actions will:
1. Typecheck and test, then build and publish a release zip + `module.json` to GitHub Releases
2. Register the version on foundryvtt.com
3. Build and push the Docker image to DockerHub as `angrybeaver/beyond-parser:0.2.0` and `:latest`
4. Commit the version to the `package.json` files

Requires the `FOUNDRY_RELEASE_TOKEN`, `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets set in the repository settings.
