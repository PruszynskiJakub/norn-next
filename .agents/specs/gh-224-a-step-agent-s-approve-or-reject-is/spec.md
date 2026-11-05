---
id: gh-224
slug: a-step-agent-s-approve-or-reject-is
provider: gh
number: 224
url: https://github.com/PruszynskiJakub/norn-next/issues/224
title: A step agent's approve or reject is refused, not recorded as the person's
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-05T23:06:55.379Z
body_hash: ba0b38d30441f97308d5c0a65b2c3065c73992b196c44d0c1824de5934a6f6e5
---

## Observed

Inside a unit worktree (`NORN_RUN` set), a step agent can run plain `norn story approve <story>` or `norn story reject <story> --reason …` on a gate and it is accepted, written as `by: "human"` with `who: $USER@machine` — indistinguishable from the person's own decision. `--delegated` is already refused there ("a step agent never supervises", `delegated_in_unit`), but leaving the flag off goes through. Claude runs unattended in `--permission-mode auto` by default, so nothing stops it.

## Wanted

In a unit worktree with `NORN_RUN` set, `story approve` and `story reject` are refused like `--delegated` already is there: exit 3, a `CliError` whose `do_instead` says gates are decided by the person, or by a supervisor in the main checkout (SK3). Delegated supervision from the main checkout is unchanged. A person typing the command in a unit worktree outside an agent session (no `NORN_RUN`) is unchanged.

## Repro

In a throwaway repo, with a unit parked at a gate: `NORN_RUN=01J… bun packages/cli/src/main.ts story approve gh-1` from the unit worktree → accepted, receipt `by: "human"`.

## Where

- `packages/cli/src/commands/story-approve.ts:41` `decideGate`: no actor check.
- `packages/cli/src/runtime/human.ts:217`: the `delegated_in_unit` refusal to extend.
- `packages/cli/src/runtime/interaction.ts:29` `isAgentSession`: today only disables the picker.

## Rules

§6 gate row ("never a step agent"), SK3, P8 (`refused` = 3).
