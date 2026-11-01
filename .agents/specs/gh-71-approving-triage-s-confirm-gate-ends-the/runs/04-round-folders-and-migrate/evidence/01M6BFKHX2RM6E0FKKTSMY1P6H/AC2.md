# AC2 (B31): one runs/_story/handoff.md; Goal/Progress/Resume survive a report — pass

gh-10 (dev build, round layout): `norn brief --json` lists the handoff input as
`.agents/specs/gh-10-fresh-round/runs/_story/handoff.md`. Wrote G10-GOAL / G10-PROGRESS / G10-RESUME
in the three sections, ran `norn done done --handoff "did bar"`, ticked through the check. handoff.md afterwards:
  ## Goal
  G10-GOAL
  ## Progress
  - G10-PROGRESS
  - implement#1 done: did bar
  ## Resume
  G10-RESUME
Same on gh-9 after its migration: the review step (dev build) kept QA-GOAL-MARKER / QA-PROGRESS-MARKER and
the edited Resume, plus "review#1 approve: looks good". No handoff.md inside rounds/.
Integration test "AC2: …" passes.
