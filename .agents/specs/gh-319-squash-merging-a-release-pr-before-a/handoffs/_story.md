## Goal

Fix #319: a story whose own PR merged on the remote (squash or merge commit) ends through the merge path, never `stale` → `update` → `open-pr` with a second PR, when the base was fetched between syncs.

## Proof

- Stale-routed gate holds between syncs: `test/e2e/merged-pr.test.ts` › "squash-merged and the base fetched between syncs: the stale gate waits for the sync, which ends the story; no second PR" (red before the fix: `gate.stale`, `git.update`, … as in the reproduce).
- `open-pr` refuses a merged PR: `test/e2e/merged-pr.test.ts` › "opens no second PR and fails the effect; the next sync ends the story" (red before the act guard: a second PR opened).
- Decide rule: `packages/core/test/unit/base-sync.test.ts` › "4a: a story PR not fetched this tick holds the stale gate until a sync shows whether the PR merged" (red first); rule case `gate.stale.awaits_sync` in `packages/core/test/rule-cases.ts`.
- `bun run test` (1734 pass) and `bun run typecheck` green; the e2e file passes locally (`bun run test:e2e test/e2e/merged-pr.test.ts`).

## Easy to miss

- The hold only applies when the story has a PR seen here (`pr_seen.pr`) and `story.pr` is unfetched this tick; a story with no PR, or a sync tick, classifies `stale` as before (host-less setups keep working).
- `open-pr` now looks the PR up before pushing; a merged PR makes the effect fail (retried each tick) until the sync's `remote.pr_merged` cleanup ends the story.

## Not proven yet

- `prsQuery` (`packages/adapters/src/gh/index.ts:102`, `first: 1` newest) still hides a merged PR once a newer PR exists for the branch; left alone, since the two guards stop a second PR from being opened.

## Notes

- Decision: decide waits for fresh PR facts (`gate.stale.awaits_sync` noop, `packages/core/src/decide/story.ts`) rather than computing squash evidence in observe: the PR's merged state is the authority, and a sync comes within `sync_interval`. It reads `pr_seen` only to wait, never to act.
- Act guard: `packages/cli/src/runtime/act/git-step.ts` open-pr throws when the branch's PR is merged.
- Docs: one paragraph in `docs/recipes.md` › "The base moved under a story".
- Friction: norn's mirror commit (32abeef55) committed half of this step's edits mid-step, which made a revert-to-HEAD red check silently keep the fix.

## Resume

Implement is done; the next step is review of this diff.
