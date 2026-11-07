### Goal

Before a fresh agent session starts, stop what an earlier session left listening on the unit's slot ports from its worktree (same port + cwd rule as before a check), and record what was stopped.

### Done means

- `packages/cli/test/integration/agent-strays.test.ts`: a server started from the worktree on a free slot port is stopped by the `start_run` tick, and the tick trace's `start_run` result detail carries `stopped_listeners: [{pid, port, command}]`. Seen red with the stop disabled (the server survives).
- `packages/cli/test/integration/strays.test.ts` and `check-run.test.ts` still green (the check path now shares `slotPorts`).
- `bun run test` and `bun run typecheck` green.

### Easy to miss

- The launch's step env carries the slot's real `PORT_BASE` and overrides `.env.norn`, so the range comes from `{ctx.env, .env.norn, launch.env}` merged, as in the check runner. The test therefore uses a free port in the real slot range (4010..4019 for slot 1), not a made-up one.
- Only fresh launches stop strays (`start_run`, `retry_fresh`). A resume (an answer via `apply_receipts`, a nudge resume) continues the same session, so its servers are kept.

### Not proven yet

- The integration tier runs in CI; only the three affected files were run locally.
- A run started by `norn brief` in manual mode has no launch, so nothing is stopped there; the incident was an auto-mode launch, and the issue asks only for the launch.

### Notes

- `slotPorts(PORT_BASE)` in `packages/cli/src/runtime/strays.ts` is shared by `act/check.ts` and `act/session.ts`.
- Recording: the check prepends a line to its output; an agent launch has no output, so the stopped listeners go into the action's result detail (`stopped_listeners`), which the tick trace keeps.

### Resume

Nothing left in this step; the next step reviews the diff.
