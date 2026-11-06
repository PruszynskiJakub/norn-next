---
id: gh-213
slug: retrying-a-check-that-failed-on-a-glitch
provider: gh
number: 213
url: https://github.com/PruszynskiJakub/norn-next/issues/213
title: Retrying a check that failed on a glitch needs cancel, stuck and rerun --step
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-06T09:17:02.313Z
body_hash: 7f7a950d3a6908dbb8c533b80d7818a7416ce708dd60a18979c494e0d3f455ac
---

## Observed

A check that fails for a reason unrelated to the code (a CI glitch, machine load, a flaky test) sends the unit to implement, which starts an agent at once. `norn run rerun <unit> --step <check>` is then refused with `running` (`run-rerun.ts:40`). The only way to retry the check on the same code is `norn run cancel`, then wait for stuck, then `norn run rerun --step <check>`.

Telling whether the code changed since the failed check is awkward too: norn's own `<check>.fail → implement` commit on the branch is always newer than the check receipt, so `git log -1 <branch>` cannot answer it. norn-fsd-round needed `git log -1 --format=%cI <branch> -- . ':(exclude,glob)**/runs/**'`. Getting this rule right in `packages/cli/assets/skills/norn-fsd-round/SKILL.md:42` took gh-196's reviews #2, #7 and #8.

## Wanted

One command retries a failed check on unchanged code. For example, `run rerun --step <check>` could be accepted while the unit sits at the step that check's fail sent it to, stopping that session itself. Also, `run view --json` could say whether commits outside `runs/` landed since a given receipt, so a person or a supervisor can tell a glitch from a real failure without git tricks.

## Where

- `packages/cli/src/commands/run-rerun.ts:40`: refuses a running unit (B50)
- `packages/cli/assets/skills/norn-fsd-round/SKILL.md:42`: the workaround

## Rules

B50; check and route rules W4, W7
