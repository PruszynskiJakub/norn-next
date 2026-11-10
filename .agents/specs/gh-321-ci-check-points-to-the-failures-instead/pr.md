## Summary

When the `ci` check fails, the rework brief now says where the failures are (run and check-run links, failed ids, the annotations command) instead of a log tail that cut off the failing assertion.

```diff
 ci (check), after the run goes red
-  gh run view "$run" --log-failed | tail -300          # repo story/quick/release
-  gh run view "$run" --log-failed | tail -200 per run   # shipped story/quick
+  sh .agents/scripts/ci-failures.sh "$run"              # repo: run URL, "- job <id>: <name>", annotations command, --log-failed --job fallback
+  list failed check runs from commits/$sha/check-runs   # shipped: "- <name> (id <id>): <link>", then the annotations command
   exit 1
```

Core and the brief (`TAIL_LINES`) are unchanged.

## Evidence

No QA ran: the review re-ran every command by hand against the red run 42794918379. The unit tier cannot run workflow shell, so no test covers it.

- **Failing check block holds links, failed ids and the annotations command in about 10 lines, no test log**
  **Before:** the last 60 lines of `--log-failed`, mostly passing tests and job cleanup; the assertion was cut off.
  **After:** `ci-failures.sh 42794918379` prints 5 lines: the run URL, `- job 129757664390: integration (shard 3/4)`, the annotations command and the `--log-failed --job` fallback. The shipped query prints `- integration (shard 3/4) (id 129757664390): <link>`.
- **The annotations command shows the failing assertion with file and line, without `.github` noise**
  **Before:** did not exist.
  **After:** for check run 129757664390 it prints `packages/cli/test/integration/upgrade.test.ts:227 Expected: true / Received: false`, with no `.github` entries.
- **A green run still exits 0 with no output**
  **Before:** exits 0, silent.
  **After:** not run. Checked by reading: `gh run watch … && exit 0` and `gh pr checks --watch … && exit 0` come before the changed lines and are untouched.

Not run yet: the new `ci` check on a real red PR. This PR's own `ci` step only runs the repo path if CI fails.

## Merge danger

**Door:** two-way: only workflow shell and one new script change, so a revert restores the log tail.

**Blast radius:** rework agents: if the commands break, a red `ci` hands implement less to work with.
