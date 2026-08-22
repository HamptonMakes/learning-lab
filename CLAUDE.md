# CLAUDE.md — Hampton's Computer Science Concept Learning Lab

This file is the contract for every agent and human working in this repo. Read it fully before
changing anything. `overview.md` is the product brief (the "why"); this file is the "how".

## 1. What this is

An interactive, animation-driven learning site that teaches practical CS concepts that self-taught
engineers usually skip and universities teach only in theory. First full module: **CRDTs**
(distributed data types). Prototype modules: UUIDs, Regex, Columnar stores.

Audience: working programmers and product people. It will be attached to hamptonmakes.com and used
to mentor real coworkers. It is also a portfolio piece — **the quality bar is "would Hampton be
proud to put his name on this screen?"** for every screen, every sentence, every animation.

Two things are judged above all else: (1) the clarity and correctness of the lessons/animations,
(2) the quality of the technical implementation.

## 2. Agreed decisions (do not relitigate; propose changes in a PR description, not by drift)

| Area               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Pure client app. React 19 + TypeScript (strict) + Vite. No SSR.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Routing            | TanStack Router, file-based, type-safe. Locale is the first URL segment: `/en/crdts/state-based/lww-register`. Reloading any URL must work.                                                                                                                                                                                                                                                                                                                                            |
| Styling            | Tailwind CSS v4 + shadcn/ui (Radix primitives) for chrome. Design tokens are CSS variables defined once in `src/styles/tokens.css`. Light + dark themes.                                                                                                                                                                                                                                                                                                                               |
| Design language    | "Lab Notebook": warm off-white paper, near-black ink, faint grid on the stage, one accent (deep teal), a small semantic palette for actors (Alice / Bob / Carol / Server each own a hue). Geist Sans for UI, JetBrains Mono for data values. Calm, crisp, a little personality.                                                                                                                                                                                                        |
| Layout             | "Studio": collapsible left tree (Module › Unit › Topic with progress), wide stage, narration + transport controls directly under the stage, "When to use / Try it / Next" strip below. Header breadcrumb always shows Module › Unit › Topic. Desktop-first (≥1024px primary), but must not break at 768px.                                                                                                                                                                             |
| Animation          | **Motion** (`motion` package, motion.dev) over DOM + an SVG overlay. No canvas/WebGL. Lessons never contain raw animation code — they contain _commands_ (see §4). The renderer animates the _difference_ between consecutive world states.                                                                                                                                                                                                                                            |
| Lesson data        | TypeScript modules under `src/content/` that are pure data built with the DSL helpers, validated by Zod schemas at test time. (Typed data, no logic in lessons.) A DB is not used in v1.                                                                                                                                                                                                                                                                                               |
| CRDTs              | Real implementations in `src/crdt/` (framework-free, pure TS). Lessons drive these implementations; animations show real state. Property tests (fast-check) prove merge laws.                                                                                                                                                                                                                                                                                                          |
| i18n               | English is authored inline in lesson files. Other locales are overlay JSON files keyed by stable step/scene/topic ids in `src/locales/<lang>/`. UI chrome strings go through `t()`. Target locales after English is final: `zh`, `hi`, `es`, `ar` (RTL), `fr`. Layout must be RTL-safe (logical CSS properties).                                                                                                                                                                       |
| Analytics          | `src/analytics/` exposes `track(event, props)` and a `Provider` interface. `UmamiProvider` is the only provider for now (configured by `VITE_UMAMI_SCRIPT_URL` + `VITE_UMAMI_WEBSITE_ID`). Nothing else may reference Umami directly.                                                                                                                                                                                                                                                  |
| Settings           | Sound on/off, speed, theme, locale, reduced-motion, sidebar state → localStorage via one typed store in `src/settings/`.                                                                                                                                                                                                                                                                                                                                                               |
| Sound              | Web Audio API synthesized tones ("bloop" on arrival, soft tick on step, chord on topic complete). No audio assets. On by default; audio can only start after the first user gesture (browser autoplay policy); the user can turn it off in settings.                                                                                                                                                                                                                                   |
| Tests              | Vitest (+ fast-check) for CRDT math, DSL, reducers. Playwright (Chromium, Firefox, WebKit) for real-browser behavior: every topic is walked step-by-step. Lint: oxlint; format: Prettier.                                                                                                                                                                                                                                                                                              |
| Verification proof | `pnpm verify` walks every step of every topic in a real browser, asserts narration + key stage state, and writes screenshot storyboards to `verification/` (committed). This is the durable proof of animation quality.                                                                                                                                                                                                                                                                |
| Deploy             | Multi-stage `Dockerfile` (build → Caddy serving `dist/` with SPA fallback + `/up` health). `config/deploy.yml` for Kamal 2 (Docker Hub `hamptonlc/cs-lab`, proxy SSL). **This repo is open source:** no secrets, tokens, or credentials ever appear in the repo or in env files — `.kamal/secrets` holds only Proton Pass CLI commands (`pass-cli item view --vault-name kamal …`). Public Vite vars (`VITE_UMAMI_*`) are not secrets. Postgres is available in prod but unused in v1. |
| Package manager    | pnpm. Node 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 3. Repository layout

