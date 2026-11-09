| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted (1) | the PR title follows the issue's current title: an open PR gets the issue's title as it already gets the new body | test | `packages/core/test/unit/decide.test.ts` › "an open PR whose title is not the issue's is retitled to it, alongside the unit's own action"; `packages/core/test/rule-cases.ts` › "the issue renamed with its PR open: the PR takes the new title"; `packages/cli/test/integration/pr-body.test.ts` › "the issue renamed after open-pr: the open PR takes the new title after the next remote sync, once" |
| Wanted (1), remote side | gh and glab read a PR's title and can rename an open PR | test | `packages/adapters/test/contract/remote.ts` › "editPullRequestTitle renames the PR, which findPullRequest and findPullRequests then report"; `packages/adapters/test/unit/gh/gh.test.ts` › "editPullRequestTitle replaces the title"; `packages/adapters/test/unit/glab/glab.test.ts` › "editPullRequestTitle replaces the title" (scripted CLIs only, not real gh/glab) |
| Wanted (2) | the `ready` gate prompt's title check goes | test | UNTRACED |
| Repro | after `open-pr` and the issue rename, the PR title equals the issue title | test | `packages/cli/test/integration/pr-body.test.ts` › "the issue renamed after open-pr: the open PR takes the new title after the next remote sync, once" (FakeRemote) |

Not proven yet: Wanted (2), no test reads the `ready` gate prompt of `.agents/workflows/release.yaml`.
