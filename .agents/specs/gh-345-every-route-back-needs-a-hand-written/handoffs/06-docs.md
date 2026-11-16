# gh-345/06 — Docs for derived counters and max on an edge

## Goal
An author can write a workflow from the docs alone: defaults table, both naming rules, `max:` on an edge with its refusals, and when `counter:`/`counters:` is still needed; the glossary's counter entry says a counter is named or derived from its edge.

## Proof
- AC1 (docs give the defaults table, naming, `max:`, refusals, when to name a counter): new section `docs/recipes.md` › "Bound a loop" (table matching `packages/core/src/derive-counters.ts` constants: check fail/exits 5, gate reject 2, conflict 2 with reset, stale 10, agent send-back 3; `<step>.<outcome>` and `<use step>.<exit>`; `max:` on an edge and on a use route; the four refusals incl. mixed-kind exit; `qa_loop` shared + `reset_on` example). `docs/concepts.md` › outcome paragraph sums up the defaults and links there; glossary `counter` row says named under `counters:` or derived from its edge.
- AC2 (docs lints pass, reference current): `bun run docs:emit` left `docs/reference.md` unchanged; `bun run test` 2113 pass, 0 fail; `bun run typecheck` green.

## Easy to miss
- The examples follow the shape of the shipped `quick.yaml` (`fail: { to: implement, max: 3 }`, bare `reject: implement`, `stale: update`); old `counter: test_loop`/`ready_loop`/`ci_loop`/`stale_loop` examples in recipes were rewritten.
- Refusal wording in the docs paraphrases the loader messages in `derive-counters.ts`; if those change, update "Bound a loop".

## Not proven yet
- AC1 is an agent verifier: a reviewer reads the two docs against the criterion.

## Notes
- Docs only; no code touched. `bun install` was needed in this worktree before `docs:emit` could resolve `@norn/schema`.

## Resume
Review the docs diff (`git diff main -- docs/`) against AC1.
