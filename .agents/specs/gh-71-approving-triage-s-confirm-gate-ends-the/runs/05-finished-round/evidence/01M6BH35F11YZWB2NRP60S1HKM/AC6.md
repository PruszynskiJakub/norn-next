# AC6 — fail (Check item for an issue change on a finished round does not hold)
Throwaway repo $TMPDIR/qa71 (fake gh on PATH, HOME isolated), this branch's build (`bun packages/cli/src/main.ts`).
Story gh-12 finished its triage round (AC8.txt). Then the `norn` label was removed from issue #12 (AC6-edge.txt):
- `norn sync` → update_story_mirror (remote.mirror); not parked ✓
- `norn tick` → story.round_done; the round stays finished ✓
- `norn status` / `status --json` → `check: []`: no Check item ✗
- `norn status --history` (AC6-history.txt): the Check item "gh-12: remote: label 'norn' removed — the round stays finished" opened at the sync tick and was closed ("no longer pending") at the next plain tick, 13s later.
Cause (read, not fixed): finishedRoundRemoteItem (packages/core/src/inbox/items.ts:408) reads story.issue via issueProblem (policy.ts:53), which returns null when the issue is unobserved (undefined). Only a sync tick observes the issue; plain ticks and `norn status` (loadLocalFacts) do not, so the item exists only on sync ticks. Before this slice the GR7 park persisted in state.json, so the person saw it in Unblock.
