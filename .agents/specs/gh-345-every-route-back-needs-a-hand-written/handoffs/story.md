## Goal

Refine gh-345 (derived default counters for workflow edges): spec written in spec.md, every decision made by the person, no open questions.

## Proof

- spec.md: Problem Statement, Solution (with the table of defaults), 32 user stories, Out of Scope, Further Notes; Open questions: none.
- Every decision confirmed by the person in the refine session (summary under Notes).

## Easy to miss

- A dotted counter name becomes valid in stored formats (`state.json` counters, the exhausted park): this is a one-way choice. An older norn reading such a state marks the unit corrupt, so it belongs in the PR's merge danger. Names declared under `counters:` stay dotless.
- A shared exit's counter is `<use step>.<exit>`, shared by every inner edge that leaves through it. Its default comes from the kind of those inner edges, not a fixed "exit" row. Edges of mixed kinds behind one exit are refused unless the route gives `max:`.
- "an outcome named by exits" in the issue's table means a check's own `exits:` code map (max 5), not a shared file's exits.
- `norn status`, `story view` and the watch take a counter's max from the pinned workflow's `counters:`. Derived counters must show their max there too, as must the brief's at_limit and `rerun --reset`.
- Shipped overrides needed: `ship.ci-failed` max 3, `resolution-review.changes_requested` max 2, story's `slice.reject` max 3. `qa_loop` stays a shared name (a check fail plus a gate reject share 2).

## Not proven yet

- Nothing for refinement. The invariant (shipped workflows keep the same edges, maxima, sharing and resets) is for the plan and build to prove, with a test for slice's `merge.conflict` exception.

## Notes

Decisions by the person:
- Name `<step>.<outcome>`, the dot allowed in stored names only; one-way format, listed in the merge danger.
- A check's `exits:`-named outcome other than `stale`: 5, never resets.
- A shared exit: `<use step>.<exit>`, with the default from the kind of the inner edges; mixed kinds refused unless `max:` is given (names the exit and the kinds).
- `max:` together with `counter:`: refused. `max:` on an edge that derives nothing: counts it as `<step>.<outcome>`, with no reset. `max:` on an edge to `$done`/`$stuck`: refused.
- slice's `conflict_loop` is dropped and derived. The added reset on `merge.done` (to `$done`) is the one stated exception to "reset edges unchanged", with a test showing the bound is the same.
- Listing derived counters before a run (doctor): out of scope, belongs with #341.
- Derived counters show with their max in status, story view and the watch: in scope.

## Resume

Next round: planning (`norn-plan`) against spec.md, started by a person.
