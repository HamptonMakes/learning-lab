# Architecture

How the lab is put together, in one read. The product brief is `overview.md`; the working rules are
`CLAUDE.md`; the animation contract is `docs/animation-dsl.md`; the renderer/player design is
`docs/stage-architecture.md`.

## The idea in one paragraph

A lesson is **data**: a topic is a list of scenes, a scene is a world plus an ordered list of steps,
and a step is one or two sentences of narration plus typed **commands**. A pure **reducer** turns
commands into immutable **world states**, so `state[n]` is a function of the step list — prev, next
and seek are deterministic. Where the data is a CRDT, the reducer calls the **real implementation**
in `src/crdt/`; lessons never hand-write a merge result. The **stage** renders one world state with
React and lets Motion animate the difference to the previous one. The **player** moves between
states and owns timing, keyboard, sound, analytics and the URL. Tests and storyboards assert on the
static frames, which is why every step must be legible without an animation having played.

## Layers

```
content  ──►  lesson  ──►  stage  ──►  app
(data)        (reducer,    (render)    (routes, chrome, player wiring)
              timeline,
              player)
   │             │
   └──► crdt ◄───┘        regex, uuid: small engines used by the reducer/builders
```

| Folder                                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/`                                  | Lesson data only: `catalog.ts` (Module › Unit › Topic metadata), `registry.ts` (lazy loader via `import.meta.glob`), one `<module>/<unit>/<topic>.ts` per topic (default export = `Topic`), `glossary.ts`. `content.test.ts` is the gate every topic must pass (schema, timeline with `expect`s, lint-clean).                                                                                                                                                                                                                                                                                     |
| `src/lesson/`                                   | The DSL: `types.ts` (spec types, verbatim), `schema.ts` (Zod mirror + validation rules), `path.ts` (path grammar and lenses), `builders/` (authoring API: structure, actors, values, 43 commands, typed CRDT sugar, macros), `reducer/` (one file per command family; `applyStep`, `diff`, `timeline`; `crdt.ts` is the delivery layer: ids, time, dedupe, causal readiness, outbox/inbox, gc), `crdt-view/` (replica → `Value` projections, `opLabel`), `player/` (state machine, hold budget, `usePlayer`, keyboard, `window.__lab`), `lint.ts` (content lints), `fixtures/` (worked examples). |
| `src/crdt/`                                     | Real CRDTs, pure TS: LWW register/map, MV/max registers, G/PN/op counters, G/2P/LWW-element/OR sets, RGA, Lamport/vector/hybrid clocks, composed documents (`doc.ts`). Property-tested with fast-check (`laws.ts`: merge laws, convergence, op convergence).                                                                                                                                                                                                                                                                                                                                      |
| `src/regex/`                                    | A backtracking VM that advances one character test at a time and projects its state into stage values (pattern, text, stack, captures, tries).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/uuid/`                                     | UUID v4/v7 byte builders with version/variant forcing and annotations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/stage/`                                    | The renderer: `Stage.tsx` (root, layers), `layout/` (CSS-grid presets), `actor/` (cards, badges, inbox tray, outbox chips), `board/`, `hud/`, `value/` (every `Value` kind, meta badges, via chips), `message/` (tokens on arcs, decks, transient flights), `marks/` (bolts, compare links + verdict chips, flow arrows, callouts, pills), `geometry/` (anchor registry keyed by DSL path, arc math), `motion/` (speed/reduced-motion/instant provider), `StageContext.tsx` (per-frame derived data).                                                                                             |
| `src/app/`                                      | TanStack Router routes (`/$locale/$module/$unit/$topic?step=`), the Studio shell (sidebar tree, header breadcrumb, settings), transport bar, narration, topic panels, `/design` style guide.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/ui/`, `src/styles/`                        | shadcn/ui primitives and the Lab Notebook design tokens (`tokens.css`) mapped to Tailwind utilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/i18n/`, `src/locales/`                     | UI catalogs (`ui.json` per locale), `t()`/`tn()`, provider (sets `lang`/`dir`), lesson overlay helpers keyed by stable ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/settings/`, `src/sound/`, `src/analytics/` | Typed localStorage store + hooks; Web Audio synth; provider-based analytics (Umami).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `e2e/`, `verification/`, `scripts/`             | Playwright shell tests, the topic walker, the storyboard writer, and the committed proof (`verification/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Data flow on a topic page

1. The route loader finds the topic in the catalog and lazy-loads its module from the registry.
2. `buildTimeline(topic)` folds every scene: `initWorld(scene.world)` → `applyStep` per step →
   `Frame { index, sceneId, step, world, prev, changes }`. Memoized per topic.
3. `usePlayer(frames)` owns the index, play/pause, speed and hold timer; `next` animates, `prev`/seek
   commit instantly (Motion's `useInstantTransition`); it emits analytics, sounds and progress, and
   syncs `?step=`.
4. `<Stage frame>` renders the world: actor cards place their values via `ValueView`; overlay layers
   read measured rects from the anchor registry (keyed by DSL path) to draw tokens, bolts, links,
   arrows, callouts and pills. `frame.changes` tells primitives what to flash and where tokens go.
5. `<Narration>` shows `step.say` (terms get glossary tooltips); `<TransportBar>` drives the player.

## Determinism, testing, proof

- Reducer, builders, schema, paths, CRDTs, regex, uuid: Vitest (unit + property tests).
- Stage: jsdom DOM-contract tests per primitive (`data-path`, `data-kind`, `data-value`, …).
- Content gate: every topic validates, builds with `expect`s enforced, and lints clean.
- Browser: `e2e/shell.spec.ts` (chrome), `e2e/topics.spec.ts` (walks every step of every topic
  through `window.__lab` in Chromium/Firefox/WebKit), `e2e/verify/storyboards.spec.ts` (screenshots
  every step, writes contact sheets and `steps.json` under `verification/`, committed).

## Conventions that keep it coherent

- Ids are stable forever (topic/scene/step/message/op ids); translations and URLs key on them.
- No pixels, durations or easing in content; no literal transitions in primitives (`tr(kind)` only);
  no CSS `transition-*`/`animate-*` classes inside the stage.
- Every user-visible string goes through `t()` or is a localizable lesson field.
- Colour is never the only signal: every tone pairs with an icon, glyph or word.
