---
id: gh-294
slug: a-story-whose-pr-merged-after-its-round
provider: gh
number: 294
url: https://github.com/PruszynskiJakub/norn-next/issues/294
title: A story whose PR merged after its round finished is never recorded done, and stays in the cockpit's needs-you
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-10T09:46:52.315Z
body_hash: 172dd75d5060b62c16de68c37a855cbfd876a501ae427b509a46a491f460b9c5
merge:
  pr: 323
  url: https://github.com/PruszynskiJakub/norn-next/pull/323
  head_sha: faabcb776290f769932341eb84bbfd4f007c5680
  merge_commit_sha: 4395821f76ddbfb1aa511455ad5e247391558b37
  merged_by: PruszynskiJakub
  merged_at: 2026-11-10T10:42:32.000Z
---

## Observed

Seen with norn 0.28.0, the binary the ticks run.

gh-222, gh-271 and gh-292 are release stories. Each round reached `$done` at the `ready` approval, and its PR (#223, #272, #293) merged into `main` afterwards. Their issues are closed. All three are still listed in the cockpit's **Needs you** (Check) as `gh-N: remote: issue closed — the round stays finished`.

- `spec.md` on `origin/main` still says `status: active`. The PR merged the record as it stood before the merge.
- Every tick after the approval decides `story.finished` → noop: "finished (workflow done); nothing to take" between syncs, and "finished: PR merged; nothing to acquire" on a sync. The trace for gh-292 shows this for every tick after 07:42:58Z, with the PR merged at 07:45:09Z. `cleanup_merged_story` is never emitted, so nothing writes `status: done`.
- `norn story close gh-N --yes` doesn't help. It removes the worktree, branch, claim and slot, and leaves the record `active`, so the Check item stays.

Every release adds another such row.

The same cockpit also showed gh-274 three times under Needs you, each row with the story's title "Cap what the brief pastes…". The three items were different ("issue body changed since refine", "refine is ready (manual)", "skills differ from norn 0.27.1"), and only the preview told them apart.

## Wanted

- When a story's PR is seen merged into the base, the story is recorded done (spec `status: done`, mailbox and claim refs deleted, worktrees and branches removed). This also applies when its round has already reached `$done` and no heartbeat holds the claim. A merged PR is the story's last outcome: it needs nothing from the person, leaves Needs you and moves to the Done tab.
- Each item row in the cockpit says what the item asks for, at least when its story has more than one row (for example, the item title after the unit and step).

## Repro

In a throwaway repo under `$TMPDIR`, with `bun packages/cli/src/main.ts`, run a story through a workflow whose last step before `$done` is an approval gate ahead of the merge, as `release` does. Approve it, so the round reaches `$done` and the claim is no longer held. Merge the PR and close the issue, then let a sync tick run. The story keeps `status: active` and shows as a Check item, "issue closed — the round stays finished".

## Where

- `packages/core/src/decide/story.ts:74-85` `decideStory`: with the claim `none`, or `expired` and not ours, a merged PR or a finished round returns a `story.finished` noop before `storyLifecycle` runs. So `cleanup_merged_story` (`story.ts:266`) is reachable only by a heartbeat that holds the claim. The "ours" exception covers only this heartbeat's own expired claim.
- `packages/core/src/inbox/items.ts:508` `landed`: uses `mergedIntoBase`, which reads `story.pr` (never set between syncs), never `pr_seen`. Between syncs the finished-round Check item doesn't know the PR merged.
- `packages/cli/src/runtime/cockpit-tui.ts:501`: an item row prints `r.preview.report?.title ?? r.title`, the story's title.
- Related, closed: #88 (a merged story parked at a gate; its fix covered the claimed path), #147 (needs-you stories listed twice).
