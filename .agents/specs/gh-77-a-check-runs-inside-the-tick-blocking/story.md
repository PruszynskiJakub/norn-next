---
id: gh-77
slug: a-check-runs-inside-the-tick-blocking
provider: gh
number: 77
url: https://github.com/PruszynskiJakub/norn-next/issues/77
title: A check runs inside the tick, blocking the watch loop and making the heartbeat look dead
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:fix
workflow: fix
status: new
intake_at: 2026-10-28T14:12:03.234Z
body_hash: a4a95fe4a63d66d08d23f91dc7985dd452b4dc7d5284c53dc1e5089cac808e32
---

## Observed

A check step runs inside the tick that starts it: act awaits the command (`packages/cli/src/runtime/act/check.ts`, `await runShell(...)`), and `norn watch` awaits each tick (`packages/cli/src/commands/watch.ts:73`). Nothing else happens on the checkout until the command exits or hits the step's `timeout`. The only queueing today is the K1 cap: when `max_checks` run leases are taken, the check is skipped as `queued` and retried on a later tick. Two checks decided in the same tick run one after the other.

On 2026-10-28, gh-75/02's check ran `bun install --frozen-lockfile && bun run test && bun run typecheck` (timeout 10m). Tick `01M60YNFAEKEBNWNAHS5PW5K28` started 09:50:07Z and ended 09:56:58Z (`duration_ms` 411380; the check itself 396573 ms, pass). The same happened right after for gh-75/01: tick `01M60Z6WNPSCW63X4YP7S4BEWA`, 09:59:37Z → 10:06:29Z (411614 ms). H6 expects a tick under 1 s on local state.

While such a tick runs:
- `heartbeat.json` `last_tick_at` is not updated. It is written only after `tick.end` (`packages/cli/src/runtime/tick.ts:131`, R5.5/H10), so after 3 × `watch_interval` (90s by default, `packages/core/src/policy.ts:42`) `norn status`/`norn inbox` show "no heartbeat on jakubpruszynski@mac for 2m — run `norn watch`" while `norn watch` is running.
- Nothing is observed or decided. Agents are not classified and no other step starts. Hook facts keep arriving but wait for the next tick.
- Claims are renewed only at the start of a tick (H7) and once 3m have passed since the last renewal (T4: lease 10m, renew 3m), so a check that blocks the tick for longer than about 7m can let a held claim expire before the next renewal. This repo's check timeouts are 10m (slice) and 15m (story, fix).
- `norn why` shows a tick with no `tick.end` as "tick crashed during act" (H9).

The "no heartbeat" item is attached to the first story this checkout holds (`packages/core/src/inbox/items.ts:101`), not to a story that needs the heartbeat. On 2026-10-28 that was gh-61, a manual story whose workflow is done and waiting for its PR merge, while the auto story that triggered it was gh-75.

## Wanted

A check no longer blocks the tick:
- The tick starts the check as a detached process and records it under the unit's `check` run lease (decide already has `check.running` for a unit with that lease, `packages/core/src/decide/steps.ts:64`). A later tick reads the exit code and output, then writes the check receipt (C5) and moves the step on.
- While a check runs, ticks keep going at `watch_interval`, so the heartbeat stays fresh and claims keep being renewed. Checks up to `max_checks` actually run in parallel.
- `norn status` shows the check as running with its age. The step `timeout` still kills it and records a `fail` with reason `timeout`, as today.
- Until then, at minimum: the "no heartbeat" item does not fire while a tick is visibly in progress (tick lock held by a live process), and it is attached to a story that needs the heartbeat (held, auto, with live units) rather than to the first held story.

## Repro

1. A story whose workflow has a `check` step whose command takes more than 90s (e.g. this repo's `bun install --frozen-lockfile && bun run test && bun run typecheck`).
2. Run `norn watch` until the step starts.
3. In another terminal, after 90s: `norn inbox` shows "no heartbeat … run `norn watch`" while `norn watch` is still running. `.agents/norn/trace/<day>.jsonl` has a `tick.start` with no `tick.end` until the check exits.
