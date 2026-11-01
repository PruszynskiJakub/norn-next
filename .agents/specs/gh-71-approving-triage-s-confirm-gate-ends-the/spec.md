---
id: gh-71
slug: approving-triage-s-confirm-gate-ends-the
provider: gh
number: 71
url: https://github.com/PruszynskiJakub/norn-next/issues/71
title: Approving triage's confirm gate ends the story, so the recommended workflow can't be switched to
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:story
workflow: story
status: new
intake_at: 2026-11-01T08:42:30.030Z
body_hash: 6d64972f8ea9f4a62211dd96a477faf5b35ad809bad3e399a3710a7620086173
---

## Observed

Triage on gh-61 recommended `spec`. At the `confirm` gate I ran `norn approve gh-61`, then
`norn workflow gh-61 spec --to refine`, which was refused:

    {"error":"gh-61 is done","do_instead":"norn status gh-61","code":"unit_done"}

`approve` on `confirm` goes straight to `$done` (`.agents/norn/workflows/triage.yaml`). Triage
opens no PR, so the story now sits in "Recently done — waiting for the PR merge (GR6)" and will
wait forever. Issue #61 is still open and its findings are on the issue comment, but the only
way forward is `norn drop gh-61` and filing the work again as a new issue.

`approve` serves two purposes at this gate: it is the close path, and it is also the obvious
key to press after reading a recommendation. The gate prompt does tell you to switch
*before* approving, but nothing stops you from approving first, and one mistaken approve is
enough to lose the story.

## Wanted

An issue goes through a **sequence of runs**: one workflow after another on the same story,
with acting on triage's recommendation as the first case. Decided in an interview (2026-10-27):

**Model**
- `gh-N` stays the story. Each workflow applied to it is a new numbered **run** with its own
  pinned workflow, cursor, counters and receipts.
- One issue, one branch, one PR. Runs share the story branch and worktree; a later run builds on
  what earlier runs left. A later run's `open-pr` updates the open PR's body (GR9 already does).
- `$done` ends a **run**, not the story. Only a person merging the PR ends the story (GR5, GR6
  unchanged).

**Starting runs**
- `norn workflow gh-N <name>` on a story whose last run is `$done` starts a new run at that
  workflow's `start` step.
- norn moves the issue's `norn:wf:<name>` label to the current run's workflow, for visibility
  only. A label change never triggers anything.
- While a run is unfinished (running, parked, `$stuck`), `norn workflow gh-N <name>` refuses with
  `run_active`; `--to <step>` (S7) and `norn unstick` stay the ways out. Open: whether to add an
  explicit way to end a stuck run (e.g. `norn unstick gh-N --end`).

**Ending without a PR**
- Issue closed, story has no PR and no active run → norn finishes the story itself (GR6-style
  cleanup: worktree, local branch, claim and mailbox refs), instead of parking it (GR7).

**Triage**
- `triage` becomes `explore → $done`: no `confirm` gate, no `triage_loop` counter.
- explore's outcome (`fix|quick|story|spec|close`) is the run's recorded recommendation; the inbox
  shows the finished run with the matching command (`norn workflow gh-N spec`) or "close the issue".
- Triage again = start another triage run: `norn workflow gh-N triage`.

**Out of scope**
- Triage writing only an issue comment (#69, its own `quick` story).
- A workflow that merges its own PR (`git: merge`): parked as its own issue; GR5 stays.
- Left to the spec and plan: the run layout under `runs/`, slices across runs, how trace and status
  show run boundaries.

gh-61 (where this was found) needs no rescue: under this model it is a story whose triage run
finished, and `norn workflow gh-61 spec` works once this ships.

## Repro

1. A story in the `triage` workflow reaches `confirm` with a recommendation (e.g. `spec`).
2. `norn approve gh-N`
3. `norn workflow gh-N spec --to refine` → refused with `unit_done`; the story waits for a PR that never comes.

## Where

- `packages/cli/src/commands/workflow.ts:68` — refuses any done unit
- `.agents/norn/workflows/triage.yaml` — `confirm.outcomes.approve: $done`

## PRD

S7 (switching a started unit; new: starting a new run), W7 (`$done` ends a run), W9 (workflow
selection per run, label as visibility), GR6 (story ends on merge, or on issue closed with no PR
and no active run), GR7 (no parking in that case); a new rule defining a run.
