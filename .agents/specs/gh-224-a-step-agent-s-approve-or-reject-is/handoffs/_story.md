## Goal

A step agent (unit worktree, `NORN_RUN` set) can no longer approve or reject a gate as if it were the person (§6 gate row, SK3).

## Progress

- `decideGate` (`packages/cli/src/commands/story-approve.ts`) now refuses `story approve` / `story reject` when `ctx.unit` and `NORN_RUN` are both set: exit 3, code `gate_by_agent`, `do_instead` says gates are decided by the person or a supervisor in the main checkout. The check sits in the command, not in `delegation()`, because `delegation()` is shared by `story answer`, `run rerun` and `story edit`, which the issue does not cover.
- A person in a unit worktree without `NORN_RUN` is unchanged; `--delegated` from the main checkout is unchanged.
- Tests: two in `packages/cli/test/integration/delegated.test.ts` (refusals block). They fail without the fix (the agent's approve went through) and pass with it. Unit tier and typecheck green.

## Resume

Nothing left for implement; review the diff.
