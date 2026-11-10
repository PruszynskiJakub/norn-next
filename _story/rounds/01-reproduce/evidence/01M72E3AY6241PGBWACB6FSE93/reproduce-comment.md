## Reproduce

**Reproduced** on `main` at e5ac969 (code under change, `packages/cli/src/main.ts` run in-process by the integration harness: real git and a bare `origin` under `$TMPDIR`, with a fake remote for gh).

### As a user (real CLI path)
Workflow `solo` (`implement → $done`), mode auto, issue #9:
1. tick ×3: intake, claim, `implement` starts; the agent reports `done` and the round reaches `$done`.
2. `norn watch --max-ticks 1` exits cleanly → `released: [{story: gh-9, ok: true}]`, and `refs/norn/claims/gh-9` is gone. This is the claim release you get when watch restarts on an upgrade.
3. The PR merges into `main` and the issue closes. Then `norn sync`:
```
sync decisions gh-9: [{"unit":"gh-9","rule":"story.finished","kind":"noop","ok":true}]
worktree spec status: status: active
next tick gh-9: ["noop story.finished"]
status:
Check (2) · changed outside norn, worth a look
  gh-9       round 1 · solo · $done: gh-9: remote: issue closed — the round stays finished · 2m
```
No `cleanup_merged_story`: the spec stays `active`, the worktree stays and the Check item stays. These are the symptoms in the report.

### Loop (minimised, decide seam, ~0.3 s)
`bun test --preload test/preload.ts min.test.ts`. The test builds a story with round state `step: $done, status: done`, spec `status: active`, `pr: {state: merged}` and `claim: {state: none}`, then asserts that `decide` emits `cleanup_merged_story`. It goes red:
```
none            ["noop story.finished finished: PR merged; nothing to acquire"]
expired-ours    ["claim claim.reacquire "]
expired-theirs  ["noop story.finished finished: PR merged; nothing to acquire"]
error: expect(received).toContain("cleanup_merged_story") — Received: [ "noop" ]
```
Every part of this is needed: a merged PR plus a claim that is not this heartbeat's expired claim. The round being `$done` is incidental, because the merged check comes before the finished check.

### Confirmed cause
`packages/core/src/decide/story.ts:84`, `if (baseDone || (storyMerged(phase) && !ours)) return ctx.noop(…"story.finished"…)`. This runs before `storyLifecycle`, and `storyLifecycle` is the only place that emits `cleanup_merged_story`. `ours` (`story.ts:77`) is true only for this heartbeat's own **expired** claim. A claim released by a clean watch exit is `none`, so no heartbeat ever reaches the merge cleanup. The probe above separates the cases: expired-ours re-acquires and then cleans up, while none and expired-theirs noop.

Hypotheses ruled out:
- observe misses the merge: the noop's reason is "PR merged", so the PR fact was there.
- `cleanup_merged_story` runs and fails: it is never emitted.

Contributing (Check item between syncs): `finishedRoundRemoteItem` (`packages/core/src/inbox/items.ts:531-533`) takes the phase from `story.pr` alone, and `packages/view/src/load.ts:379` drops `pr_seen` (and `issue_seen`) once `finished`. Between syncs the item therefore never knows the PR merged. The duplicate cockpit rows, all showing the story title, are separate: `packages/cli/src/runtime/cockpit-tui.ts:501` (`r.preview.report?.title ?? r.title`). Not looped here.

### Seam for a regression test
- **decide** (`packages/core/test/unit/decide.test.ts`, next to "R3.2: the base record wins…"): a story with a merged PR, a spec not yet `done`, and claim `none` or another heartbeat's expired claim should emit `cleanup_merged_story` (or an acquire that leads to it). Watch out: R3.2 currently pins `claim none + pr merged + status new → story.finished` for a stale local intake, and the fix has to keep that case apart from a story whose record is `active`.
- **integration** (`packages/cli/test/integration/runtime.test.ts`, the "PR merged →" test's flow): round `$done` → `watch --max-ticks 1` releases the claim → PR merged → `norn sync` emits `cleanup_merged_story`, the worktree is gone and the record says `done`. This is the full repro above.
