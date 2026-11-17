# gh-345/06 — Docs for derived counters and max on an edge

## Goal
An author can write a workflow from the docs alone: defaults table, both naming rules, `max:` on an edge with its refusals, and when `counter:`/`counters:` is still needed; the glossary's counter entry says a counter is named or derived from its edge.

## Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | recipes and concepts give the defaults table (check fail/exits 5, gate reject 2, conflict 2 with reset, stale 10, agent send-back 3), both naming rules, `max:` on an edge with its two refusals, the mixed-kind exit refusal, when `counter:`/`counters:` is still needed; glossary counter entry says named or derived | agent | QA (agent); review#1 read `docs/recipes.md` › "Bound a loop", the concepts outcome paragraph and glossary row against `packages/core/src/derive-counters.ts` and found them matching |
| AC2 | docs lints pass and the emitted reference is current after `bun run docs:emit` | test | unit tier docs lints: review#1 ran `bun run docs:emit` (tree unchanged), `bun run test` 2119 tests, 0 fail, `bun run typecheck` green |

## Easy to miss
- The examples follow the shape of the shipped `quick.yaml` (`fail: { to: implement, max: 3 }`, bare `reject: implement`, `stale: update`); old `counter: test_loop`/`ready_loop`/`ci_loop`/`stale_loop` examples in recipes were rewritten.
- Refusal wording in the docs paraphrases the loader messages in `derive-counters.ts`; if those change, update "Bound a loop".

## Not proven yet
- AC1 is agent-verified: QA gives its verdict in the criteria report.

## Notes
- Docs only; no code touched. `bun install` was needed in this worktree before `docs:emit` could resolve `@norn/schema`.
- Review#1 approved with one minor note: the `use`-route `max:` example in "Bound a loop" names exit `ci-failed`, while the shared-file example just above uses `green`/`red`/`behind`.

## Resume
QA the slice against AC1 by reading the two docs.
