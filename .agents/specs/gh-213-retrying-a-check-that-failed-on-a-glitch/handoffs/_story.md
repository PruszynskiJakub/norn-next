### Goal

One command retries a check that failed on a glitch on unchanged code, and `run view --json` says whether the work changed since the fail (gh-213).

### Progress

- New rule O2a in `.agents/RULES.md`: `run rerun <unit> --step <check>` is accepted on a ready or running unit when that check's fail (its last outcome) sent the unit to the step it is at. The tick applying the receipt stops the step's session through decide's existing S7 kill path (no new act). Every other rerun of a running unit is still refused with `running` → `run cancel` (B50 kept).
  - core: `checkRetryOf(wf, st)` in `apply.ts`; `unstick` accepts that one case. Tests: `apply.test.ts`, `decide.test.ts` (the session is killed).
  - cli: `run-rerun.ts` lets the retry through before the running/not_stuck refusals. Integration test: `packages/cli/test/integration/run-rerun-check.test.ts` (a check that fails once, then passes).
- `run view <unit> --json` now carries `check_retry: { check, failed_at, code_changed, command } | null`. `code_changed` reads git: commits since the fail's boundary commit (matched by S4 trailers, `isStepBoundary`) plus uncommitted worktree changes, ignoring the spec's `handoffs/` and an older layout's `runs/` (`isCodePath`). It is null when that can't be told. The markdown output gets a line for it too. Code: `packages/cli/src/runtime/check-retry.ts`, `localUnit` in `human.ts`.
- SK3 and `norn-fsd-round` (source in `packages/cli/assets/skills/`) drop the cancel → wait → rerun workaround and the `git log … :(exclude…)` test. They read `check_retry.code_changed` and rerun at the check directly. The supervisor never runs `run cancel` now. `docs/recipes.md` has a paragraph on it.
- Decision: no Plan existed (quick round), so I settled the triage's open questions as follows. The retry applies only at the step the check's fail routed to, only while that step hasn't ended, and only for `fail`. It does not refuse when the code changed; it reports that in `run view` so the caller judges. B50 is still only cited in code comments, as before.

### Resume

Done: unit tier and typecheck are green. The new integration test and the related integration files pass locally. Next: the `test` check.

## Progress

- implement#1 done: O2a: run rerun --step <check> is accepted on a ready/running unit when that check's fail sent it there; the tick stops the session via the existing S7 kill. run view --json gains check_retry {check, failed_at, code_changed, command}. RULES O2a + SK3, norn-fsd-round skill and recipes updated. Unit tier + typecheck green; new integration test run-rerun-check.test.ts passes.
