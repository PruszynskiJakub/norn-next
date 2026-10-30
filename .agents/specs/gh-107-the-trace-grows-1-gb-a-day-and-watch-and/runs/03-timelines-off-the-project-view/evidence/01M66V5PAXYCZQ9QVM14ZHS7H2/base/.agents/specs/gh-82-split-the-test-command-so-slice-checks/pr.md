## Summary

A slice's `test` check now runs `test:fast` (everything but `packages/cli/test`, ~40 s) and the type check instead of the full ~6.5 min suite. The story-level checks (`story`, `quick`, `fix`) and CI still run the full suite.

```diff
 package.json scripts
   test       bun test                                          (unchanged)
+  test:fast  bun test --path-ignore-patterns='packages/cli/**'
+  test:cli   bun test ./packages/cli/test

 .agents/norn/workflows/{slice,bug}.yaml  test.run
-  bun install --frozen-lockfile && bun run test      && bun run typecheck
+  bun install --frozen-lockfile && bun run test:fast && bun run typecheck
 .agents/norn/workflows/{story,quick,fix}.yaml, ci.yml   (unchanged: full suite)
```

## Evidence

- **`test:fast` / `test:cli` / `test` scripts**
  **Before:** only `test`; the full suite took 386 s for 1209 tests across 80 files (check receipt `0004-check.json` on this branch, `duration_ms: 390468`).
  **After:** run here on this branch: `bun run test:fast` → `878 pass, 0 fail … across 51 files. [39.20s]`; `bun test ./packages/cli/test` → `331 tests across 29 files, 0 fail [383.22s]`. 878 + 331 = 1209 and 51 + 29 = 80, so the two halves together are exactly the full suite.
- **Slice checks run `test:fast` + typecheck; story-level and CI keep the full suite**
  **Before:** all five workflows ran `bun run test`.
  **After:** `slice.yaml` and `bug.yaml` (the two slice workflows) run `test:fast`; `story`, `quick`, `fix` and `ci.yml` are untouched. A new test in `test/repo.test.ts` asserts it: `test:fast` ignores `packages/cli`, `test:cli` runs `packages/cli/test`, slice/bug run `test:fast`, story/quick/fix run `test`. It passes now; it did not exist before.
- **Drop `bun install --frozen-lockfile` when not needed**
  **Kept**, on purpose: a fresh unit worktree has no `node_modules` (the tests fail to resolve `@norn/store` without it), and when nothing changed it takes ~0.15 s.
- **Why `base-sync` and `human` are slow, and making them cheaper**
  **Looked at, not made cheaper.** `human.test.ts` spawns git ~1,900 times (~18 per tick over ~106 ticks), and each `/usr/bin/git` call costs ~15 ms on macOS (xcrun shim + git), so the spawns account for nearly all the time. Cutting them means fewer git calls per tick in norn itself (e.g. repeated `rev-parse --verify`, `cat-file blob`, `rev-parse --git-path`). That is a production change that rewrites the effect transcripts, so it belongs in its own issue. Slice checks no longer run these files at all.
- **AGENTS.md Commands lists the new scripts**
  **After:** Commands lists `test:fast` and `test:cli`, and the "must pass" line now says which check runs what.

## Merge danger

**Door:** two-way: only scripts, workflow check commands, docs and one repo test change; a revert puts everything back.

**Blast radius:** slice checks: a slice's `test` check no longer runs the cli integration tests, so a slice that breaks them is caught later, at the story's `test` check or in CI, not at the slice. Units already mid-run keep the workflow snapshot they started with.