```
src/
  app/            App shell: routes (TanStack file routes), layout, header, sidebar, transport bar
  ui/             shadcn/ui components + our own design-system components (Button, Toggle, …)
  styles/         tokens.css (design tokens), globals.css, fonts
  stage/          The animation renderer. World-state → React + Motion. One folder per primitive
                  (actor, document, message, list, tree, bytes, regex, callout, …)
  lesson/         The DSL: types, schema (Zod), builders (step/scene/topic/unit/module),
                  the world reducer (commands → next state), player state machine (play/pause/speed)
  crdt/           Real CRDT implementations + vector clocks. Pure TS, zero deps, fully tested.
  content/        Lesson data only. content/<module>/<unit>/<topic>.ts. No logic.
  i18n/           t(), locale loading, overlay merge for lesson text, RTL helpers
  locales/        <lang>/ui.json and <lang>/<module>.json overlays
  analytics/      Provider interface, UmamiProvider, track(), event catalog (typed)
  settings/       Typed localStorage store + React hooks
  sound/          Web Audio synth + hooks
docs/             architecture.md, animation-dsl.md, content-style-guide.md, verification.md
e2e/              Playwright tests (+ the verify walker)
verification/     Generated storyboards (PNG contact sheets + index.html). Committed.
config/           Kamal deploy.yml
```

## 4. The animation model (the heart of the project)

- A **Topic** has one or more **Scenes**. A Scene declares its **world** (actors, documents, data
  structures) and an ordered list of **Steps**.
- A **Step** = `{ id, say, do }`: a stable id, one or two plain sentences of narration, and a list of
  **commands**. Commands are typed data (`set`, `send`, `deliver`, `merge`, `highlight`, `callout`,
  `spawn`, `remove`, `reorder`, `annotate`, `compare`, …) — never functions, never timings.
- The **reducer** applies commands to the world to produce the next immutable world state. Given a
  scene, state at step N is a pure function of the step list → prev/next/seek are deterministic.
- The **renderer** (`src/stage/`) renders a world state with React. Motion `layout`/`layoutId`,
  `AnimatePresence`, and SVG path animations make the _difference_ between states visible:
  values physically travel between actors, fields flash when they change, conflicts are marked.
- The **player** owns: current step index, playing flag, speed multiplier (0.5×–3×), auto-advance
  timing, keyboard shortcuts (←/→/space), and fires analytics + sounds.
- Where a lesson's data is a CRDT, the world's document state is computed by the real
  implementation in `src/crdt/` (the command says `merge("bob", "alice")`; the reducer calls the
  real `merge`). Lessons must not hand-write the results of merges.

Rules:

- **Never** put durations, pixel coordinates, easing, or imperative animation calls in `src/content/`.
  If you need a new visual behavior, add a command + renderer support in `src/stage/`, document it in
  `docs/animation-dsl.md`, and add a renderer test.
