## Summary

An open story PR now follows its issue's title, as it already follows `pr.md` for its body. A release PR opened as "Release" becomes "Release X.Y.Z" at the next remote sync after `prepare` renames the issue, so nobody renames it by hand before the squash merge. The `ready` gate's title check is removed.

```diff
 decideStory(story)               # on a sync tick, story.pr and story.issue are both observed
+  if pr is open and pr.title is known and pr.title != issue.title
+    emit retitle_pr(pr, issue.title)   # rule remote.pr_title; a tail side action like push_record,
+                                       # so it rides along with the same tick's mirror
   storyLifecycle(...)            # mirror, step actions: unchanged
```

`retitle_pr` compares against the issue's title, not the mirrored `fm.title`, because the same tick may still be mirroring it. A failed retitle stays in the trace only: it is not recorded as the unit's failure, and the next sync tries again. On GitLab a draft MR keeps its draft in the title, so glab reports the title without `Draft: ` and writes `Draft: <title>` back when the MR is a draft.

## Evidence

No QA ran. Each entry below is a test, and the test check passed (test#2).

- **PR title follows the issue**
  **Before:** `open-pr` set the title once, from the mirrored title, and never changed it again.
  **After:** `decide.test.ts` › "an open PR whose title is not the issue's is retitled to it, alongside the unit's own action": `issue "Release 0.22.0", pr "Release" → [retitle_pr 7 "Release 0.22.0", update_story_mirror]`. There is no retitle when the titles already match, the PR is not open, the cached PR has no title, or the issue is not observed. Rule case "the issue renamed with its PR open: the PR takes the new title".
- **End to end, once**
  **Before:** did not exist.
  **After:** `pr-body.test.ts` › "story PR title" › "the issue renamed after open-pr: … once": `rename issue; sync → pr.title == issue.title; another sync → still 1 "pr title" call`.
- **Remote ports rename a PR, and a draft stays a draft**
  **Before:** the port had no `editPullRequestTitle`, and PRs did not report a title.
  **After:** contract › "editPullRequestTitle renames the PR, still a draft, which findPullRequest and findPullRequests then report", run for gh, glab and FakeRemote. `glab.test.ts` › "editPullRequestTitle keeps a draft MR's Draft: prefix, so the MR stays a draft".
- **A failed retitle is no unit failure**
  **Before:** did not exist (review #1 caught that the first version replaced the unit's act failure).
  **After:** `pr-body.test.ts` › "a failed rename records no failure for the story unit; the next sync tries again": `titleError → readActFailures == {}; clear error; next sync → titled`.
- **The gate's title check goes**
  **Before:** the `ready` prompt asked the person to check and edit the PR title.
  **After:** `.agents/workflows/release.yaml` drops that sentence, and release skill step 8 says the open PR takes the title at the next sync. Checked by reading, in review #2.

Not shown: nothing has run against real `gh`/`glab`. `gh pr edit --title`, `glab mr update --title … --yes`, GitLab reading `Draft: ` from a title, and the `title` field in `gh pr list/view --json` and in both GraphQL nodes were checked only against the scripted CLIs. The integration tests run in CI only. To check by hand, rename a story's issue while its PR is open and watch the PR after the next sync.

## Merge danger

**Door:** two-way. Reverting removes the action. The optional `title` in a cached `pr.json` is ignored by older readers, and an entry without a title is skipped.

**Blast radius:** story PRs. A PR someone renamed by hand to anything other than the issue's title is renamed back at the next sync, because the issue's title now wins. On GitLab, an issue titled `Draft: …` would turn a ready MR into a draft. The release that ships this fix still runs the old binary and the old gate prompt, so its PR may need one last hand rename.
