## Goal

Reproduce #319: a story parked at a gate with a `stale` route goes `stale` → `update` → `open-pr` (a second PR) when its own PR merged on the remote, instead of ending through the merge path. Reproduce only, no fix.

## Proof

- Red loop: `bun test --config=<evidence>/bunfig.toml <evidence>/squash.test.ts`. The test and its bunfig are in this run's evidence (`squash.test.ts`, `bunfig.toml`, with absolute paths to the worktree it ran in; fix them up before rerunning). The output of every variant is in `loop-output.txt`. About 6 s, red 3/3.
- Posted as the `## Reproduce` comment on #319 (issuecomment-6764477701).

## Easy to miss

- It needs a **base fetch outside a sync** (another story's `update`, a merged record write at `runtime/record.ts:60`, a person's `git fetch`). With plain non-sync ticks nothing moves, because the base and the PRs are both fetched only on sync ticks. On a sync tick the cleanup wins (`remote.pr_merged`).
- It is **not squash-specific**: a `--no-ff` merge fails the same way between syncs, because `merged_by_ancestry` is only computed for stories whose PR was fetched this tick.
- Once a second PR exists, gh's `prsQuery` (`first: 1`, newest) hides the merged one forever, so no later sync ends the story.

## Not proven yet

- Which fix is right. Options: decide refuses `stale`/`update` without fresh PR facts, or uses `pr_seen` plus a sync before classifying; observe computes merge evidence from `pr_seen` and patch or tree equality for squashes; `open-pr` refuses when the branch's PR is merged; the adapter prefers a merged or open PR over the newest. That is for planning.

## Notes

Minimised repro (CLI harness, real git, fake gh, under $TMPDIR):
1. Workflow `update → open-pr → ready` (gate `stale: { to: update }`), `base: { stale: behind }`, as in `release.yaml`.
2. Tick until it parks at `ready` with draft PR #100.
3. Squash-merge the story branch into `main` on the remote and set the fake PR to `merged`.
4. `git fetch origin main` in the main checkout.
5. Run non-sync ticks. Output: `gate.stale`, `git.update`, `receipts.apply`, `git.open-pr`, `receipts.apply`, ending at `ready` parked, with PRs `#100 merged, #101 open`.

Confirmed cause:
1. Primary: between syncs `story.pr` is unobserved (`packages/cli/src/runtime/observe/index.ts:372`), and `merged_by_ancestry` is only set for stories whose PR was fetched this tick (`observe/index.ts:452-455`). So `mergedVia` (`packages/core/src/policy.ts:103`) is null, `storyLifecycle` skips the cleanup, and `gate.stale` (`packages/core/src/decide/story.ts:539`) classifies on the base alone. `pr_seen` is in the facts but unused there.
2. Contributing: `open-pr` act (`packages/cli/src/runtime/act/git-step.ts:128-135`) sees the PR `merged` and opens a new one.
3. Aftermath: `prsQuery` (`packages/adapters/src/gh/index.ts:102`) returns only the newest PR per branch.

Seam: the CLI runtime harness, the way `test/e2e/base-sync.test.ts` does it (fake gh `h.remote.prs`, a `land` clone merging into `main`). The minimised test is the regression case: assert no `gate.stale`, no second PR, and that the story ends via `remote.pr_merged`. A core decide case alone is too shallow, since decide needs merge evidence that observe must supply. Add an act guard on `open-pr` for a merged PR.

## Resume

Reproduce is done. The next step is the person's: plan or fix the story from this cause and seam.
