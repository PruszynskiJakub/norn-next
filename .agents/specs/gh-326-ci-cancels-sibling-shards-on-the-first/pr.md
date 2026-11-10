## Summary

A red CI run now lets every integration and e2e shard run to the end, and the ci check's rework brief lists cancelled and skipped jobs as unknown instead of leaving them out, so a rework never takes a cancelled shard for a pass.

```diff
 ci.yml  integration (4 shards), e2e (3 shards)
-  fail-fast: true     # first red shard cancels the others
+  fail-fast: false    # every shard reports

 ci-failures.sh  jobs listed in the rework brief
-  conclusion == failure                 → "- job 7: integration (shard 1/4)"
+  conclusion == failure                 → "- job 7: integration (shard 1/4)"
+  conclusion == cancelled or skipped    → "- job 8: integration (shard 2/4) (cancelled: unknown, not run to the end)"
```

## Evidence

No QA ran; the entries are tests (the unit-tier test check passed).

- **One CI run reports every failing shard**
  **Before:** both matrices set `fail-fast: true`; a red shard cancelled its siblings.
  **After:** `test/repo/repo.test.ts` › "AC5 (B11, B12): … none with fail-fast …" asserts `strategy.fail-fast == false` on integration and e2e; it went red before the ci.yml change and passes now.
- **ci-failures.sh lists cancelled or skipped jobs as "unknown, not run to the end"**
  **Before:** only `conclusion == "failure"` jobs were listed; cancelled shards vanished from the brief.
  **After:** `packages/cli/test/integration/ci-check.test.ts` › "fails on a red run with where its failures are, never its log" runs the script's own `-q` filter through `jq` on jobs {success, failure, cancelled, success, skipped} and asserts exactly the failure, cancelled and skipped `- job` lines.

The integration test runs only in CI (integration tier); locally the filter was checked by running `jq` with it on the same fixture. Review accepted that other non-success conclusions (`timed_out`, `startup_failure`) are still left out: the issue names only cancelled and skipped.

## Merge danger

**Door:** two-way: config and a shell filter; a revert restores both.

**Blast radius:** CI: a red run now takes as long as its slowest shard (about 1 to 2 minutes) instead of stopping at the first failure, and more runner minutes are spent on red runs. The fake gh in the integration test needs `jq` on PATH (present on ubuntu-latest).
