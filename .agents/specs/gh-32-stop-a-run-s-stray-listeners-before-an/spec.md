---
id: gh-32
slug: stop-a-run-s-stray-listeners-before-an
provider: gh
number: 32
url: https://github.com/PruszynskiJakub/norn-next/issues/32
title: Stop a run's stray listeners before an agent step, not only before a check
assignee: PruszynskiJakub
labels:
  - idea
  - norn
  - norn:kind:feature
  - norn:priority:low
  - norn:risk:high
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-07T22:33:43.386Z
body_hash: 43e20bf0cb375cee96707a9b294c4ec022464550ae3cc5ee10d71e037e02c6d1
---

## Observed

In todoist-app, slice `gh-1/01` got stuck because `implement#3` started a test server on port 4021 and never stopped it. The server had detached (parent PID 1), so neither the runner's process-group kill nor closing the pane reached it, and `implement#4`'s browser tests failed because they couldn't bind the port. A person had to `kill` it and `norn unstick`.

K4.1 already stops listeners on the slot's ports whose working directory is in the worktree, but only before a `check` step (`packages/cli/src/runtime/act/check.ts:132` → `packages/cli/src/runtime/strays.ts:52`). The incident was an agent step.

## Wanted

- Before launching an agent step, norn runs the same `stopStrayListeners` on the unit's slot ports and worktree, and records what it stopped, as the check runner does.
- No change to the matching rule (port + cwd).

## Out of scope

Running steps in Docker Sandboxes (`sbx`), the original idea of this issue: new workflow and config keys, a wrapping runner and six open questions, for a symptom this narrower fix covers. Marking a run's processes with `NORN_RUN_ID` is also out.

## Rules

K3, K4, K4.1.
