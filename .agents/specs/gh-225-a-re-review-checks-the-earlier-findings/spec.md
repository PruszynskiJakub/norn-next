---
id: gh-225
slug: a-re-review-checks-the-earlier-findings
provider: gh
number: 225
url: https://github.com/PruszynskiJakub/norn-next/issues/225
title: A re-review checks the earlier findings first, and minor findings don't cause rework
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-07T22:33:43.386Z
body_hash: 69246fc543a768abe751f319bf1c24b6a288b9081dfcc59e3159b84a2f0c7ef6
merge:
  pr: 287
  url: https://github.com/PruszynskiJakub/norn-next/pull/287
  head_sha: e2e7b29e4cc3515d889175652bc9619e054c5583
  merge_commit_sha: e5d19841642f181ab39cbb03f2bed090399c7d01
  merged_by: PruszynskiJakub
  merged_at: 2026-11-08T06:47:50.000Z
---

## Observed

- A review step never sees its earlier findings: the quick and slice review steps declare `inputs: [spec, diff]` / `[slice, spec, diff]`, with no `last_findings`. `norn-review`'s verify pass checks only the current round's own candidates.
- `implement` gets every finding with "minor and nit ones are for you to weigh" (`packages/core/src/brief.ts`). Agents fix them anyway, which costs a commit and another review round.

## Wanted

- Review steps in `quick` and `slice` (and `story`'s, #227) declare `last_findings`. `norn-review` first checks each earlier finding: fixed or not.
- Rework is blocking and major findings only. The brief says so plainly, and minor and nit findings are left as notes (NT1), not fixed in another round.
- Both workflow copies, the brief text, the `norn-review` skill source.

## Out of scope

New `Finding` fields (`class`, `origin: introduced | pre_existing` judged with `git blame`): a one-way change to a persisted receipt format. Also out: a second diff range from round 2, and the classes in the exhausted-`review_loop` stuck reason. Revisit only if the two changes above don't cut the review rounds.

## Rules

B6, NT1, W4.
