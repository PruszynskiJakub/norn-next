# AC7 (B34): released norn → this build ticks a parked story — pass

Released: norn 0.15.0 (`~/.norn/bin/norn`). Throwaway repo $TMPDIR/qa-gh71-04/sandbox (bare origin, scripted gh,
NORN_HOME_DIR isolated). Released norn: init, intake + start gh-9 (workflow duo), brief, done done --evidence,
tick → parked at review (status: "review is ready (manual)"), record flat.
Dev build (`bun packages/cli/src/main.ts tick`):
  tick 1 → round.migrate (only decision); tick 2 → agent.ready.manual
  git log: exactly one new commit "norn: gh-9 record moved into round 1" (5 × R100 renames), pushed
  record: runs/_story/rounds/01-duo/{state.json,workflow.yaml,receipts/0001,0002,evidence/…}; runs/_story = handoff.md + rounds
  status (dev): gh-9 review is ready (manual) — same step as before
See AC3.md for the full output.
