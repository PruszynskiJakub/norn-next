---
id: gh-195
slug: keep-run-state-on-the-machine-that-runs
provider: gh
number: 195
url: https://github.com/PruszynskiJakub/norn-next/issues/195
title: Keep run state on the machine that runs it, and hand it over only when asked
assignee: PruszynskiJakub
labels:
  - norn
workflow: refinement
status: active
intake_at: 2026-11-04T08:34:16.652Z
body_hash: daab49a1f6e19f9adece43a08de2e7ee1559163b2e979cbaa5e838e337c7bb9f
---

## Observed

S8 commits `runs/<unit>/` (state, receipts, pinned workflow, check logs, QA evidence, handoff.md) to the story branch at every step boundary and pushes it; GR6 keeps it on the base branch as the record. On this repo's main that is 15 MB in 1,787 files (evidence 5.2 MB, logs 4.3 MB, receipts 5.0 MB) of a 30.5 MB pack. #117 measured the cost per PR (#106: 32.4k of 39.7k changed lines under runs/) and the bugs it causes: a rebase rewinds live state (#101, #97, #79), the boundary commit sweeps norn's files and other work together (#92), and local runs/ work missing from the remote needs its own Check item and `orphaned/` path in tidy (T7a, R2.3).

#117 proposes a `refs/norn/runs/<story>` ref pushed at every step boundary. That keeps the state off the branch, but norn still pushes it on every step, all so that a takeover can happen. Handing a story to another machine or another person is rare.

## Wanted

Run state lives only on the machine that runs the story, and leaves it only when someone asks:

- **Local only.** A unit's run state (state.json, receipts, pinned workflow, logs, evidence, handoff.md) lives in the checkout's machine dir, e.g. `~/.norn/repos/<id>/runs/<story>/<unit>/`, not in the worktree (a gitignored folder there dies with worktree removal or `git clean -fdx`, LY1). Story branches and PRs carry only the work. S1, S2, P6 and S5 hold as today.
- **Explicit handoff.** `norn story handoff <story>` packs the story's run state into a commit on `refs/norn/runs/<story>`, records the story head sha it matches, pushes it and releases the claim. `norn story checkout` fetches the ref, checks the sha against the branch, unpacks it into its own machine dir and continues.
- **Takeover without a handoff.** After the claim expires, with no handoff ref (holder dead or offline), `story checkout` restarts the current step from the branch's code with fresh counters, and the `take` receipt says the record was lost.
- **Archive at merge.** On GR6 the record is pushed once to `refs/norn/runs/<story>` and kept there, so `run list`, `run view` and `norn-retro` can still read a finished story without it ever touching main.
- **G3 reworded** to "continued … from git after a handoff".

Open questions:
1. Other machines' view of a story they don't hold: `story view`/`status` today read state.json from the remote branch (`packages/cli/src/runtime/human.ts:136`). Without it they see only claim, branch and PR. Enough?
2. Mailbox (T9): the sender loses its step/attempt check. The holder's tick still rejects a mismatched receipt; is that enough?
3. Migration: move open stories' runs/ into the machine dir with `norn upgrade`; leave runs/ already on main as history, or remove it in one commit?
4. Where the record lives for a story with no branch yet (#126 asks the same).

## Where

- `packages/adapters/src/git/index.ts:368`: boundary commit, `git add -A`
- `packages/store/src/receipts.ts`, `packages/store/src/unit.ts`, `packages/store/src/paths.ts`: runs/ writes and paths
- `packages/store/src/refs.ts`: claim and mailbox refs, the precedent for the handoff ref
- `packages/cli/src/runtime/human.ts:136`: reads remote state.json for a story not held here
- `packages/cli/src/runtime/observe/index.ts:333`: `unpushed_runs` (R2.3)
- `packages/cli/src/commands/tidy.ts:10`: `orphaned/`
- `.gitattributes`: `runs/**` linguist-generated (S10)

## Rules

G3, §7 layout and §7.1 state ownership, S3, S8, S9, S10, LY1, LY3, GR6, GR6b, RD6, RD7, T5, T7a, T9, R2.3, R10.1, C5.

Supersedes #117 (and its bypass #129). #117 folded in #92 and #101: moving runs/ off the branch fixes #101's class of bug. #92's session check (a second session joining a live run) still needs its own issue.
