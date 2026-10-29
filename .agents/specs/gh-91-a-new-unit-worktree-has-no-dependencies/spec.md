---
id: gh-91
slug: a-new-unit-worktree-has-no-dependencies
provider: gh
number: 91
url: https://github.com/PruszynskiJakub/norn-next/issues/91
title: A new unit worktree has no dependencies installed, so the code can't run there until someone sets it up by hand
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-29T10:13:15.212Z
body_hash: efd93faac7eab9920a549608d8c31a2df19fc06523ec5e140f9bf9509ff84a51
---

## Observed

norn creates a unit worktree with `git worktree add` (`packages/adapters/src/git/index.ts:329-336`). It then adds only `.env.norn` and `.norn-unit` (`equipWorktree`, `packages/cli/src/runtime/worktrees.ts:31-55`). Nothing installs the project's dependencies.

In the gh-79 `reproduce` step, the brief told the agent to run `bun packages/cli/src/main.ts …`. In the fresh worktree that failed:

    error: Cannot find module '@norn/schema' from '…/gh-79-…/packages/cli/src/cli.ts'

It worked only after the agent ran `bun install` itself, which the brief never says to do. The repo's check commands work around this by starting with `bun install --frozen-lockfile && …` (every `run:` in `.agents/norn/workflows/*.yaml`). Agent steps have no such workaround, so each agent has to find out on its own and set the worktree up.

## Wanted

A unit worktree should be ready to run the project's code when the agent opens it. The repo should be able to name a setup command that norn runs once when it creates a worktree, for example `bun install --frozen-lockfile` in this repo. If that command fails, the failure should show up as a fact or an inbox item, not as an agent's step failing for a reason it can't see. Check commands could then drop their own `bun install` prefix.

## Repro

1. Let norn start a story so it creates a worktree under `norn-worktrees/`.
2. In that worktree run `bun packages/cli/src/main.ts --version` → `Cannot find module '@norn/schema'`.
3. Run `bun install`, then run it again → it works.

## Where

- Worktree created: `packages/adapters/src/git/index.ts:329-336`
- Worktree set up (slot, `.env.norn`, `.norn-unit`): `packages/cli/src/runtime/worktrees.ts:31-55`
- Check workaround: the `run:` lines in `.agents/norn/workflows/{fix,quick,story,slice,bug}.yaml`

## PRD

- K4: per-worktree resources in `.env.norn` and config slots. Nothing says how a worktree's dependencies get installed.
- K5: the tick creates slice worktrees. This would add a setup step when it does.
