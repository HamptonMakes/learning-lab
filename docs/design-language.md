# Design language — "Workbench"

_A beige computer on a desk, 1991._ The Lab moved from "lab notebook" to this on 2026-08-23
(Hampton's call: Desktop-'91 chrome with Beige-Box readability — "Commodore"). Readable first,
then fun: the retro flavour lives in **materials and chrome**, never in the typefaces the learner
reads.

## Two worlds

|            | Hardware (page, sidebar, transport, panels)                                                                    | Screen (the stage)                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Surfaces   | putty-beige `--paper/-2/-3`, ivory `--card`                                                                    | cool grey-white `--screen` with a faint 4px dither (`--screen-2`)                                                              |
| Parts      | **bezel** around the screen (`--bezel*`), **keycaps** (`--key*`), the orange **power key** (`--power*`) = play | **windows**: white `--window`, 1px `--window-ink` border, hard 2px shadow, square corners, striped **title bar** with the name |
| Readouts   | **LED panel**: Doto digits on `--led-panel` in `--led`; the lit step dot is `--led-amber`                      | **sticky notes** (`--note`) for text boards                                                                                    |
| Type       | Archivo (UI), JetBrains Mono (values), **Doto only for LED digits**                                            | same                                                                                                                           |
| Accent     | CRT cyan `--accent` for interactive chrome (active tab, links, focus)                                          | `--accent` is also the `change` tone (rings/flashes on changed values)                                                         |
| Dark theme | "graphite box": dark plastic, same bevels, LEDs glow                                                           | dark CRT: dark grey screen, dark windows with light borders                                                                    |

Actors keep their hues (Alice coral, Bob blue, Carol violet, Dana amber, Server slate); colour is
never the only signal.

## Where it lives

- `src/styles/tokens.css` — every colour/radius/shadow, light + `.dark`.
- `src/styles/globals.css` — token → Tailwind mapping, plus the chrome utilities:
  `stage-surface` (dithered screen), `bezel`, `window`, `title-bar`, `note`, `key-cap`
  (Button variants `key` and `power` — the power colours switch on `data-variant="power"`),
  `led-panel`.
- `src/stage/actor/ActorCard.tsx` + `ActorHeader.tsx` — a window with a title bar (title tab at the
  start, badge tab at the end; owner/subtitle captions under the bar).
- `src/stage/board/BoardCard.tsx` — text boards are sticky notes, other boards are windows.
- `src/stage/hud/ClockHud.tsx` — "NOW" over an LED readout.
- `src/app/components/transport-bar.tsx` — the deck: putty bar, keycaps, orange play, LED dots.
- `/$locale/design` — the living style guide with swatches and the chrome pieces.

## Rules

- Stage overlays measure against the stage root's border box, so the **bezel is a wrapper** around
  the root (`Stage.tsx`), never a border on the root.
- Pixel/dot-matrix type only where digits are short and large (the clock). Narration, sidebar and
  values never use it.
- Keep the dither barely visible (ΔL ≈ 0.008). If a screenshot reads as "texture", lower it, don't
  raise card contrast to compete.
- Hard shadows are 2px and only on windows/notes on the screen; hardware uses bevels, not shadows.
- Everything else in CLAUDE.md §6 still applies: tokens only, logical properties, both themes,
  RTL-safe, reduced motion.