- Every primitive must support: reduced motion (instant), speed multiplier, dark/light, RTL.
- Every step must render correctly as a _static_ state (this is what screenshots and tests check).
- Keep the stage legible: max ~5 actors, short values, no wall-of-text inside the stage.

## 5. Content rules (the lessons)

Style: **Simple Technical English.** Short sentences. Plain words. One idea per step.

- Narration per step: **1–2 sentences max.** If you need a third, split the step.
- No undefined jargon. The first use of a term gets a one-line definition (and a glossary entry).
- Sparse color is welcome: "Whoops — now we have a problem." Use it to mark _moments_, not filler.
- No paragraphs on the lesson page. Longer prose lives only in the "When to use" panel, as bullets.
- Every atomic concept is followed by an **in-context example** (a realistic composed document or
  system) that uses it together with concepts already taught in the Unit.
- Every topic ends with **When to use / When not to use** and a **real-world example**.
- Be technically exact. If a simplification is used, the narration says so ("(simplified)").
- Content changes require an **adversarial review pass** (a second agent reads the script as a
  skeptical senior engineer _and_ as a junior dev, and flags: wrong, unclear, jargon, too long).
- Stable ids: `step` ids never change once published (translations key on them). Append, don't
  renumber.

The full guide lives in `docs/content-style-guide.md` — update it when a rule is learned.

## 6. Engineering rules

- TypeScript strict; no `any`, no `@ts-ignore`, no non-null assertions without a comment.
- Lesson data must pass the Zod schema; `pnpm test` fails if any topic is invalid.
- Everything user-visible goes through the design system: tokens + `src/ui/`. No ad-hoc hex colors,
  no arbitrary spacing values outside `tokens.css`. Use logical properties (`ms-`, `pe-`, `start`).
- Accessibility: keyboard-operable transport and nav; narration in an `aria-live="polite"` region;
  `prefers-reduced-motion` respected; color never the only signal (icons/labels too).
- Analytics: only `track()` from `src/analytics/`; events are declared in the typed event catalog.
- Settings: only via the settings store; never touch `localStorage` directly elsewhere.
- Sound: only via `src/sound/`; never `new AudioContext()` elsewhere.
- Routing: only via TanStack `Link`/`navigate`; never `window.location` for in-app navigation.
- No new dependencies without a one-line justification in the PR/commit body. Prefer official,
  well-maintained, widely used packages only.
- Commit style: Conventional Commits (`feat:`, `fix:`, `content:`, `docs:`, `test:`, `chore:`).
- Before finishing any task: `pnpm check` (typecheck + lint + format check + unit tests) must pass.
  If you touched the stage, player, routing, or content: also `pnpm e2e` (or the relevant spec).
  If you touched animations or content: regenerate the affected storyboards with `pnpm verify`.

## 7. Commands

```
pnpm install
pnpm dev              # Vite dev server (http://localhost:5173)
pnpm build            # production build to dist/
pnpm preview          # serve dist/
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint (the Vite-official linter; config in .oxlintrc.json)
pnpm format           # prettier --write ; `pnpm format:check` in CI
pnpm test             # vitest (unit + property tests + lesson schema validation)
pnpm check            # typecheck + lint + format:check + test
pnpm e2e              # playwright (all browsers)
pnpm verify           # real-browser walk of every topic → verification/ storyboards
pnpm docker:build     # build the production image locally
```

## 8. Working agreements for agents

- Work in small, reviewable commits. Don't leave the tree red.
- If you are unsure whether something belongs in content vs. stage vs. lesson, read §4 again; the
  answer is almost always "add a command".
- When you add a primitive, a command, a CRDT, a topic, or a setting: update the relevant doc in
  `docs/` in the same change.
- Do not "improve" the design language, layout, or stack on your own. Propose, don't drift.
- Do not weaken tests, skip verification, or commit generated storyboards that you didn't look at.
- Prefer clarity over cleverness, in code and in prose.
