## Goal

GR6 cleanup records a merged story's units done, so a story merged while parked (at `ready` or anywhere) leaves the inbox and `story wait --until done` returns (#88); then, if the person wants it in this round, a workflow merging its own PR (#72).

## Progress

- #88 done, committed. Decide's `cleanup_merged_story` (`packages/core/src/decide/story.ts`, `finishMerged`) now carries `finish`: every unit with a valid state not yet `done`, recorded `done` with `park` and `run` cleared (step kept). Act (`cleanupMerged`, `packages/cli/src/runtime/act/lifecycle.ts`) writes those states first, before the archive push, so the archived record carries them; a failed archive leaves the cleanup owed and the next tick writes the same states.
- Units that failed validation are left alone (S2).
- GR6 in `.agents/RULES.md` amended to say so.
- Tests: decide unit test (`gh-88 GR6: …` in `packages/core/test/unit/decide.test.ts`, also checks the inbox has only Recently done items afterwards); `runtime.test.ts` GR6 test now parks the unit at a gate before the merge and checks `state.json` is done after (red without the act change, checked).
- Golden: `bun run golden -- --update` rewrote 3 cases (only the new `finish` field). Transcript `test/e2e/transcripts/base-sync.txt` updated (one new state.json write at cleanup).
- Stories cleaned up by an older norn (gh-60, gh-69, gh-76) keep their parked state; not migrated.
- Not changed: `norn-fsd-round` still waits `--until merged`; it could go back to `--until done` now (triage note), left for a later change.
- #72 (a workflow merging its own PR) is out of this round, by the person's decision: it changes GR5 and has open decisions (merge method, whether an approved gate counts as a person merging, refused merges), so it gets its own refinement round.
- implement#1 done: GR6 cleanup records every unfinished unit of a merged story done (park and run cleared) before the archive push, so a story merged while parked leaves the inbox and wait --until done returns (#88). Tests: decide unit test + runtime integration GR6 test (red without the fix); golden (3 cases) and base-sync transcript updated; GR6 amended. #72 left out of this round by the person's decision, for its own refinement round.
- resolve#1: merged main (e7cdb0ca07c4). main had rehashed the golden corpus, so the three conflicting golden files took main's version (human-2c151c9a51be deleted, as on main) and `bun run golden -- --update` re-added this story's `finish` field: again exactly 3 cases (audit-470fe1ac4b61, base-sync-30ba4bba3b9e, human-cfb52b49def3). Unit tier, typecheck and the base-sync e2e file green.
- resolve#1 done: Merged main (e7cdb0ca07c4). Golden conflicts: took main's rehashed corpus, then golden --update re-added this story's finish field (3 cases, as before). Unit tier, typecheck, base-sync e2e green.

- review#1: approve, no blocking findings (1 minor). The spec has no numbered Behaviour items (quick workflow); rows are #88's "Wanted" points. Traceability:

| Item | Verifier | Proven by |
| --- | --- | --- |
| #88 W1: a story merged while parked leaves Approve / Your turn / Running | test | `packages/core/test/unit/decide.test.ts` › "gh-88 GR6: a PR merged while parked at a gate → the cleanup records every unfinished unit done; the inbox then has nothing for it" |
| #88 W2: the unit's state is done after cleanup (`norn status`, `story wait --until done`) | test | `packages/cli/test/integration/runtime.test.ts` › "PR merged → worktree, branches, claim ref and slot removed; a unit parked at merge time recorded done (GR6, gh-88)" |
| #88 W3: no claim held or renewed for a story main records done | test | same runtime test (claim ref gone); re-acquisition already refused by R3.2 (`story.ts` `baseDone`) |
| #72: a workflow merges its own PR | person | out of this round by the person's decision (own refinement round) |
- review#1 approve: Review approved: GR6 cleanup records unfinished units of a merged story done before the archive; pure decide, atomic write, S2 kept; tests at decide and runtime seams. 1 minor (older cleaned-up stories not repaired, deliberate).

## Resume

Review approved. Next: the workflow's following step (QA / PR / ready). #72 waits for its own refinement round.
