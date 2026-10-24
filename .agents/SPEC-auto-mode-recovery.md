# Spec: auto mode and crash recovery (norn v1.1)

Status: accepted for implementation · Amends `.agents/PRD.md` · Source: `docs/audit-auto-mode/audit.md` (ids H1–H6, M1–M11, N1–N7, A1–A21)

## 1. Why

The auto-mode dogfood run showed the happy path works on both runners, but every failure path that matters for a team either loses work, duplicates it, or needs a person who knows norn's internals:

- Claim renewal takes the story's one action per tick, so merge cleanup and receipt application starve (H4, A15, F13) — and a takeover then records a finished run as `died` (H5).
- A hung headless agent cannot be nudged; the nudge always fails and still spends the budget (H1).
- A heartbeat crash between the `started` receipt and the launch record leaves an agent norn cannot see, and a later answer starts a second one (H2).
- Permission and trust prompts cannot be answered through norn, the failure is reported as success, and the agent's own report is then refused (H3).
- The checkout that lost an intake race later claims the merged story (H6), helped by one story's worktree supplying another story's record (M1).

This spec fixes the HIGH items and the MED items the team rerun depends on. LOW items and M2, M7, M9, M11 stay in the backlog; M10 is `SPEC-base-sync-and-qa.md`.

## 2. Rules

### R1 — Claim renewal is not a unit action (H4, H5, A15, F13)

- R1.1 `claim.renew` no longer occupies the unit's single action per tick. Decide emits it as a **side action** of the story, alongside at most one unit action.
- R1.2 Act performs a story's renewal **before** that story's other actions. If the renewal's CAS fails (the claim is gone or held by another heartbeat), act skips every other action of that story in this tick, records them as `skipped: claim lost`, and the next tick sees the claim as `other`/`expired`.
- R1.3 Consequence to test: on a tick where renewal is due and the PR is merged, the same tick decides `cleanup_merged_story`; on a tick where renewal is due and a `done` receipt is waiting, the same tick applies it.

### R2 — Receipts reach the record promptly, and lost ones are reported (H5, N4, N6, N7, A18)

- R2.1 The tick that applies a receipt (writes `state.json`) commits and pushes in the same tick (S8). `started` receipts are committed in the launch tick (no `recover.commit` on the next tick, N6).
- R2.2 A checkout that does not hold a story's claim never pushes that story's branches and never writes new receipts for it.
- R2.3 Observe reports, per story on a non-holder checkout, receipts and `runs/` changes that exist locally but not on the remote story branch: fact `story.unpushed_runs: {unit, files[]}[]`. Inbox Check item `unpushed:<story>:<hash>`: "local work on gh-9 is not in the record (0035-done) — the story is now held by X". `norn tidy` moves them to `runs/<unit>/orphaned/<holder>-<receipt file>` on the local branch only, so receipt numbers are never reused or pushed.

### R3 — Intake race and stale records (H6, A21, M1, N1)

- R3.1 When `claim.acquire.intake` loses the CAS, act removes what the intake created on this checkout (story worktree, local story branch, local spec folder) if it holds no commits beyond the intake commit; otherwise it keeps them and raises the R2.3 item.
- R3.2 Decide never emits `claim.acquire` (intake or re-acquire) for a story whose record on the base ref says `status: done` or whose PR is merged. The base record wins over any local spec.
- R3.3 `release` (including on `watch` exit) pushes a story branch only if this heartbeat holds the claim and the push is a fast-forward of the remote branch; otherwise it deletes nothing and reports why.
- R3.4 The snapshot reads a story's record only from that story's own worktree (identified by its `.norn-unit` marker) or from the base ref. A worktree never supplies another story's record (N1).

### R4 — Nudges that can be delivered (H1, A9, injection 2)

- R4.1 Runner ports declare capabilities: `send` (can type into a live session) and `resume` (can continue a finished session by id). Headless: `send: false, resume: true`. Herdr: `send: true, resume: true`.
- R4.2 A nudge (C1 routes for `silent`, `stalled`, `timeout`) is delivered by `send` when available; otherwise by `resume` with the step's nudge text (same path the B2 answer already uses: `--resume <agent_session_id>`), after terminating the old process if it is still present. Without either capability the route falls through to a fresh-session retry (counted as a retry, not a nudge).
- R4.3 **Act failures are never `ok: true`.** Any action whose effect failed (send, resume, launch, push) yields `ok: false` with the reason; the unit's failure is visible in `status` and as an inbox item under Unblock: "nudge to gh-10 not delivered: <reason>". This also covers A4's hidden failure.
- R4.4 `status` shows the last classification of a run (`stalled since 10:02`), not only process liveness, so a frozen agent is never shown as plain `alive`.

### R5 — Launch crash, orphans and heartbeat liveness (H2, A10, A14b, N2, N3)

- R5.1 A `started` receipt whose run has no applied state (crash between receipt and `state.json`) puts the run in **launch unknown**. Before deciding anything else for that unit, the tick looks for the run: hook facts with its `run_id`, runner sessions whose label or `checkout_path` match the unit worktree, processes with `NORN_RUN=<run_id>` in their environment where the OS allows it.
- R5.2 Found → **adopt**: record the session in state and continue as a normal running step. Not found after a grace window of 2 watch intervals with no hook activity for that `run_id` → classify `died` (C1, counted).
- R5.3 The tick never starts a new run for a step while any run of that step has hook activity within the stalled window — answers and retries included (A14b).
- R5.4 Every tick writes a `tick.start` trace record before act and a `tick.end` after. `norn why` shows a tick with no end as "tick crashed during act" and still resolves receipts that cite it (N2).
- R5.5 `heartbeat.json` records `last_tick_at`. `status` and `inbox` show it per checkout; if it is older than 3 × watch interval while any unit of a story this checkout holds is in auto mode, inbox adds Unblock item "no heartbeat on <holder> for 7m — run `norn watch`" and `status` stops showing manual start hints for auto steps (N3, A8).

