# AC6 (B30, B34): regenerated fixtures differ only by moved paths — pass

Diff vs base gh-71-approving-triage-s-confirm-gate-ends-the: 3 transcripts + 5 observe snapshots changed;
brief snapshot and view fixtures unchanged. With `runs/_story/rounds/01-<wf>` folded back to `runs/_story`,
what's left (AC6-residual.txt):
- transcripts: the start_run/record commit pathspec now names `rounds/01-<wf>` + `runs/_story/handoff.md`
  instead of `runs/_story` (4 lines each × 3 files) — the moved record path plus the story handoff.
- observe snapshots: the new `record` fact (D2) per unit.
No migrate commit appears since no transcript fixture is flat.
All tiers on this head: unit 995/0, integration 529/0, e2e 72/0, typecheck clean, schema emit clean
(integration.log, e2e.log).
