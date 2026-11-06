## Summary

A sync tick now asks for every story's PR in one batched call, `findPullRequests(branches)` on `RemotePort`, instead of one `findPullRequest` per story. `mergedByAncestry` now runs `GIT_CONCURRENCY` at a time instead of one story after another. Facts stay the same.

```diff
 syncRemote
   listAssignedIssues                          (1 call)
   active stories, REMOTE_CONCURRENCY at a time
     getIssue when not listed
-    findPullRequest(branch)                   (1 call per story)
+  findPullRequests(active branches)           (1 call; gh: 1 GraphQL query per 50 branches)
   stories held elsewhere
-    findPullRequest(branch)                   (1 call per story)
+  findPullRequests(elsewhere branches)        (1 call)
     pullRequestCi(pr)                         (unchanged, per PR)
 observe
-  for each story: await mergedByAncestry(…)
+  mapBounded(stories, GIT_CONCURRENCY, mergedByAncestry)
```

How each adapter does it: **gh** sends one `gh api graphql` with one aliased `pullRequests(headRefName:, first: 1, CREATED_AT DESC)` per branch. **glab** runs `repo view` for the project path, then one `mergeRequests(sourceBranches:)` GraphQL query and keeps the highest iid per branch. When that answer has more than one page, glab goes back to one `findPullRequest` per branch.

This is not the "list open PRs once" call the spec suggested. A list of open PRs cannot return a story's merged or closed PR, so either the Facts would change or every miss would cost an extra call. The batched lookup returns the same answer `findPullRequest` gives for each branch.

## Evidence

- **W1: a port method replaces one `findPullRequest` per story, with a new contract case**
  **Before:** did not exist.
  **After:** the new `remoteContract` case "findPullRequests: every branch's PR as findPullRequest finds it, null without one (gh-186)" passes for gh and glab over scripted CLIs and for `FakeRemote`. It asserts: for `[two PRs on one branch, one PR, no PR]`, `findPullRequests(bs).get(b) == findPullRequest(b)` for every `b`, the branch without a PR maps to `null`, and `[]` gives an empty map.
- **W1: a sync tick makes O(1) PR calls**
  **Before:** one `find_pr` per active story and one per story held elsewhere.
  **After:** the gh-78 test in `tick-timing.test.ts` now asserts `calls.find_prs == FakeRemote "prs?" calls` and `FakeRemote "pr?" calls == 0` during sync. The base-sync and recovery effect transcripts were rewritten on purpose, and the only change is `findPullRequest <branch>` → `findPullRequests <branch>`.
- **W2: `mergedByAncestry` runs through `mapBounded`**
  **Before:** stories were checked one after another.
  **After:** they run `GIT_CONCURRENCY` at a time. The behaviour test, `records.test.ts` › "P2 (F34): a PR left open whose head is on origin/main is merged by ancestry and cleaned up", still passes.
- **W3 (optional): read a story's units in parallel, one `ps` for every live pid**
  Not done.
- **Noop ticks measurably under today's floor (vs #78's timings)**
  **Not shown:** not measured against a real remote. To check it, compare the tick traces' `timing` (TickTiming) for a sync tick and a noop tick on this repo before and after merging: look at `observe["sync.stories"]`, `observe["sync.elsewhere_prs"]` and `calls.find_prs`.
- **C1: golden cases and observe snapshots unchanged**
  **After:** no file under `packages/core/test/golden/` or `test/e2e/observe-snapshots/` changed, and `golden.test.ts` and `observe-snapshots.test.ts` pass.
- **C2: a sync failure still leaves remote facts unobserved, and the `.catch` fallbacks behave as today**
  **After:** a throw from `findPullRequests` propagates out of `syncRemote` just as a throw from `findPullRequest` did, and the per-PR `pullRequestCi(…).catch` is kept. The existing sync tests pass.

## Merge danger

**Door:** two-way: a revert restores the per-story calls. Nothing persisted changes except a new `find_prs` key in `TickTiming.calls`, which is an open record.

**Blast radius:** every sync. If the GraphQL query is wrong for a provider, every sync on that provider fails and remote facts go unobserved; before, only one story's PR lookup would fail. Three things were not verified:
- The GitLab query (`mrsQuery`: field names, `state` and `iid` types) has only run against the scripted CLI, never a real GitLab.
- On GitHub Enterprise, `gh api graphql` with `{owner}/{repo}` and no `--hostname` may query the default host. It was only run live on github.com.
- `findPullRequests` is a new required method on `RemotePort`, so a third-party remote adapter (X2) has to add it.
