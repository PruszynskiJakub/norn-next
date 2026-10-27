---
id: gh-67
slug: norn-init-should-create-the-labels-norn
provider: gh
number: 67
url: https://github.com/PruszynskiJakub/norn-next/issues/67
title: norn init should create the labels norn needs on the remote
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: active
intake_at: 2026-10-27T22:26:49.689Z
body_hash: d821329f18a7402e061629aca5ceb0771569f39f128f15d74661ba34afcf3cae
---

## Observed

`norn init` creates no labels on the remote. It only prints a hint for the intake label, and only for GitHub: "`gh label create norn` (once)" (`packages/cli/src/commands/init.ts:122`). On GitLab there is no hint at all. The workflow labels `norn:wf:<name>` (W9) are never created or mentioned, so a repo has to create every `norn:wf:<name>` label by hand before it can select a workflow by label.

Seen while bootstrapping self-hosting (#63): CONTRIBUTING lists `norn` and `norn:wf:{triage,story,fix,quick,spec,release}` as labels to create by hand.

## Wanted

`norn init` makes sure the remote has the labels norn reads, on GitHub (`gh`) and GitLab (`glab`):

- the intake label `config.remote.label` (default `norn`, GR1);
- one `norn:wf:<name>` per story workflow the repo has (built-in plus `.agents/norn/workflows/`, W9).

Existing labels are left alone, so the step is idempotent. Re-running `init` after adding a workflow creates its label. When the CLI is missing, unauthenticated or lacks permission, `init` says so in its report with the command to run, instead of failing. The `init` report lists which labels it created and which already existed.

Open for triage: does this belong in `init`, or in `norn doctor` (check, with `--fix`), or in both? Should it be a new `RemotePort` method (`ensureLabels`), given that ports perform one effect each?

## Where

- `packages/cli/src/commands/init.ts:119-123`: the hint.
- `packages/core/src/ports.ts:311`: `RemotePort` has no label operation.
- `packages/adapters/src/gh`, `packages/adapters/src/glab`.

## PRD

GR1 (intake label), W9 (`norn:wf:<name>`), X2 (ports).
