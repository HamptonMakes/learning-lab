# Content style guide

How to write a topic. Read this before authoring or reviewing any lesson. The schema and lints in
`docs/animation-dsl.md` §13 enforce the hard rules; this guide explains the judgment calls.

## Voice

- **Simple Technical English.** Short sentences. One idea per sentence. Present tense, active voice.
- Plain words: "use", "send", "check", "keep", "lose". Not "leverage", "utilize", "facilitate".
- No marketing adjectives, no drama, no filler ("robust", "seamless", "powerful", "simply", "just").
- Sparse colour is welcome at _moments_: "Whoops — now we have a problem." "That is the deal you
  accept." One such line per scene at most.
- Talk to one reader: "you". Name actors by name: "Alice sends her state to Bob."
- Numbers and ids in narration must be the real ones on the stage (`t=2`, `alice:1`, `Lunch`).
  The lint checks this; the stage is the source of truth, the narration points at it.

## Shape of a step

- `say` is **1–2 sentences, ≤ 160 characters.** If you need a third sentence, split the step.
- Each step shows one thing happening. A step that changes nothing is a narration-only step
  (`do: []`) and should be rare: a rule card (`note`) or a summary (`step.long`).
- First sentence = what happens. Optional second sentence = why it matters or what to look at.
- Define a term the first time it appears with `**Term**` (the glossary provides the definition on
  hover) and, if needed, a short plain-words gloss in the same sentence.
- Mark simplifications: "(simplified)" when the stage shows plain values for something a real
  system computes, or when we skip a detail on purpose.

## Shape of a topic

1. **Hook (1–2 steps):** the situation, in concrete terms (a status line; a shopping list; two
   phones). No definitions yet.
2. **The thing itself:** the data structure and its sidecar, shown on one or two cards.
3. **Update → send → merge:** one change at a time. Show the rule card (`note`) before the first
   merge. Use `expect` to pin the narration's numbers.
4. **The interesting case:** the race, the tie, the re-add, the lost write. This is the reason the
   topic exists. Mark it: `conflict`, `cross`, `tomb`, `compare`.
5. **Convergence:** `same(...)` across replicas. Say it plainly: "Both copies agree."
6. **In context (own scene):** the same type inside a realistic composed document, with the types
   taught earlier in the unit.
7. **Summary (`step.long`):** the deal you accept. One or two sentences.
8. **Panels:** `whenToUse` / `whenNotToUse` (3–5 bullets each, ≤ 90 characters), `realWorld` (one
   sentence naming real systems), `goal` (what the learner can do afterwards).

## Stage legibility

- ≤ 5 actors; ≤ 6 fields per card; ≤ 8 visible items; values ≤ 24 characters; labels ≤ 12.
- Prefer two actors for the atomic concept; add a third only when the concept needs it (gossip,
  causality, relay).
- Keep names short and gendered-neutral beyond the fixed cast: Alice, Bob, Carol, Dana; Server;
  Phone / Laptop (owned devices share the owner's hue).
- One rule card per scene, upserted (`note('rule', …)`) as the rule grows.
- `clearMarks()` before a new beat when old bolts/callouts would confuse.

## Review checklist (adversarial pass)

Read the script twice: once as a skeptical senior engineer, once as a junior developer.

- Is every claim true for the real implementation? (Run the topic: `expect`s fail loudly.)
- Could a sentence be shorter? Is any word jargon that was never defined?
- Does every step show exactly what the narration says, and nothing else important?
- Is the "interesting case" the one a practitioner actually hits?
- Do `whenToUse` / `whenNotToUse` let a reader pick the right type without reading the rest?
- Would a screenshot of each step, with its sentence, make sense on its own?

## Translation

- English is authored inline. Other locales overlay by stable ids (`topic.scene.step.say`,
  `topic.scene.step.callout[0].text`, …). Never renumber step ids; append new steps.
- Data values (`milk`, `Lunch`, `alice:1`) are not translated; UI chrome and narration are.
- Keep sentences free of idioms that do not translate ("the deal you accept" is fine; puns are not).
