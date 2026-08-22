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
pnpm e2e          # real-browser tests (Chromium, Firefox, WebKit)
pnpm verify       # walk every lesson in a browser, write storyboards to verification/
```

## Layout of the repo

See `CLAUDE.md` §3 for the folder map and §4 for the animation model. The design system is
documented live at `/en/design` when the app is running. Architecture notes live in `docs/`.

## Deploy

Static build served by Caddy in a small container; `config/deploy.yml` is a Kamal 2 config.

```sh
pnpm docker:build
kamal setup && kamal deploy
```

## Author

Hampton Lintorn-Catlin — https://hamptonmakes.com
