## Goal

An open story PR follows its issue's title, so a release PR opened as "Release" becomes "Release X.Y.Z" once `prepare` renames the issue, without a person renaming it by hand; the `ready` gate's title check goes.

## Proof

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted: PR title follows the issue | an open PR whose title differs from the issue's gets the issue's title (rule `remote.pr_title`) | test | `packages/core/test/unit/decide.test.ts` › "an open PR whose title is not the issue's is retitled to it, alongside the unit's own action"; `packages/core/test/rule-cases.ts` › "the issue renamed with its PR open: the PR takes the new title" |
| Wanted: end to end | the issue renamed after open-pr: the PR is retitled once at the next sync and not again | test | `packages/cli/test/integration/pr-body.test.ts` › "story PR title" › "the issue renamed after open-pr: …, once" |
| Port: editPullRequestTitle and PR title | gh, glab and FakeRemote rename a PR and report its title; a draft stays a draft | test | `packages/adapters/test/contract/remote.ts` › "editPullRequestTitle renames the PR, still a draft, which findPullRequest and findPullRequests then report" (the scripted glab keeps a draft in its title, as GitLab does); gh/glab unit tests › "editPullRequestTitle replaces the title"; `glab.test.ts` › "editPullRequestTitle keeps a draft MR's Draft: prefix, so the MR stays a draft" |
| Review F2: a failed retitle is no unit failure | it neither replaces the unit's act failure nor shows as an Unblock item; the next sync retries | test | `packages/cli/test/integration/pr-body.test.ts` › "a failed rename records no failure for the story unit; the next sync tries again" |
| Wanted: the gate's title check goes | the `ready` gate prompt no longer asks for a hand rename | agent | `.agents/workflows/release.yaml` ready prompt (read in review) |

## Easy to miss

- `story.pr` is set only on sync ticks (observe's `storyPrs`), and that same tick's mirror takes the unit's one action. So `retitle_pr` is a **side action** (a tail action, like `push_record`): it rides along with the mirror on the sync tick and compares against `story.issue.title`, not the mirrored `fm.title`. A plain unit action never fired; making it a non-tail side action routed it through act's claim-renew batch ("claim without blob").
- GitLab keeps a draft in the MR title (`Draft: …`). The glab adapter reports a draft MR's title without that prefix, and `editPullRequestTitle` reads the MR first and writes `Draft: <title>` for a draft, because a bare title would mark it ready.
- A PR with no `title` (from a `pr.json` an older norn wrote) is skipped until the next sync reports one.

## Not proven yet

- Not run against real gh/glab: `gh pr edit --title`, `glab mr update --title … --yes` (and that GitLab reads `Draft: ` in a title it is given), and the `title` field in `gh pr list/view --json`, the gh GraphQL node and the GitLab GraphQL node are the documented flags and fields, checked only against the scripted CLIs.
- e2e transcripts were not run locally (CI does); a retitle fires only when the PR and issue titles differ, which they don't in the existing flows.

## Notes

- Decision: the person's comment on the issue picked "an open PR takes the mirrored title, as it takes the body". No fresh issue fetch at `open-pr`. The `ready` gate comes after CI, minutes after the next sync, so the title is right by then.
- Behaviour to know: a PR renamed by hand to something other than the issue's title is renamed back at the next sync. The issue's title is the source.
- The gate prompt change takes effect for releases run by a norn that includes this fix. The release that ships this fix still runs the old binary, so its PR may need a hand rename once.
- Review F2 chose the reviewer's second option: act does not record `retitle_pr` failures at all (they stay in the trace), so no slot of their own was needed.
- No decide case was added for a draft prefix: the adapter now reports the bare title, so decide never sees the prefix.
- Release skill step 8 now says the open PR takes the title at the next remote sync.

## Resume

Review the rework of review #1 (F1 glab draft prefix, F2 retitle failure not recorded); nothing else is open.
