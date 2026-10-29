## Summary

A release now needs one person decision instead of two and runs CI once instead of twice: the `confirm-version` gate and the local `test` check are gone, and the `release` workflow waits for the PR's CI (the `ci` check from #93) before `ready`, where the person judges the version and the changelog.

```diff
 release.yaml
   prepare  → done
-    confirm-version (gate)  approve → test, reject → prepare (version_loop)
-    test (check, 25m: suite, typecheck, build, smoke)  fail → $stuck
     open-pr
+    ci (check, 30m: gh pr checks --watch)  fail → $stuck
     ready (gate)  reject → prepare (ready_loop)
   base: { stale: behind }   # unchanged (BS7)
```

`.github/workflows/release.yml` is unchanged: after the merge it already tests, builds, smokes every binary on its own OS and only then pushes the tag in `publish`. The `release` and `release-start` skills, AGENTS.md ("To release" and the check paragraph) and CONTRIBUTING.md now describe the new flow.

## Evidence

- **Flow is `prepare → open-pr → ci → ready`**
  **Before:** `prepare → confirm-version → test → open-pr → ready`.
  **After:** new test in `test/repo.test.ts` parses `release.yaml` and asserts `prepare.done → open-pr`, `open-pr.done → ci`, steps are exactly `ci, open-pr, prepare, ready, resolve, update`. Written red first, passes now (`bun test test/repo.test.ts -t "release goes"`: 1 pass).
- **Drop `confirm-version`; reject at `ready` goes back to `prepare`**
  **Before:** gate with its own `version_loop` counter.
  **After:** same test asserts no `confirm-version` step, `version_loop` undefined, `ready.reject → { to: prepare, counter: ready_loop }`. The `ready` prompt now asks to judge the version, its reason and the changelog section.
- **Drop the local `test`; `ci` with `fail → $stuck`**
  **Before:** 25-minute local check repeating what CI and `release.yml` run.
  **After:** test asserts `ci` is a `check` running `gh pr checks --watch --fail-fast` with `{ pass: ready, fail: $stuck }`. The script is the same as `quick`/`story`'s `ci`.
- **Keep `base: { stale: behind }`**
  **After:** test asserts `base` equals `{ stale: behind }`.
- **Docs updated** (release skill, workflow header, AGENTS.md "To release")
  **After:** see the diff; not otherwise checked. Full suite and typecheck passed in the `test` step; review approved with one non-blocking nit (the `ci` script is duplicated across three workflows).
- **End to end:** not shown. No release has run through the new flow; the first `/release-start` after merge exercises it.

## Merge danger

**Door:** two-way: repo-local workflow and docs only; a revert restores the old steps.

**Blast radius:** next release: if the `ci` check misbehaves, that release story goes `$stuck` and a person unsticks it or switches its workflow. The tag is still only pushed after `release.yml` smokes every binary, so a bad release cannot be published by this change. A release story already in flight keeps the workflow copy it started with.
