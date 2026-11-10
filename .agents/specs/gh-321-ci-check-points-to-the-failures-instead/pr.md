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

No QA ran: the entries are the review's hand re-run against the red run 42794918379 and `ci-check.test.ts` (integration tier, fake gh), which asserted the old log output and now asserts the pointers.

- **Failing check block holds links, failed ids and the annotations command in about 10 lines, no test log**
  **Before:** the last 60 lines of `--log-failed`, mostly passing tests and job cleanup; the assertion was cut off.
  **After:** `ci-failures.sh 42794918379` prints 5 lines (run URL, `- job 129757664390: integration (shard 3/4)`, annotations command, `--log-failed --job` fallback); the shipped query prints `- integration (shard 3/4) (id 129757664390): <link>`. Tests "fails on a red run with where its failures are, never its log" and "fails on a red check … never the log": `out contains run URL, failed id, annotations command; no --log-failed / gh run call`. This PR's own first red `ci` already printed the new repo-path output.
- **The annotations command shows the failing assertion with file and line, without `.github` noise**
  **Before:** did not exist.
  **After:** for check run 129757664390 it prints `packages/cli/test/integration/upgrade.test.ts:227 Expected: true / Received: false`, with no `.github` entries.
- **A green run still exits 0 with no output**
  **Before:** exits 0, silent.
  **After:** the green-path tests assert exit 0 (not empty output); by reading, `gh run watch … && exit 0` and `gh pr checks --watch … && exit 0` come before the changed lines and are untouched.

The shipped path has no live run yet: only the fake-gh test and the review's hand query cover it.

## Merge danger

**Door:** two-way: only workflow shell, one new script and its test change, so a revert restores the log tail.

**Blast radius:** rework agents: if the commands break, a red `ci` hands implement less to work with; green runs are unaffected.
