## Summary

In the repo-local `quick` and `story` workflows, the local `test` check now runs `test:fast` (about 40 s) in place of the full suite (about 7 min). A new `ci` check after `open-pr` waits for the PR's CI, which still runs the full suite, and sends a red run back to `implement`.

```diff
   test:   check   bun install && bun run test && typecheck
+  test:   check   bun install && bun run test:fast && typecheck
   …
-  open-pr ──done──▶ ready
+  open-pr ──done──▶ ci
+  ci:     check   wait for `gh pr checks`, then `gh pr checks --watch --fail-fast`
+                  pass ──▶ ready
+                  fail ──▶ implement   (ci_loop max 3; last_check = tail of `gh run view --log-failed`)
```

`fix` keeps the full suite, since #94 removes it. The shipped template `packages/cli/assets/workflows/story.yaml` does not change.

## Evidence

- **`test` check runs `test:fast` in `quick` and `story`**
  **Before:** this story's own `test` check (still on the old workflow) ran `bun run test`: 1236 pass in 422 s, 427 s for the whole check (receipt `0004-check`).
  **After:** `bun run test:fast` on this branch: 896 pass in 40.5 s, then typecheck green. `test/repo.test.ts` now asserts that `slice`, `bug`, `story` and `quick` run `test:fast` and `fix` runs `test`.
- **`ci` check after `open-pr`, fail → `implement` via `ci_loop` (max 3)**
  **Before:** did not exist (`open-pr` went straight to `ready`).
  **After:** a new test in `test/repo.test.ts` parses both workflows and checks: `open-pr.outcomes == {done: ci}`, `ci.type == check`, `ci.run` contains `gh pr checks --watch --fail-fast`, `ci.outcomes == {pass: ready, fail: {to: implement, counter: ci_loop}}`, `counters.ci_loop == {max: 3}`. It failed before the YAML change and passes now. Both workflows load and validate with store `loadWorkflow`.
  **Not shown:** nobody has run the `ci` step against a live PR yet. This PR is the first one it will run on, after merge. To check it, look at the next `quick` or `story` PR: the unit should sit at `ci` until CI finishes, then go to `ready`, or to `implement` with the failed log as `last_check`.
- **AGENTS.md "must pass" line**: now says a workflow's `test` check runs `test:fast` (`fix` still runs the full suite), and that `quick` and `story` wait for CI in a `ci` check.

## Merge danger

**Door:** two-way. It changes only workflow YAML, one test and one doc line; a revert restores them.

**Blast radius:** this repo's `quick`/`story` stories. A regression that only `packages/cli/test` catches now shows up only in CI, at the `ci` step, not at the local `test` check. A flaky CI run or a stuck runner also sends the work back to `implement`; `ci_loop` caps that at 3. Known gap (review note): to fetch the failed log, the step takes the branch's newest run of any workflow (`gh run list --limit 1`), which may not be the run that failed. When that happens, `implement` gets an empty or unrelated `last_check`.
