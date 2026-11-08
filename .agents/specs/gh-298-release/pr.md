## Release 0.29.0

**0.29.0 (minor, proposed):** existing behaviour changes. A merge now ends a unit at `$done`, owed base records stop after 3 refusals, and `state.json` reads older shapes differently. The persisted `records.json` format also gains `refusals` and `stopped_at`.

## [0.29.0] - 2026-11-08

### Changed

- A merged PR ends every unfinished unit of its story at `$done`, not at the step it stood on. `norn run list` and the view show `$done`, the round counts as finished, so `norn story edit --workflow` starts the next round without `--force`, and `norn story wait --until step=<gate>` no longer matches a unit merged at that gate.
- An owed base-branch done record is no longer retried forever when the base refuses it. After 3 refusals (a rejected or unauthorised push, or a `spec.md` that cannot be patched) norn stops retrying and shows a notified Unblock item; network failures and stale pushes do not count. The record clears without a push once the base reads `done` or `dropped`, and `norn tidy` drops a stopped record whose story is gone. `records.json` gains optional `refusals` and `stopped_at`.
- `state.json` is stricter about which fields each status carries, and reads an older record without turning it corrupt. Two older shapes read differently: a `running` unit with no run reads as stuck (rerun it with `norn run rerun`), and a done unit at a step reads as done at `$done`.
- An idle or finished pane alone no longer ends an agent's turn: turn ends come from the agent's hooks only. Observe snapshots no longer carry the pane's `since`.

### Fixed

- Stop hooks firing at the same time can no longer block a run more than 3 times between them: each block takes its own slot file in the machine dir, and `norn tidy` prunes them with the run.
- A second clone on the same machine no longer shows another checkout's claimed story as its own: the view judges a claim by the checkout's heartbeat, as the verbs do, and the heading reads `Held elsewhere · in another checkout`.

