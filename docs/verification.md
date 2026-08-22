# Verification

How we prove the lessons work — in code, in a real browser, and as durable artifacts.

## Layers

| Layer                       | Command                                     | What it proves                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + property tests       | `pnpm test`                                 | CRDT laws (commutative, associative, idempotent, convergent), reducer semantics, DSL schema/paths/builders, regex VM, uuid builders, stage DOM contracts, player machine.                                                                                 |
| Content gate                | `pnpm test` (`src/content/content.test.ts`) | Every topic validates against the Zod schema, builds a full timeline through the real reducer with every `expect` enforced, and lints clean (narration length, "Whoops" rule, glossary terms, delivered messages, …).                                     |
| Browser behaviour           | `pnpm e2e`                                  | Shell (routes, sidebar, settings, theme, locale/RTL) and a walk of every step of every topic through `window.__lab` in Chromium, Firefox and WebKit: narration, stage step, URL `?step=` stay in sync. `PW_BROWSERS=chromium,webkit` narrows the set.     |
| Storyboards (durable proof) | `pnpm verify`                               | For every topic: a screenshot of every step (stage + narration + transport), `steps.json`, a contact sheet (`contact.jpg`), a dark-theme sheet for the first topic of each unit, and `verification/index.html` linking everything. Committed to the repo. |

## How the walker works

The topic page installs `window.__lab` when opened with `?lab=1` (`src/lesson/player/lab.ts`):
`total`, `current()`, `goto(i)`, `next()`, `prev()`, `settle()` (fonts ready → two animation frames →
all running animations finished). `?motion=off` forces instant commits so frames are deterministic.
`e2e/lab.ts` wraps this; `e2e/topics.spec.ts` and `e2e/verify/storyboards.spec.ts` drive it.

## Reading a storyboard

Open `verification/index.html`. Each topic shows its contact sheet and the list of steps with the
narration. A frame should make sense on its own with its sentence: that is the test a human applies,
and the reason every step must be a legible static state.

## Regenerating

```sh
pnpm verify                 # build + all topics + index
pnpm verify:quick           # reuse the running preview server
pnpm exec playwright test --project=verify -g "crdts/state-based/or-set"   # one topic
node scripts/verification-index.mjs                                        # rebuild the index only
```

Commit the regenerated `verification/` folder with the change that altered the frames, and look at
the sheets before committing — the point is that a human looked.
