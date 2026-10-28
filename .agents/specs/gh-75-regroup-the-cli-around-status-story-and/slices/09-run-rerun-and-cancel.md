---
id: gh-75/09
title: run rerun and run cancel
depends_on: [gh-75/03]
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
  - { id: AC9, verifier: agent }
---

## Goal
A person can stop a running agent without cancelling the story (`norn run cancel`) and resume or move a unit (`norn run rerun [--step]`); `unstick` is gone.

## Scope
Behaviour: B2 (rerun, cancel), B5 (for `unstick`), B48, B49, B50, B51, B52, B53. Seams: S1 (fake runner). Out: printed `norn unstick …` hints (slice 14).

## Acceptance
- AC1 (B51) Given gh-N running `implement`, when a `stuck` receipt by the person with reason `cancelled by person` is at the cursor, then the next tick treats it as the end of that run: the unit is stuck under Unblock and is not relaunched, retried or nudged (proven first, at the tick, before the command). — verifier: test
- AC2 (B51) `norn run cancel gh-N` writes that receipt first and then stops the session through the runner (the fake runner's kill is recorded after the receipt exists, P6); the next tick does not restart it. — verifier: test
- AC3 (B52) After `run cancel`, the commits, uncommitted changes in the worktree, the branch, the claim and the Herdr pane are all still there; `norn run rerun gh-N` resumes `implement` in a fresh session. — verifier: test
- AC4 (B53) `run cancel` on a unit waiting at a gate → refused `nothing_to_cancel`; on a unit whose claim another machine holds → refused, do_instead `norn story checkout gh-N`; both exit 3. Without a target it offers only running units. — verifier: test
- AC5 (B48) Given gh-N stuck at `implement`, `norn run rerun gh-N` resumes `implement` in a fresh session; `--reset <counter>` and `--reason` act as on `unstick`; parked and gate-waiting units resume as `unstick` resumed them. — verifier: test
- AC6 (B49) Given gh-N stuck at `qa`, `norn run rerun gh-N --step implement` moves it to `implement`, as `unstick --to` did. — verifier: test
- AC7 (B50) Given gh-N running, `norn run rerun gh-N` → refused (exit 3), do_instead `norn run cancel gh-N`. — verifier: test
- AC8 (B5, B2) `norn unstick` is a usage error (exit 2) "Unknown command: unstick"; `norn run` lists `rerun` and `cancel` among its verbs. — verifier: test
- AC9 (B51, B52) In a throwaway repo with the headless runner, `run cancel` stops a live agent process and `run rerun` starts a fresh one. — verifier: agent

## Checks
- `bun test`
- `bun run typecheck`
- `bun run golden`

## Notes
D4: no new receipt kind (B70). Risk: decide must accept a person's `stuck` at the cursor of a running unit; AC1 is the first red test. If decide's behaviour changes, update the golden corpus with `bun run golden -- --update` and review that diff as exactly this. The runner contract already covers kill; headless and Herdr differ in what kill means, so use it as is.