### R6 — Prompts the agent is blocked on (H3, A4, A14)

- R6.1 An **implicit** ask is resolved without a person when a later fact shows the agent moved on: the pane left `waiting_input`, a newer hook event for the run arrived, or the agent reported (`done`, `ask`, `stuck`). The resolution writes an `answer` receipt with `by: "agent"`. Agent reports are accepted while parked on an implicit ask (A14); they stay refused while parked on an explicit `norn ask`.
- R6.2 `norn answer` to an implicit ask is delivered as keystrokes the prompt expects: for choice prompts the option number plus Enter (options parsed by the runner adapter from the pane, exposed as the ask's `options`); otherwise the text plus Enter.
- R6.3 Delivery failure (R4.3) leaves the unit parked and replaces the inbox item's command with how to reach the pane (`herdr` attach command), and the answer receipt is not written.

### R7 — Liveness across machines (M4, N5)

- R7.1 `started` receipts record `machine` (`user@host`) and `heartbeat_id`.
- R7.2 Process liveness (`died`) is checked only for runs started on this machine. A run from another machine is judged by its hooks and by the claim: after a `take`, a foreign run with no hook activity in the stalled window is classified `died` with rule `foreign run, holder changed`.
- R7.3 For tests and single-host dogfood, `NORN_MACHINE` overrides the machine name (documented as a test aid; `doctor` warns when set).

### R8 — Agents in runner panes run the right norn (M5, A1)

- R8.1 In every runner-started agent, `command -v norn` resolves to the norn that launched it. Act puts a shim directory (`$NORN_HOME/bin/norn` → the current norn entry point) first on `PATH` **inside the launched command itself**, so a login shell in the pane cannot reset it, and exports `NORN_BIN` with the absolute path. Hooks installed by `init`/plugin use `NORN_BIN` when set.
- R8.2 `norn doctor` runs `command -v norn` through the configured runner (one throwaway session) and fails when it resolves elsewhere.

### R9 — Launch prompt not received (M6, A11)

- R9.1 A run with a `SessionStart` hook but no turn start within 60 s gets its launch prompt re-sent once (`send`). If still nothing after another 60 s, the run is classified `silent` with rule `launch prompt not received` and the inbox says so with the pane to look at.

### R10 — Takeovers are in the record (M8, A17)

- R10.1 Every `norn take`, forced or not, writes a `take` trace event and a receipt kind `take` `{previous_holder, previous_heartbeat_id, expired: boolean}` on the story unit before any other effect. `norn trace` and `why` show it.

## 3. Contract changes

| Contract | Change |
|---|---|
| `Action` / act ordering | side action `claim.renew`; renewal-first per story; skip on claim loss (R1) |
| `Facts` | `story.unpushed_runs` (R2.3); run `launch_unknown` (R5.1); `heartbeat.last_tick_at` (R5.5) |
| Ports | runner `capabilities: {send, resume}`; adapter-parsed `options` for implicit asks (R4.1, R6.2) |
| `Receipt` | `started.machine`, `started.heartbeat_id`; `answer.by`; new kind `take` |
| `TraceEvent` | `tick.start`, `tick.end`, `take` |
| `heartbeat.json` | `last_tick_at` |
| CLI | `tidy` orphaned runs; `doctor` runner PATH check; `NORN_MACHINE`, `NORN_BIN` env |
| PRD | §8 (R1, R5.4–5.5), §9.1/9.2 (R5, R6, R8, R9), §10 C1 (R4.2), §13 T5/T6 (R2, R3, R7, R10) |

Every change ships with tests (core by trace replay, adapters by recorded fixtures), `bun run schema:emit`, and passes `bun test` and `bun run typecheck`.

## 4. Acceptance

Replay/unit tests, one per rule at least:
1. Renewal due + merged PR → cleanup in the same tick; renewal due + `done` receipt → applied in the same tick; renewal CAS lost → other actions skipped and recorded.
2. Non-holder checkout with an unpushed `done` → `unpushed` item; `tidy` moves it to `orphaned/`; nothing pushed.
3. Intake CAS loss → local intake removed; base record `done` → no acquire; release refuses a non-fast-forward push.
4. Two worktrees containing the same story's record → only the story's own worktree or the base ref is read.
5. Headless `stalled` → resume with nudge text; capability-less runner → retry; failed send → `ok:false` + Unblock item.
6. `started` without state + hook activity for the run → adopt; without activity after grace → `died`; no new run while hooks are active.
7. Crashed tick (no `tick.end`) → `why` explains it.
8. `last_tick_at` stale with auto units → inbox item, no manual hint.
9. Implicit ask then `norn done` → accepted, `answer{by: agent}`; choice prompt answered with option number; delivery failure → stays parked.
10. Foreign-machine run → no pid check; after take with no hooks → `died` with the foreign rule.
11. Launch env: `PATH` shim first inside the command; `NORN_BIN` set.
12. `SessionStart` without turn start → one re-send, then `silent` with the launch rule.
13. `take` writes a receipt and trace event.

Rerun (after implementation): the six injections of the auto-mode run, with **no** `bypassPermissions`, **no** wrapper script, **no** manual `norn sync`, and machine B as a separate machine (or, if none is available, `NORN_MACHINE` on one host, stated as a limit).
