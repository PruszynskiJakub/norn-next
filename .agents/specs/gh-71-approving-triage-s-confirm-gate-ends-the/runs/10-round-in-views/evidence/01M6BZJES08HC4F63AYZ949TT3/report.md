# QA gh-71/10 — rounds in the views

Suites on HEAD 90f718d27: unit tier 1022 pass / 0 fail (unit.log); typecheck exit 0 (tc.log); slice integration checks status/story-view/records 28 pass / 0 fail (int.log).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B28) | pass | AC1-4-records-test.log, AC5-transcript.md | header "Round 1 · Workflow: triage · Step: explore (attempt 1)" and "Round 2 · Workflow: story · Step: refine (attempt 1)" observed |
| AC2 (B28) | pass | AC1-4-records-test.log, AC5-transcript.md | status --json items carry round {n:2, workflow:story}; story view md "round 2 · story · parked at refine", --json unit.round 2 / workflow story |
| AC3 (B29, B32) | pass | AC1-4-records-test.log, AC5-transcript.md | "round 1 · triage · finished", "round 2 · story · ended by the person at refine", "round 1 · triage · ended by the person at confirm" observed |
| AC4 (B36) | pass | AC1-4-records-test.log | flat gh-1 fixture: one heading "round 1 · story · finished", no rounds/ folder, worktree clean, HEAD unchanged |
| AC5 (B28, B29) | pass | AC5-transcript.md, AC5-scenario.test.ts | throwaway repo, this branch's cli, repo's real triage/story/quick workflows; plain `status` markdown shows no round (note) |
