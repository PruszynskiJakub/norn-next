# Audit: base sync and honest QA (dogfood on the Todoist sandbox)

Two runs of `SPEC-base-sync-and-qa.md` on the Todoist sandbox, three checkouts on one Mac (`NORN_MACHINE` simulated machines), herdr and headless runners, no `bypassPermissions`, no wrapper scripts, no manual `norn sync`.

| Run | Code | Result | Fixed in |
|---|---|---|---|
| [run-1](run-1/) | 078b513 | Base sync and QA refusals work end to end. Audit ([audit.md](run-1/audit.md)) found C1–C5 and a HIGH: norn's own park commit pushed conflict markers mid-merge. | 18d8478, afa89c0 |
| [run-2](run-2/) | afa89c0 | Targeted rerun: Merge item, QA after a ruling, shipped `story` workflow with slices, `status` base sync, counter reset all work. New: D3 (HIGH, a unit mid-merge went silent), D5 (HIGH, an agent's merge commit with markers was pushed), D4, D1, D6. | 253b3b1 |

Not tested in either run: an agent dying mid-merge, resolve → `stuck`, exhausting `base_conflict_loop`, an agent with the `browser` capability, two real machines. AC3 of the sandbox stories was never checked in a browser; every approval says so.

Open after 253b3b1: D2 (an agent's `git add -A` sweeps norn's deferred `runs/` files into its merge commit), D7 (small items, see run-2 `friction.md`), and a runner that reports a continuous `waiting_input` older than the last answer would not re-raise a second prompt.
