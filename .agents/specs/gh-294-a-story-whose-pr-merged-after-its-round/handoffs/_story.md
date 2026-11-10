## Goal

A story whose PR is seen merged into the base is recorded done, even when its round has already reached `$done` and no heartbeat holds the claim. It then leaves Needs you. Also wanted: cockpit item rows say what each item asks for.

## Proof

- Reproduced through the real CLI path (integration harness, real git, fake gh): round `$done` → `watch --max-ticks 1` releases the claim → PR merged and issue closed → `norn sync` decides `noop story.finished`, the spec stays `status: active`, and `norn status` shows Check "gh-9: remote: issue closed — the round stays finished". Evidence: `cli-repro.out` and `repro.test.ts`.
- Minimised loop at the decide seam, red: `min.test.ts` / `min-repro.out` in evidence.

## Easy to miss

- The existing decide test "R3.2: the base record wins — no acquire for a story the base records as done or whose PR merged" pins `claim none + pr merged + spec status new → story.finished`, for a stale local intake. A fix must keep that case apart from a story whose record is `active` and whose round ran.
- A claim released by a clean `watch` exit is `none`, not `expired`. The restarted watch has the same heartbeat_id but is not counted as `ours`.

## Not proven yet

- The cockpit duplicate-row title (`packages/cli/src/runtime/cockpit-tui.ts:501`, `r.preview.report?.title ?? r.title`) was not looped. It is a separate, display-only change.

## Notes

**Loop.** Copy `min.test.ts` from evidence, swap `<worktree>/` for the worktree's absolute path, and run it outside the repo with `bun test --preload <worktree>/test/preload.ts min.test.ts` (~0.3 s). The test builds a story with round state `step: $done, status: done`, spec `status: active`, `pr.state: merged` and claim `none`, and asserts that decide emits `cleanup_merged_story`. It gets `noop story.finished "finished: PR merged; nothing to acquire"`. Probe across claim states: none → noop, expired-ours → `claim.reacquire` (which leads to cleanup), expired-theirs → noop.

**Confirmed cause.** `packages/core/src/decide/story.ts:84`, `if (baseDone || (storyMerged(phase) && !ours)) return ctx.noop(…"story.finished"…)`. It returns before `storyLifecycle`, the only place that emits `cleanup_merged_story`. `ours` (`story.ts:77`) is true only for this heartbeat's own expired claim. Ruled out: observe missing the merge (the noop's reason says PR merged) and the cleanup failing (it is never emitted).

**Contributing (Check item between syncs).** `finishedRoundRemoteItem` (`packages/core/src/inbox/items.ts:531-533`) takes the phase from `story.pr` only. `packages/view/src/load.ts:379` drops `pr_seen` and `issue_seen` when `finished`.

**Seam for a regression test.**
- decide unit: `packages/core/test/unit/decide.test.ts`, next to R3.2.
- integration: `packages/cli/test/integration/runtime.test.ts`, following the "PR merged →" flow plus a `watch --max-ticks 1` release before the merge (the full repro in `repro.test.ts`).

The `## Reproduce` comment with the same content is posted on the issue.

## Resume

Reproduce step done. The next round (a person starts it) fixes `decideStory` so that a merged PR on a story whose record is not done is cleaned up whatever the claim state, starting from the decide seam above.
