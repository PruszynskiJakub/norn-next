## Summary

The `ci` check now asks whether the PR conflicts with its base before it waits for a CI run. A `CONFLICTING` PR sends the story to `update` (counted on `stale_loop`) at once, where it used to wait 5m for a run GitHub never starts and then go to `implement` on `ci_loop`. To make that possible, a check step may now declare extra outcomes by exit code.

```diff
 ci:
   type: check
   run: |
     sha=$(gh pr view …)
+    mergeable          # gh pr view --json mergeable; UNKNOWN asked again, up to 6 × 5s
+    CONFLICTING → exit 3
     wait up to 5m for the run
-    no run → "no ci.yml run for $sha after 5m"; exit 1
+    no run → ask mergeable again; CONFLICTING → exit 3
+             else "no ci.yml run for $sha after 5m (PR mergeable: $m)"; exit 1
     watch the run
+  exits: { 3: stale }
-  outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
+  outcomes: { pass: ready, fail: { to: implement, counter: ci_loop }, stale: { to: update, counter: stale_loop } }
```

How a check run gets its outcome (`checkOutcome` in `@norn/core`): exit 0 → `pass`; an exit code named in `exits` → that outcome; anything else, a timeout included → `fail`. A step that declares no `exits` behaves as before. The same script and `stale` route are in the repo's `story`, `quick` and `release` workflows, and the shipped `story` and `quick` workflows have their own version of it.

## Evidence

No QA ran. Every entry below is a test, run against a fake `gh` and `sleep`. `bun run test` passed (1755), `bun run typecheck` passed, and the two integration files passed (22).

- **A conflicting PR goes to `update` without waiting or spending `ci_loop`**
  **Before:** 5m with no run, then exit 1 → `implement` on `ci_loop` (gh-318's ci#4 spent 9m19s this way)
  **After:** `ci-check.test.ts` › "exits 3 (stale) at once on a PR that conflicts with its base…": `mergeable=CONFLICTING → exit 3, no "run …"/checks call, no sleep`, tested for both the repo and the shipped script. `apply.test.ts` › "check outcomes declared by exit code": `stale receipt → edge to update, stale_loop +1`. `repo.test.ts` asserts that quick, story and release route `stale → update`.
- **`UNKNOWN` mergeability is asked again and never counts as a conflict**
  **Before:** mergeability was never read
  **After:** "asks again while mergeability is UNKNOWN…": `UNKNOWN UNKNOWN MERGEABLE → sleeps [5,5], exit 0`. "goes on to wait when mergeability stays UNKNOWN": `UNKNOWN×6 → waits for the run and watches it`.
- **The 5m timeout message names the mergeable state**
  **Before:** `no ci.yml run for <sha> after 5m`
  **After:** the 5m timeout cases assert `… after 5m (PR mergeable: MERGEABLE)`. "exits 3 (stale) when the PR came to conflict while no run appeared": `MERGEABLE then CONFLICTING → 30 waits, exit 3`.
- **A check may declare outcomes by exit code; plain checks still pass on exit 0 and fail on anything else**
  **Before:** check outcomes were fixed to `pass` / `fail`
  **After:** `workflow.test.ts` (core) › "checkOutcome: …": `0 → pass, declared code → its outcome, other or timeout → fail`. Load-time validation refuses an undeclared check outcome, an exit naming an outcome with no route, and an exit naming pass, fail or exhausted (core and schema `workflow.test.ts`). `check-run.test.ts` › "records the outcome its exit code names, with the log; other exits stay fail".

Not shown: a live GitHub run of the new script. To check it, open a PR that conflicts with main and watch `ci` report `stale` within seconds.

## Merge danger

**Door:** one-way: once a check has recorded a `stale` receipt, reverting brings back the old receipt schema, which refuses it and marks the unit `corrupt`. A workflow that declares `exits` would also stop loading.

**Blast radius:** every story at `ci`: on a conflicting PR, `ci` now sends the story to `update` instead of `implement`. With the shipped `ci`, a conflicting PR in a repo that has no CI used to pass after 5m. It now exits 3 → `update`. A check receipt's `outcome` can now be any outcome name, so a reader that assumed only `pass` / `fail` could misread it. Note: seven harvested golden cases (`packages/core/test/golden/{human,merged-pr,pr-body,runtime}-*.json`) came along from the test step and are not part of this change. Drop them before merge unless you want them in the corpus.
