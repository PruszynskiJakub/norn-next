## Goal

This repo's `quick`, `story` and `release` take their common steps from `.agents/workflows/shared/`, so this repo's CI wait (and sync, base update, ready/merge) lives in one file, and each loads to exactly the workflow it was before.

## Proof

- AC1 (quick/story/release equal the `workflowHash` recorded by slice 01): `test/repo/process.test.ts` › "repo workflows" › "%s keeps its pinned meaning" (quick `aff5dfec…`, story `df2f31a1…`, release `36ef2961…`, all unchanged after the rewrite; `PINNED_HASHES` untouched).
- AC2 (`gh run watch` in exactly one file of the set, a shared file; every other workflow still loads): `test/repo/process.test.ts` › "the CI wait is written once, in a shared file, and every workflow in the folder still loads" — went red first (no `shared/`), green after; plus the existing "load without errors" and "%s is valid for claude with the linked skills".
- `bun run test` (1953 tests, 0 fail; the 6 skips are quick's human-qa cases in light-route, as before) and `bun run typecheck` green.

## Easy to miss

- A use step may not share a name with any included step, so the use steps are named `catch-up` (sync), `base-update`, `ship` (ci), `land`; routes and `base.step`/`verify`/`reset_on` name the included steps (`update`, `test`, `sync.done`, …) directly.
- Exits carry no `means` unless the original route had one (the means comes from the shared side and would change the hash); `test-merge`/`test-resolution` are `like: test` in `shared/base-update.yaml`, replacing the `&test-run` anchor.
- `release` uses only `shared/ci.yaml` (open-pr + ci, `failed: $stuck`); its update/resolve/ready differ and stay inline (Plan D10).

## Not proven yet

- `packages/cli/test/integration/ci-check.test.ts` was changed to load the repo workflows through the store's loader (its `ciStep`/`ciScript` read raw YAML); integration tier not run here per the brief — CI runs it.

## Notes

- Shared files: `sync.yaml` (sync, sync-resolve; exit `synced`), `base-update.yaml` (update, resolve, test, test-merge, test-resolution, resolution-review; exits `tested`, `failed`, `merged`, `redescribe`), `ci.yaml` (open-pr, ci; exits `passed`, `failed`, `stale`), `land.yaml` (ready, merge; exits `rejected`, `stale`).
- Tests that parsed `.agents/workflows/*.yaml` by hand now load through the store's loader: `test/repo/repo.test.ts` (`repoWorkflow`), `packages/cli/test/unit/assets.test.ts` (`repoWorkflow`), `packages/cli/test/unit/light-route.test.ts` (both copies loaded from a temp copy of their folder; "the test command is written once" now counts the command across the workflow and its folder's shared files, so it holds for the shipped anchors and the repo's `like:`). Slice 05 touches the shipped side of these same tests; expect a small merge there.
- `docs/development.md` (Only `release` is repo-local) gained one sentence naming `.agents/workflows/shared/`.

## Resume

Implement done; next is the slice's review.
