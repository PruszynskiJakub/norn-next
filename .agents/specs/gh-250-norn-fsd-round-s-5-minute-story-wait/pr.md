## Summary

`norn-fsd-round` now keeps every wait under Claude Code's foreground limit (~180 s), so a supervising subagent's wait is never moved to the background and nobody improvises wrapper scripts that hide norn commands from the permission check.

```diff
 subagent loop
-  norn story wait <story> --until gate --timeout 5m        # backgrounded after ~180 s
+  norn story wait <story> --until gate --timeout 160s      # Bash timeout about 178 s
 parked gate
-  norn story wait <story> --until merged --timeout 5m
-  gh run watch <run-id> --exit-status
+  norn story wait <story> --until merged --timeout 160s
+  timeout 170 gh run watch <run-id> --exit-status          # exit 124: watch again
+new Shape rule: run every norn and gh command directly, never through a script or in the background
 brief
-  exit 7: five minutes passed
+  exit 7: the timeout passed
```

## Evidence

- **Waits under the foreground limit** (`--timeout 160s`, Bash timeout about 178 s, `timeout 170 gh run watch`)
  **Before:** the skill said `--timeout 5m` and a bare `gh run watch`; Claude Code backgrounded every wait.
  **After:** `packages/cli/test/unit/assets.test.ts` › fsd-round terms test asserts "under the harness's foreground limit", "Bash timeout about 178 s", both `--timeout 160s` waits and `timeout 170 gh run watch <run-id> --exit-status`, and that no `--timeout 5m` remains; red before the skill edit, green after. `160s` parses with `parseDuration`; `/usr/bin/timeout` exists on macOS (checked in review).
- **Run norn and gh directly, never through a script or in the background**
  **Before:** not stated; subagents wrapped norn commands in scratchpad scripts watched by Monitor.
  **After:** same test asserts "never through a script or in the background"; red before, green after.
- **Exit 7 worded "the timeout passed"**
  **Before:** "exit 7: five minutes passed".
  **After:** same test asserts "exit 7: the timeout passed" and that "five minutes" no longer appears; red before, green after.

Whether a real fsd round now waits without backgrounding was not observed: it needs a supervised round in Claude Code after the next release refreshes the installed skill copy.

## Merge danger

**Door:** two-way: a skill text change and a test; a revert restores the old wording.

**Blast radius:** fsd rounds: only supervisors running `norn-fsd-round` notice, as waits that return every 160 s instead of 5 min (more `norn status`/`story view` reads per round). Low risk.
