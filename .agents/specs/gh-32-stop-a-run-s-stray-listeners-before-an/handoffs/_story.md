### Goal

Before a fresh agent session starts, stop what an earlier session left listening on the unit's slot ports from its worktree (same port + cwd rule as before a check), and record what was stopped.

### Proof

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted 1 | before launching an agent step, norn stops stray listeners on the slot ports + worktree and records what it stopped | test | `packages/cli/test/integration/agent-strays.test.ts` › "stops a listener the worktree left on its slot ports, and the trace records it" (start_run; the trace's result detail has `stopped_listeners`) |
| Wanted 2 | no change to the matching rule (port + cwd) | test | `packages/cli/test/integration/strays.test.ts` (unchanged and green); `stopStrayListeners` body unchanged |
| Check path unchanged | the check runner still stops strays, now through the shared `slotPorts` | test | `packages/cli/test/integration/check-run.test.ts`, `strays.test.ts` |

- Review #1: `bun run test` (1287 pass) and `bun run typecheck` green; the three integration files above passed locally (8 tests).

### Easy to miss

- The launch's step env carries the slot's real `PORT_BASE` and overrides `.env.norn`, so the range comes from `{ctx.env, .env.norn, launch.env}` merged, as in the check runner. The test uses a free port in the real slot range.
- Only fresh launches stop strays (`start_run`, `retry_fresh`). A resume (an answer via `apply_receipts`, a nudge resume) continues the same session, so its servers are kept.

### Not proven yet

- The rest of the integration tier runs in CI; only the three affected files were run locally.
- `retry_fresh` stops strays through the same `launchSession`, but no test covers that path (minor review finding).
- A run started by `norn brief` in manual mode has no launch, so nothing is stopped there; the issue asks only for the launch.

### Notes

- `slotPorts(PORT_BASE)` in `packages/cli/src/runtime/strays.ts` is shared by `act/check.ts` and `act/session.ts`.
- Recording: the check prepends a line to its output. An agent launch has no output, so the stopped listeners go into the action's result detail (`stopped_listeners`), which the tick trace keeps.

### Resume

Review approved; the next step takes the change from here.
