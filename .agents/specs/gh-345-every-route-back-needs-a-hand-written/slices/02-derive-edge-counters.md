---
id: gh-345/02
title: Derive a counter per edge at load, with max on the edge
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: test }
  - { id: AC12, verifier: agent }
---

## Goal
An author no longer writes a counter for an ordinary loop. An edge with no `counter:` is pinned with a counter named `<step>.<outcome>`, with its default max and, for a conflict, its reset. `max: <n>` on the edge changes only the bound. A unit with such a counter is stored and validated without being marked corrupt.

## Scope
User stories: a check's fail and exits-named outcomes bounded at 5; a gate's reject at 2; conflict at 2 with reset; stale at 10; an agent send-back on an uncounted loop at 3; no counter for forward edges; the `<step>.<outcome>` name; `max:` replacing the default; `max:` counting a non-deriving edge; `max:` with `counter:` refused; `max:` to `$done`/`$stuck` refused; `counter:`/`counters:` working as today; no derived counter beside `counter:`; declared names staying dotless; a loop still uncounted refused; old workflows loading as before; dotted names validating where stored; doctor passing defaults and reporting the edge refusals. Seams: S1, S3, and S4 for doctor. Out: shared-file exits (slice 03), what status/brief/rerun show (slice 04), shipped workflow edits (slice 05).

## Acceptance
- AC1 Given a workflow whose check `test` has `fail: implement` (no counter), when it is loaded, then the pin has a counter `test.fail` with max 5 and no reset on that edge. The same holds for an outcome the check's `exits:` map names (other than `stale`). — verifier: test
- AC2 Given a gate's `reject: implement`, a step's `conflict: resolve`, and a `stale: update` on a check, a gate and a merge step, when loaded, then they pin `<step>.reject` max 2, `<step>.conflict` max 2 resetting on every other outcome declared on that step, and `<step>.stale` max 10. — verifier: test
- AC3 Given a review agent with `changes_requested: implement` whose loop no other edge counts, when loaded, then it pins `review.changes_requested` max 3. An agent outcome on no uncounted loop, and every `done`, `pass` or `approve` edge, gets no counter. — verifier: test
- AC4 Given `fail: { to: implement, max: 3 }`, when loaded, then the pin has `test.fail` with max 3 and the same reset as without `max:`. Given `max: 4` on an edge that would derive nothing (a gate's `approve` leading back), then it is counted as `<step>.approve` with max 4 and no reset. — verifier: test
- AC5 Given an edge with both `max:` and `counter:`, when loaded, then the load is refused with a file error pointing at the edge and saying a named counter's max goes under counters. — verifier: test
- AC6 Given `max:` on an edge to `$done` or `$stuck`, when loaded, then the load is refused, naming the edge and saying there is no loop to bound. — verifier: test
- AC7 Given a workflow with a `counters:` block and edges naming them with `counter:` (a check's fail and a gate's reject sharing one budget of 2, and a custom `reset_on`), when loaded, then those edges keep their named counter, derive nothing, and count as before. — verifier: test
- AC8 Given `counters:` declaring a dotted name, or an edge with `counter: review.changes_requested` and no such declared counter, when loaded, then the load is refused as an invalid or undeclared counter name. — verifier: test
- AC9 Given a loop that no edge counts even after derivation (only agent `done` edges, say), when loaded, then it is refused with the `cycle without a counter` message naming its edges, as today. — verifier: test
- AC10 Given a workflow in which every route back already names a counter (today's bundled and repo files), when loaded, then its pinned source and hash are unchanged byte for byte. A workflow that derives at least one counter is pinned as the derived text. — verifier: test
- AC11 Given a `state.json`, an exhausted park, a receipt's reset list and a pinned workflow that hold a dotted counter name like `review.changes_requested`, when validated, then they pass. A written workflow's `counters:` key or `counter:` with a dot is still refused. — verifier: test
- AC12 Given a throwaway repo with a workflow that leaves every default unwritten, and others with `max:` plus `counter:` on one edge and `max:` on an edge to `$done`, when `norn doctor` runs (the dev build), then the first passes and each of the others is reported with the edge it is about. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` (after the schema change; commit the emitted files)

## Notes
- D1, D2, D3, D4, D6 and D7. The derivation is one pure function in core. The store writes its result into the text inside `loadWorkflowText`, after flattening and before pinning.
- Risk from the Plan: list every caller of `parseWorkflowText` and the flattener (record-ref restart, story edit, upgrade wording, tick trace). Make sure each one that reads a *workflow file* (not a pin) goes through the loader. Otherwise `max:` is refused as a schema error there, or an underived text gets pinned. A pin is read as written and never derived again.
- The agent row reuses `elementaryCycles` over the edges still uncounted after the other rows and the named counters. Rows 1–4 count their edge even off a loop (the person's decision).
- Until slice 03, an edge that came from a shared file derives per edge like any other. No shipped file is affected, since their shared edges all name counters.
