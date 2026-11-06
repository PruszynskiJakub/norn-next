### Goal

A sync tick makes O(1) PR calls instead of one per story, and `mergedByAncestry` runs bounded, with Facts unchanged.

### Progress

- New `RemotePort.findPullRequests(branches)` (`packages/core/src/ports.ts`): `findPullRequest` for every branch in one round trip, any state, null when none. Not an "open PRs" list as the spec suggested: a list of open PRs alone cannot give a merged or closed PR, so Facts would change or each miss would cost a call again.
  - gh: one `gh api graphql` per 50 branches, one aliased `pullRequests(headRefName:, first: 1, CREATED_AT DESC)` each (checked live against this repo).
  - glab: `repo view` for the project path (skipped with `-R`), then one GraphQL `mergeRequests(sourceBranches:)`, latest iid per branch; when the answer has more than one page it falls back to one `findPullRequest` per branch. The GitLab GraphQL query was not run against a real GitLab, only against the scripted CLI.
- `syncRemote` (`packages/cli/src/runtime/observe/index.ts`): one `findPullRequests` for the active stories, one for the stories held elsewhere (their branches read through `mapBounded`). The timer counts `find_prs`, one per batch. getIssue and the CI reads behave as before; a failure still leaves remote facts unobserved.
- `mergedByAncestry` runs through `mapBounded(GIT_CONCURRENCY)`.
- New contract case "findPullRequests: every branch's PR as findPullRequest finds it…" passes for gh, glab (scripted CLIs) and FakeRemote. tick-timing integration asserts no `findPullRequest` in sync. Effect transcripts rewritten (`findPullRequest` → `findPullRequests`, base-sync and recovery). Observe snapshots and golden cases are unchanged.
- Not done (optional in the spec): reading a story's units in parallel, and one `ps` for every live pid.
- Not measured against #78's timings with a real remote.

### Resume

Review approved. Next: describe (PR body); measure a sync tick and a noop tick against #78's timings for the PR evidence.

## Progress

- implement#1 done: New RemotePort.findPullRequests(branches): one GraphQL round trip on gh and glab, same answer as findPullRequest for each branch. Sync makes one PR call for the active stories and one for the stories held elsewhere, not one per story. mergedByAncestry runs through mapBounded. New contract case passes for gh, glab and FakeRemote. Transcripts rewritten for the renamed call; observe snapshots and golden cases unchanged. The optional per-unit parallel reads and the single ps were not done.
- review#1: approve, 3 minor findings, none blocking. Unit tier and type check green on review. Traceability:

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 port method + gh/glab/FakeRemote + new contract case | test | `packages/adapters/test/contract/remote.ts` › "findPullRequests: every branch's PR as findPullRequest finds it, null without one (gh-186)" (run for gh, glab scripted CLIs and FakeRemote) |
| W1 sync makes O(1) PR calls (active + held elsewhere) | test | `packages/cli/test/integration/tick-timing.test.ts` › gh-78 timing test (`find_prs` = `prs?` calls, no `pr?`); e2e transcripts base-sync / recovery |
| W2 `mergedByAncestry` through `mapBounded` | test | behaviour unchanged: `packages/cli/test/integration/records.test.ts` › "P2 (F34): a PR left open whose head is on origin/main is merged by ancestry and cleaned up"; bounding read in code |
| W3 optional: per-unit parallel reads, one `ps` | n/a | not done (optional) |
| Noop ticks measurably under today's floor (vs #78) | person | QA (person): not measured; for the PR evidence |
| C1 golden cases and observe snapshots unchanged | test | `packages/core/test/unit/golden.test.ts`, `test/e2e/observe-snapshots.test.ts`; no file under either changed |
| C2 sync failure leaves remote unobserved, `.catch` fallbacks as before | test | existing sync tests; the throw still propagates out of `syncRemote`, CI `.catch` kept |
- review#1 approve: Approve: findPullRequests on gh/glab/FakeRemote with a contract case, sync makes one PR call per kind of story, mergedByAncestry bounded; golden and observe snapshots unchanged; unit tier and typecheck green. 3 minor findings: speed-up not measured vs #78, gh api graphql host on GHE unverified, GitLab GraphQL query only run against the scripted CLI.
