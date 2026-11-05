## Goal

A step agent (unit worktree, `NORN_RUN` set) can no longer approve or reject a gate as if it were the person (§6 gate row, SK3).

## Progress

- `decideGate` (`packages/cli/src/commands/story-approve.ts`) now refuses `story approve` / `story reject` when `ctx.unit` and `NORN_RUN` are both set: exit 3, code `gate_by_agent`, `do_instead` says gates are decided by the person or a supervisor in the main checkout. The check sits in the command, not in `delegation()`, because `delegation()` is shared by `story answer`, `run rerun` and `story edit`, which the issue does not cover.
- A person in a unit worktree without `NORN_RUN` is unchanged; `--delegated` from the main checkout is unchanged.
- Tests: two in `packages/cli/test/integration/delegated.test.ts` (refusals block). They fail without the fix (the agent's approve went through) and pass with it. Unit tier and typecheck green.
- implement#1 done: story approve/reject refused (exit 3, gate_by_agent) in a unit worktree when NORN_RUN is set; person without NORN_RUN and --delegated from main unchanged; integration tests red→green, unit tier + typecheck green

- review#1: approve, no findings. Traceability (spec Wanted items, verifier test):

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 agent's `story approve` / `story reject` in a unit worktree with `NORN_RUN` refused, exit 3, `do_instead` names person / main-checkout supervisor; gate untouched | test | `packages/cli/test/integration/delegated.test.ts` › "gh-224: a step agent's plain approve or reject in a unit worktree is refused, never recorded as the person's (§6, SK3)" |
| W2 delegated supervision from the main checkout unchanged | test | `packages/cli/test/integration/delegated.test.ts` › "delegated decisions are recorded apart from the person's (B21, B22, B34)" (existing, still green) |
| W3 a person in a unit worktree without `NORN_RUN` unchanged | test | `packages/cli/test/integration/delegated.test.ts` › "gh-224: a person in a unit worktree (no NORN_RUN) is not refused as an agent" |
- review#1 approve: review#1: approve, no findings; story approve/reject refused for a step agent (gate_by_agent, exit 3), delegated-from-main and person-without-NORN_RUN unchanged, all traced to tests in delegated.test.ts

## Resume

Review approved; next is the workflow's following step (QA / PR), nothing to rework.
