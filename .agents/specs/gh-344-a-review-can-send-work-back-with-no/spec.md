---
id: gh-344
slug: a-review-can-send-work-back-with-no
provider: gh
number: 344
url: https://github.com/PruszynskiJakub/norn-next/issues/344
title: A review can send work back with no findings, because only the criteria report is enforced
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-16T18:06:41.711Z
body_hash: 9761cb55d84063a8d9ccdac545b4e70eb9ade56c389dcf3474702357e138d492
---

## Observed

On `main` (`e419d33bd`), norn 0.33.0.

- `norn done` reads `--findings` only when the flag is given (`packages/cli/src/commands/done.ts:176-182`). Nothing requires it.
- The criteria report is enforced: `criteria: required` on the step makes `--criteria` mandatory (`done.ts:197`, `packages/schema/src/workflow.ts:90`).
- The brief only says findings are "needed when the outcome sends the work back" (`packages/core/src/brief.ts:1068`).
- So `review` can report `changes_requested` with no findings, and `implement` then starts with an empty Rework (`brief.ts:664` takes findings from the done receipt).
- Today the named skill (`norn-review`) is what makes the file appear. That blocks making skills optional.

## Wanted

For the agent that receives the rework, and for whoever lets an agent pick its own skill.

1. An agent step may declare `hand_back`, a map from an outcome to what must come with it: `findings` or `evidence`.

       hand_back:
         changes_requested: findings

2. `norn done <outcome>` without the required flag is refused with a `CliError`: code `hand_back_required`, `do_instead` naming the flag and the file format.
3. The brief's finish line for that outcome shows the flag in the command, as it already does for `--criteria` (`brief.ts:730-735`).
4. At load, `hand_back` naming an outcome the step does not declare, or an outcome that is an overridable route, is refused (`unknown_outcome`).
5. `criteria: required` stays as it is.
6. The shipped workflows declare it on `review.changes_requested`, `resolution-review.changes_requested` and `qa.fail`.

Works in today's format; it does not depend on any other issue from this session.

Design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19

## Repro

In a throwaway repo with a unit at `review`: `bun packages/cli/src/main.ts done changes_requested --handoff "x"` is accepted.

## Where

- `packages/cli/src/commands/done.ts:176-199`
- `packages/schema/src/workflow.ts:76-98`: `AgentStep`
- `packages/core/src/workflow.ts:226-235`: per-edge validation
- `packages/core/src/brief.ts:664,730-735,1068`
