---
id: gh-93
slug: quick-and-story-check-fast-locally-then
provider: gh
number: 93
url: https://github.com/PruszynskiJakub/norn-next/issues/93
title: quick and story check fast locally, then wait for CI before ready
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-10-29T10:58:15.394Z
body_hash: 3b2b648ba6d218e67413afd609bb7b35593c8bf4dfd1741a1440800e8af10399
merge:
  pr: 102
  url: https://github.com/PruszynskiJakub/norn-next/pull/102
  head_sha: 2170845e9ee66fbfbb056928e08437dff4945988
  merge_commit_sha: 2bc6febd72bdf771dc1e07d38bbbb4d901f6484b
  merged_by: PruszynskiJakub
  merged_at: 2026-10-29T13:15:03.000Z
---

## Observed

The `test` check in `quick` and `story` runs the full suite: `bun install --frozen-lockfile && bun run test && bun run typecheck`, about 386 s per run. On 2026-10-28 eleven check runs took 349–509 s each, about 75 min in total, and CI then ran the same suite again on every PR. #86 moved only the slice workflows (`slice`, `bug`) to `test:fast`.

## Wanted

- `test.run` in `quick` and `story` becomes `bun install --frozen-lockfile && bun run test:fast && bun run typecheck` (~40 s).
- A `ci` check step after `open-pr` waits for the PR's CI and feeds a failure back to `implement`:

```yaml
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ci }
  ci:
    type: check
    run: |
      for i in $(seq 1 30); do gh pr checks >/dev/null 2>&1 && break; sleep 10; done
      gh pr checks --watch --fail-fast --interval 30 && exit 0
      run=$(gh run list --branch "$(git branch --show-current)" --limit 1 --json databaseId -q '.[0].databaseId')
      gh run view "$run" --log-failed | tail -300
      exit 1
    timeout: 30m
    outcomes: { pass: ready, fail: { to: implement, counter: ci_loop } }
counters:
  ci_loop: { max: 3 }
```

Since #87 a check runs as a detached `norn check-run`, so a long CI wait does not block the tick. The check inherits the process env, so `gh` is authenticated. The wait loop at the top covers the seconds after a push when `gh pr checks` still reports no checks. The failing log becomes `last_check` for `implement`. A rework pushes again through `open-pr`, so `ci` always checks the latest head.

- Update the workflow assertions in `test/repo.test.ts` (added in #86) and the "must pass" line in AGENTS.md.
- Leave `fix` as it is: it is removed by #94.

Trade-off: a red CI caused by a flaky run or a stuck runner also goes back to `implement`. `ci_loop` bounds it.

## Where

- `.agents/norn/workflows/quick.yaml:34` (`test`), `.agents/norn/workflows/story.yaml:64` (`test`)
- `test/repo.test.ts` (workflow check assertions from #86)
- `packages/cli/src/runtime/act/check.ts` (the detached check, #87)

## PRD

W1, W2 (check step), C5. No rule changes.
