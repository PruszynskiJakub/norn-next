### Goal

One command retries a check that failed on a glitch on unchanged code, and `run view --json` says whether the work changed since the fail (gh-213).

### Progress

- New rule O2a in `.agents/RULES.md`: `run rerun <unit> --step <check>` is accepted on a ready or running unit when that check's fail (its last outcome) sent the unit to the step it is at. The tick applying the receipt stops the step's session through decide's existing S7 kill path (no new act). Every other rerun of a running unit is still refused with `running` → `run cancel` (B50 kept).
  - core: `checkRetryOf(wf, st)` in `apply.ts`; `unstick` accepts that one case. Tests: `apply.test.ts`, `decide.test.ts` (the session is killed).
  - cli: `run-rerun.ts` lets the retry through before the running/not_stuck refusals. Integration test: `packages/cli/test/integration/run-rerun-check.test.ts` (a check that fails once, then passes).
- `run view <unit> --json` now carries `check_retry: { check, failed_at, code_changed, command } | null`. `code_changed` reads git: commits since the fail's boundary commit (matched by S4 trailers, `isStepBoundary`) plus uncommitted worktree changes, ignoring the spec's `handoffs/` and an older layout's `runs/` (`isCodePath`). It is null when that can't be told. The markdown output gets a line for it too. Code: `packages/cli/src/runtime/check-retry.ts`, `localUnit` in `human.ts`.
- SK3 and `norn-fsd-round` (source in `packages/cli/assets/skills/`) drop the cancel → wait → rerun workaround and the `git log … :(exclude…)` test. They read `check_retry.code_changed` and rerun at the check directly. The supervisor never runs `run cancel` now. `docs/recipes.md` has a paragraph on it.
- Decision: no Plan existed (quick round), so I settled the triage's open questions as follows. The retry applies only at the step the check's fail routed to, only while that step hasn't ended, and only for `fail`. It does not refuse when the code changed; it reports that in `run view` so the caller judges. B50 is still only cited in code comments, as before.

- review#1: approve. There are no Behaviour items (quick round), so the rows below come from the spec's Wanted and Observed.

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1: `run rerun --step <check>` accepted while the unit is at the step that check's fail sent it to (ready or running) | test | `packages/core/test/unit/apply.test.ts` › "gh-213 (O2a): rerun at the check whose fail sent the unit here applies while it is ready or running"; `packages/cli/test/integration/run-rerun-check.test.ts` › "rerun --step test is accepted; …" |
| W2: the rerun stops that step's session itself | test | `packages/core/test/unit/decide.test.ts` › "gh-213 (O2a): a rerun at the check … stops the session and enters the check"; integration › "rerun --step test is accepted; the next tick stops the session …" |
| W3: other reruns of a running unit still refused (B50) | test | integration › "rerun without --step, or at another step, is still refused: stopping it is run cancel"; apply.test (unstick to review / no --step rejected) |
| W4: `run view --json` says whether the work changed since the fail (norn's own commits don't count) | test | integration › "run view --json names the check, the rerun, and whether the work changed since …"; decide.test › "isStepBoundary … isCodePath …" |
| W5: fsd-round drops the cancel/git-log workaround | test | `packages/cli/test/unit/assets.test.ts` › skills (fsd-round phrases) |

Minor findings (not blocking): `run view` now runs a local observe on every call (F1); the `code_changed: null` branch and the markdown line are untested (F2).

- describe#1: PR body written to `pr.md` in the spec folder (summary diff of the rerun/run view shape, evidence W1–W5 from the tests with F2 marked not shown, two-way door, F1 in the blast radius).
- resolve#2: merged main c207e7c01 (#247 simplify bypass). Conflicts: `run-rerun.ts`, where main renamed the local `blocked` to core's `rerunnable` and the O2a retry check now uses `rerunnable`; `policy.ts` imports kept both sides (`isClosedStatus` + `HANDOFFS_DIR`/`RUNS_DIR`/`SPECS_DIR`). Unit tier, typecheck and integration tier are green.
- review#2 (on HEAD after the merge of main c207e7c01): approve. The W1–W5 table above still holds with the same tests; test#2 was green on this HEAD. The merge resolution checks out: core's `rerunnable` (stuck/parked) matches apply's `unstick` guard, and apply checks `checkRetryOf` again at apply time, so a rerun that races with implement reporting is rejected. 3 minor findings: F1 run view observes on every call, F2 the `code_changed: null` branch and the markdown line are untested, F3 `LOG_LIMIT` 200 walks merged-in base commits (null on a large base merge, which errs on the safe side).

- describe#2 (on HEAD after the merge of main c207e7c01): reread the diff and found `pr.md` still accurate. Changes: the Evidence intro now cites test#2 on this HEAD, W1's Before no longer points at a stale line number, and W4's not-shown note names F3 (LOG_LIMIT 200 after a large base merge).

### Resume

Report describe done; the next step is norn's (open/update the PR).

## Progress

- describe#2 done: pr.md rechecked on current HEAD (after main c207e7c01 merge): still accurate; evidence intro cites test#2 on this HEAD, stale line ref dropped, F3 noted under W4's not-shown.
