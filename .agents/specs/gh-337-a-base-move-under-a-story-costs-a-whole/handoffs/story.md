# gh-337 — handoff

## Goal

Make a base move under a story cheap, automatic and reviewable, and make each rework loop cost one CI run: all nine changes from the issue, in this one story.

## Proof

- spec.md: Problem Statement, Solution, 76 user stories, Out of Scope, Further Notes, Open questions: none (refine).
- spec.md `## Plan` (plan step, agreed with the person point by point): seams S1 core decide, S2 core brief, S3 cli harness, S4 GitPort contract, S5 e2e base-sync transcript; a coverage row for every user story; two prefactors; decisions D1–D14; testing decisions; risks.

## Easy to miss

- Heads ref `refs/norn/heads/<story>` is pushed at every boundary under both record policies; while the PR is open it replaces the branch push, including at claim release (handoff, watch exit). Only open-pr pushes the branch then; `story close` pushes the branch first. User stories 7, 8, 12 were amended to say this.
- Open-pr guard (D4): a non-spec-folder change after open-pr must go back through open-pr before a gate/merge step (static validation + runtime move).
- Merge step takes `stale` only after `gate.stale.awaits_sync`, so a squash-merged PR is never read as a base move.
- `clean` for a regenerated merge needs the `Norn-Regenerated` trailer AND a remerge-diff touching only mapped paths.
- Light-path anchor = head at the latest `approve` outcome in the round, any step; agent done receipts gain `head_sha`.
- Verify red reuses the `stale` edge and `stale_loop`; no new outcome. The cache is the check receipt's `verify: {head, base}`.
- Regenerate runs inside act's update, default timeout 2m per entry, configurable; docs say commands must be fast and deterministic.
- The shipped test command is written once with a YAML anchor (`&test-run` / `*test-run`); pin with a `parseWorkflowText` test.

## Not proven yet

- Nothing built. Slicing next.

## Notes

- The person wants both prefactors (one push path for claim release via `pushBranch`; update outcome choice as a pure core function) landed first, as their own slice. Slice order otherwise as the spec's Further Notes say.
- release.yaml gets the merge step (decided).
- S3 must also prove the PR head at merge is the commit `ci` watched (no branch push after ci.pass / ready.approve); S5 stays as the pinned push list.
- Shipped workflows change in both copies; norn-merge in its bundled copy; `docs/limitations.md` note per amended user story 12.

## Resume

Slice the Plan in spec.md (norn-slice).
