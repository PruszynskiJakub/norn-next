# gh-294 — handoff

## Goal

When a story's PR is seen merged into the base, the story is recorded done even if its round already reached `$done` and nobody holds the claim, so it leaves Needs you. Also: a cockpit item row says what its item asks for when its story has more than one row.

## Proof

- Merged PR with no claim held is taken back, then cleaned up: `packages/core/test/unit/decide.test.ts` › "a story whose round ran and whose PR merged is taken back for the merge cleanup though nobody holds its claim". This test failed first: decide gave `noop story.finished`. It pins four things:
  - claim `none` + PR merged + round `$done` + record `active` → `claim claim.reacquire.merged`, an acquire with `expected: null`;
  - the same case mid-round is taken back too;
  - once the claim is held → `cleanup_merged_story` with `story_status: done`;
  - no story worktree left (already cleaned up, the base still refusing the done record) → noop, no take-back loop; a record already `done` → noop.
- Rule coverage: a hand-built case in `packages/core/test/rule-cases.ts` covers the new rule `claim.reacquire.merged`.
- Cockpit rows: `packages/cli/test/unit/cockpit-tui.test.ts` › "a story with more than one item row: each row says what its item asks for". It failed first. A story with one item row still shows the story's title, as the existing Now-tab test pins.
- `bun run test` (1735 pass), `bun run typecheck` green. The golden corpus is unchanged.

## Easy to miss

- The R3.2 decide test still holds: a stale local intake (no run state, record `new`) of a merged story is never acquired, and neither is another heartbeat's expired claim.
- The take-back requires the story worktree to exist. After `cleanup_merged_story` the worktree is gone, and if the base refuses the done record, the story reads `active` from the base with claim `none` and PR merged (golden `audit-452b16e64efb.json`, the owed-records flow in `packages/cli/test/integration/audit.test.ts`). Without the worktree condition, decide would re-acquire and re-run the cleanup on every tick.

## Not proven yet

- No new integration test. The fix is proven at the decide seam over two ticks (acquire, then cleanup). The integration tier runs in CI. The CLI repro (`repro.test.ts` in the reproduce evidence) could be added to `packages/cli/test/integration/runtime.test.ts` if review wants it.
- Stories already closed with `norn story close` (worktree removed, record `active`, e.g. gh-222, gh-271, gh-292) are not taken back, because they have no worktree. A person lands `status: done` on the base for those by hand.
- Between syncs, the Check item "issue closed — the round stays finished" still reads `story.pr` only (`packages/core/src/inbox/items.ts` `finishedRoundRemoteItem`). It is left out on purpose: the next sync tick records the story done and the item goes away.

## Notes

- Decision: take back only on claim `none` + this checkout's run state + the story worktree present. Another heartbeat's expired claim stays a noop: its holder may still be acting on it, and the existing test pins that.
- Decision on cockpit rows: show the item's title only when the story has more than one item row. That is the issue's minimum, and it keeps the existing "item row says what the story is" behaviour for single rows.
- Friction (from reproduce): the `## Reproduce` comment was never posted, because norn's hook refuses `gh issue comment`. Its text is `reproduce-comment.md` in the reproduce evidence.

## Resume

Implement is done and committed. Next: the workflow's review/CI steps.
