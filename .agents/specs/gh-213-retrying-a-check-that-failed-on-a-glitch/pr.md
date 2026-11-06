## Summary

A check that failed on a glitch (CI hiccup, machine load, a flaky test) is now retried on unchanged code with one command, `norn run rerun <unit> --step <check>`. Before, you had to cancel, wait for stuck and then rerun. `norn run view <unit> --json` now also says whether the work changed since the fail, so a person or the `norn-fsd-round` supervisor can tell a glitch from a real failure without git tricks. The new rule is O2a.

```diff
 run rerun <unit> --step <to>
-  unit running            → refuse "running", do instead: run cancel   (B50)
+  checkRetryOf(wf, st) == to                                            (O2a)
+    i.e. last outcome is <to>.fail, its edge sent the unit to the step it is at,
+         and that step is ready or running
+    → accept: unstick receipt to <to>; the next tick stops the step's session (S7 kill path) and runs the check
+  other unit running      → refuse "running", do instead: run cancel   (B50 unchanged)

 run view <unit> --json
+  check_retry: { check, failed_at, code_changed, command } | null
+    code_changed = commits since the fail's boundary commit (S4 trailers) + uncommitted changes,
+                   ignoring the spec's handoffs/ (and an older layout's runs/); null when it can't be told
```

`norn-fsd-round` and SK3 no longer use the `run cancel` and `git log … ':(exclude,glob)**/runs/**'` workaround. They read `check_retry.code_changed` and rerun at the check directly. `docs/recipes.md` gains a paragraph on this.

## Evidence

This was a quick round with no QA step, so the evidence is the new tests (unit tier, type check and the new integration test are green, per implement and review). The items come from the issue's Wanted.

- **W1** `run rerun --step <check>` is accepted while the unit sits at the step that check's fail sent it to
  **Before:** refused with `running` (`run-rerun.ts:40`)
  **After:** `run-rerun-check.test.ts` uses a check that fails once and then passes. After the fail sends the unit back to a running `implement`, `rerun gh-9 --step test` exits 0 with an `unstick` receipt `{ to: "test", step: "implement" }`. `apply.test.ts` checks that the receipt applies while the unit is ready or running.
- **W2** The rerun stops that step's session itself
  **Before:** a manual `norn run cancel` was needed first
  **After:** in the integration test, the next tick kills the implement session (`runner.killed` holds its `session_id`), the check passes on the same code, and the unit reaches `$done`. `decide.test.ts` asserts the same kill decision.
- **W3** Every other rerun of a running unit is still refused (B50)
  **Before:** refused
  **After:** still refused with `running`: `rerun gh-9` with no `--step`, and `rerun gh-9 --step implement`. `apply.test.ts` rejects an unstick to another step or with no step.
- **W4** `run view --json` says whether the work changed since the fail, and norn's own commits don't count
  **Before:** did not exist. The `<check>.fail → implement` boundary commit made `git log -1 <branch>` useless for this.
  **After:** the integration test sees `code_changed: false` right after the fail (norn's commit ignored), then `true` with an uncommitted file, `true` once that file is committed, `false` after a reset, and `check_retry: null` after `$done`. `decide.test.ts` covers `isStepBoundary` and `isCodePath`.
  **Not shown:** the `code_changed: null` branch (no worktree, or no boundary commit in the last 200) and the markdown line `run view` adds without `--json` have no tests (review finding F2).
- **W5** `norn-fsd-round` drops the cancel and git-log workaround
  **Before:** the skill told the supervisor to `run cancel` and then read `git log … :(exclude…)`
  **After:** `assets.test.ts` checks the skill's phrases: it reads `check_retry.code_changed` and never runs `run cancel`.

## Merge danger

**Door:** two-way: there is no new file format or persisted shape. `check_retry` is an added field in `run view --json` output, and the rerun reuses the existing `unstick` receipt and S7 kill path.

**Blast radius:** CLI users and the supervisor. `run rerun --step` can now stop a running agent session, but only when the step it names is the check whose `fail` sent the unit to the step it is at. `run view <unit>` without a run id now runs a local observe on every call (review F1). That makes it slower for a supervisor that polls it, and an observe error now fails a command that used to read only the trace.
