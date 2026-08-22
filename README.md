# Hampton's Computer Science Concept Learning Lab

Interactive, animation-driven lessons that make hard CS ideas practical. The first full module is
**CRDTs (distributed data types)**; UUIDs, Regex, and Columnar stores exist as prototypes that prove
the animation system generalizes.

Every lesson is a **simulation, not a cartoon**: the CRDT animations are driven by real CRDT
implementations in `src/crdt/` (property-tested with fast-check), and every step is described as
plain data (a sentence or two + typed commands) that the stage renders and animates.

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm check        # typecheck + lint + format + unit tests
pnpm e2e          # real-browser tests (Chromium, Firefox, WebKit; PW_BROWSERS=chromium,webkit to narrow)
pnpm verify       # walk every lesson in a browser, write storyboards to verification/
```

## Layout of the repo

See `CLAUDE.md` §3 for the folder map and §4 for the animation model. The design system is
documented live at `/en/design` when the app is running. Architecture notes live in `docs/`.

## Deploy

Static build served by Caddy in a small container; `config/deploy.yml` is a Kamal 2 config.
This repo is open source: secrets never live here. `.kamal/secrets` pulls the registry token from
Proton Pass CLI (`pass-cli`, vault `kamal`) at deploy time.

```sh
cp .env.example .env            # set VITE_UMAMI_WEBSITE_ID (public, from analytics.lin.cat)
pnpm docker:build               # local image check
VITE_UMAMI_WEBSITE_ID=… kamal setup   # first time
VITE_UMAMI_WEBSITE_ID=… kamal deploy
```

## Author

Hampton Lintorn-Catlin — https://hamptonmakes.com
