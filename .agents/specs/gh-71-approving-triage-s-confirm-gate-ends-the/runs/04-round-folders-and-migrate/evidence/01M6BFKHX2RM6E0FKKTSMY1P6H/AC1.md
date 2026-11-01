# AC1 (B30): new story's record is round 1 — pass

Throwaway repo under $TMPDIR (bare origin, scripted `gh` on PATH, NORN_HOME_DIR isolated). The dev build
(`bun packages/cli/src/main.ts`) started stories gh-10 (workflow trio: implement → check → review) and
gh-11 (triofail: same with a failing check). brief → `done done --evidence <dir>` → ticks ran the check.

gh-10 files after implement + check pass (worktree and the pushed branch on origin are the same):
  runs/_story/handoff.md
  runs/_story/rounds/01-trio/evidence/<run>/e.txt
  runs/_story/rounds/01-trio/receipts/0001-started.json
  runs/_story/rounds/01-trio/receipts/0002-done.json
  runs/_story/rounds/01-trio/receipts/0003-check.json
  runs/_story/rounds/01-trio/state.json
  runs/_story/rounds/01-trio/workflow.yaml
`ls runs/_story` → handoff.md rounds

gh-11 (failing check, so a log is written):
  runs/_story/rounds/01-triofail/logs/<run>.log   (receipt 0003-check.json: "log":"logs/<run>.log")
`ls runs/_story` → handoff.md rounds

`norn done` printed receipt `.agents/specs/gh-10-fresh-round/runs/_story/rounds/01-trio/receipts/0002-done.json`.
Also: integration test round-folders.test.ts "AC1: …" passes (AC1-5-round-folders.log).
