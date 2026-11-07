## Goal

An open story PR follows its issue's title, so a release PR opened as "Release" becomes "Release X.Y.Z" once `prepare` renames the issue, without a person renaming it by hand; the `ready` gate's title check goes.

## Done means

- decide emits `retitle_pr` (rule `remote.pr_title`) for an open PR whose title differs from the issue's: `packages/core/test/unit/decide.test.ts` ("an open PR whose title is not the issue's is retitled to it…"), plus a rule case in `packages/core/test/rule-cases.ts`.
- End to end over the harness: the issue renamed after open-pr → the PR is retitled at the next remote sync, exactly once, and not again at the sync after: `packages/cli/test/integration/pr-body.test.ts` ("story PR title"). Red with the decide rule disabled, green with it.
- RemotePort `editPullRequestTitle` and `RemotePullRequest.title` hold for gh, glab and FakeRemote: contract test "editPullRequestTitle renames the PR, which findPullRequest and findPullRequests then report" (`packages/adapters/test/contract/remote.ts`), and gh/glab unit tests over the fixtures.
- `bun run test` (1291 pass after merging main 7fd61b2) and `bun run typecheck` green.

## Easy to miss

- `story.pr` is set only on sync ticks (observe's `storyPrs`), and that same tick's mirror takes the unit's one action. So `retitle_pr` is a **side action** (a tail action, like `push_record`): it rides along with the mirror on the sync tick and compares against `story.issue.title`, not the mirrored `fm.title`. A plain unit action never fired; making it a non-tail side action routed it through act's claim-renew batch ("claim without blob").
- A PR with no `title` (from a `pr.json` an older norn wrote) is skipped until the next sync reports one.

## Not proven yet

- Not run against real gh/glab: `gh pr edit --title`, `glab mr update --title … --yes`, and the `title` field in `gh pr list/view --json`, the gh GraphQL node and the GitLab GraphQL node are the documented flags and fields, checked only against the scripted CLIs.
- e2e transcripts were not run locally (CI does); a retitle fires only when the PR and issue titles differ, which they don't in the existing flows.

## Notes

- Decision: the person's comment on the issue picked "an open PR takes the mirrored title, as it takes the body". No fresh issue fetch at `open-pr`. The `ready` gate comes after CI, minutes after the next sync, so the title is right by then.
- Behaviour to know: a PR renamed by hand to something other than the issue's title is renamed back at the next sync. The issue's title is the source.
- The gate prompt change takes effect for releases run by a norn that includes this fix. The release that ships this fix still runs the old binary, so its PR may need a hand rename once.
- Release skill step 8 now says the open PR takes the title at the next remote sync.

## Resume

Implementation done and committed; next is the workflow's next step (review / CI).
