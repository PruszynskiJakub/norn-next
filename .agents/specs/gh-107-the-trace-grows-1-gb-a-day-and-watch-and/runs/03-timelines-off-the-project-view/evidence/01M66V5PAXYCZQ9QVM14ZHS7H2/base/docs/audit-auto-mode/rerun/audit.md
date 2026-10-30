# Audit: norn auto-mode rerun after PR #6 (2026-10-24)

This audit checks the driver's run log (`run-log.md`) and defect list (`friction.md`, B1–B11) against the raw evidence in this folder and the norn source at **`c39b99e`** (branch `fix-auto-mode-recovery`, spec `.agents/SPEC-auto-mode-recovery.md`, rules R1–R10). Source paths are relative to the norn repo at that commit. Evidence paths are relative to this `auto-run-2/` folder.

The baseline is the first run's audit (`origin/audit/auto-mode:docs/audit-auto-mode/audit.md`, ids H1–H6, M1–M11, N1–N7, A1–A21).

**Times.** Trace timestamps are UTC. The run log uses CEST (UTC+2).

**How the evidence was read.**

- Both traces were reduced to every non-noop decision, every `unit.parked.ask`, every `tick.start` without a `tick.end`, and every hook fact.
  - `traces/A-2026-10-24.jsonl` has 1 199 records. It is the tail of the checkout's file (lines 413–1611 of the original), so its line 1 is 11:57:37Z.
  - `traces/B-2026-10-24.jsonl` has 914 records.
- The reductions were cross-checked against `snaps/*`, `watch-*.log`, the `inj*` and `h4-*` files, and the configs.
- The git state was checked in both sandboxes and on `origin`: `origin/main`, `origin/gh-19-…`, B's local gh-19 branch and both worktree lists.
- `~/.norn/leases` was inspected after the run.

---

## 1. Verdicts

### 1.1 Injections and headline checks

| Item | Driver | Audit | Evidence and notes |
|---|---|---|---|
| INJ 1: SIGKILL a headless agent | works | **CONFIRMED** | Kill at 12:03:26 → `agent.died.retry` at 12:03:38 (12 s). The second kill at 12:04:11 → `agent.died.stuck` at 12:04:23 (12 s), with `retries 1/1`. Evidence: trace A, `inj1-kill1.txt`, `snaps/01-died-retry`, `snaps/02-died-stuck`. |
| INJ 2: SIGSTOP a headless agent (H1) | fixed | **CONFIRMED** | SIGSTOP at 12:08:43. At 12:11:50, `agent.stalled.nudge.resume` ran with ok:true. The decision carries `kill` for pid 59153 and `launch.resume` with the session id. A new pid, 62511, started at 12:11:54. The nudge text arrived as `turn_start` at 12:11:55–56, and `done` was applied at 12:12:20. Between the SIGSTOP and the classification the views still said `alive` with no item. That is by design (R4.4 shows classifications only), so a hang is invisible for one full stalled window. |
| INJ 3: Esc in a herdr pane | partly (A16) | **CONFIRMED** | The last hook was at 12:16:36 and the Esc at 12:16:40. `agent.stalled.nudge` came at 12:20:04 (3m24s after the Esc). It was not `silent`. M2/A16 is unchanged and was out of scope for PR #6. Side effect: this spent gh-19 review's only nudge, which is why B6 then ended in `$stuck`. |
| INJ 4: SIGKILL watch mid-act (H2) | fixed on B; A missed | **CONFIRMED, with one caveat** | 4b: the watch was killed at 12:13:57.2 on `0022-started`. The crashed tick `…9NMH` has `tick.start` and no `tick.end`. `why --tick` says "tick crashed during act" (`snaps/06-hb-crash-B-down/why-crashed-tick.json`). `run.adopt` at 12:14:08 recorded w17:p1 / pid 65558, and only one review run (`…NKMNZR`) has hooks. **The adoption came from the driver's manual `tick --sync`, not from a restarted watch.** Its tick `RCX87D` is absent from `watch-B.log`, so a watch restart was never tested; the code path is the same. 4c: watch killed at 13:00:31.996, workspace closed at +0.17 s, `run.launch_unknown.wait` ×2, then `agent.died.launch_unknown.retry` at 13:01:08 (36 s after the crash). 4a (headless): missed. By 12:34:14.105, state.json was already `running` with a session (`inj4a-crash.json`). |
| INJ 5: B dies holding an unapplied `done`, take from A (H5, R10) | partly | **CONFIRMED** | The early take was refused with `claim_held` (`inj5-take-early.json`). The take at 12:27:09 came 20 s after expiry and wrote the `0036-take` receipt (pushed, d59f186) plus a `take` trace event. No `died` was recorded and no retry was spent, so N4 and N7 are fixed. B's return raised the Check item, and `tidy` moved 0036-answer, 0037-done and handoff.md to `orphaned/` on B's local branch only. `origin/gh-19` holds A's 0036–0042 and no collision. **But** A sat on `unit.parked.ask` (noop) from 12:27 to 12:31 (B8, cause in §1.2). The run only moved because the person answered "1" for a pane on a dead machine. That answer was never delivered: it cleared the park, and A started a fresh review (no retry counted). B's finished review was redone. |
| INJ 6: permission prompts (H3) | partly | **CONFIRMED, and worse than stated** | The implicit ask is detected within one tick: PreToolUse at 12:05:44.8 → park at 12:05:49, with options and a numbered choice. `norn answer "1"` delivered the keys (`inj6-answer1.json`, `delivered:true`). An answer typed in the pane resolved by itself in 13 s (`answer by: agent`). **B6 happened three times, not twice.** The driver missed the first one: answer 0018 at 12:11:43 (gh-19 implement#2), then `norn done` was refused, and Stop at 12:11:48 says "`norn done` was refused…". It was recovered only by the silent nudge at 12:12:49, and `done` landed at 12:13:04. In all, 3 of the 6 `norn answer` deliveries in the run were followed by a refused report. The trust dialog never appeared and is untested. |
| H4: merges noticed without sync | fixed | **CONFIRMED** | 8 of 8 merges were cleaned up by watch ticks (all the tick ids are in `watch-*.log`). Latencies: 27, 21, 46, 39, 39, 27 s (A) and 37, 34 s (B). Renewal and cleanup happened in the same tick (e.g. `EZ8PMR` at 12:09:00), so R1.3 holds. |
| H6: intake race | mostly fixed | **CONFIRMED** | The CAS loser cleaned up twice (gh-27 and gh-28: `intake.removed` lists the worktree, branch and slot). Decide on B emits `story.finished` for every merged story (`decide.ts:214-216`, base status). The views are still stale (B10), and a loser that never ran the CAS keeps its intake (B5). The one race in a running watch was forced by manual ticks. |
| R8: PATH shim | works, but breaks herdr with a long PATH | **PARTLY** | The env in the pane is right (`r8-agent-env.txt`). R8.1 causes B2, a regression. The hook half of R8.1 (`${NORN_BIN:-norn}`) was not exercised: the sandbox's committed `.claude/settings.json` calls the absolute path `/Users/…/norn-sandbox-todoist/.bin/norn`, which is **checkout A's** wrapper, even for B's agents. R8.2 `doctor` did fail, correctly, but its message ("no answer … within 15s") does not name the cause. |
| R9: launch prompt re-send | works | **CONFIRMED (first stage only)** | There were four re-sends, at 71–72 s after SessionStart: gh-28 at 12:41:38, 12:45:23, 12:49:23 and 12:55:38. They were induced only by the B3 argument order, not by the A11 environment cause. The second stage (`agent.silent.launch_prompt`) never fired. |
| R5.5: no-heartbeat item | works | **CONFIRMED (B); partly evidenced (A)** | B (`snaps/06`): an Unblock item plus a status line, and no manual start hint. "Running review #1" was correct, because the run had been adopted. A (`snaps/13`): the per-story status shows the warning at 45 s and 47 s, but the whole-repo status and the inbox were captured at 42 s, before the threshold. |

### 1.2 Defects B1–B11

| Id | Claim | Audit | Cause at `c39b99e` / notes |
|---|---|---|---|
| B1 | `doctor` hook check runs the global `norn` | **CONFIRMED** (LOW) | `hookFires` runs the hook with `{...process.env, ...ctx.env}` and never sets `NORN_BIN` (`packages/cli/src/commands/doctor.ts:86-93`). `"${NORN_BIN:-norn}"` therefore resolves to `~/.local/bin/norn` 0.11.0 (`doctor-A.json`, `doctor-B.json`). |
| B2 | R8.1 inline `env PATH=…` is truncated in a fresh herdr pane | **CONFIRMED** (HIGH, **regression from PR #6**) | `withNornOnPath` inlines the whole PATH into argv (`packages/cli/src/runtime/shim.ts:40-44`; used at `act.ts:500`). Herdr creates the workspace and runs `pane run` at once, without waiting for the shell (`packages/adapters/src/herdr/index.ts:147-153`). The trace backs this up: the launches into w14 and w15 recorded **no `process`** (the agent never took the foreground), followed by `agent.died` "process gone, no receipt" ×2 → `$stuck`. With a ~110-byte PATH, every launch recorded a pid. The truncation at 1 024 bytes is the driver's observation, consistent with macOS MAX_CANON; no pane capture of the cut line is in the folder. The same PATH is already passed through `--env` (`index.ts:136-137`), so the inline copy is redundant. Also an **R4.3 gap**: a launch with no foreground process after `startWaitMs` returns ok:true (`index.ts:155-168`) and burns the retry. |
| B3 | Variadic flag swallows the prompt | **CONFIRMED** (MED) | `argv.push(...(req.config.args ?? []), req.prompt)` with no `--` (`packages/adapters/src/claude/index.ts:172`). The run log in the sandbox says "Input must be provided … when using --print". The Unblock item says only "died: retries 1/1" and never points at the run log. |
| B4 | Nudge text is the `silent` text for every route | **CONFIRMED** (LOW) | One constant, `NUDGE_TEXT` (`packages/core/src/commands.ts:9`), was sent both by the headless resume (12:11:55) and by the herdr stalled nudge (12:20:05). |
| B5 | Intake leftovers when the claim was never tried | **CONFIRMED** (LOW) | R3.1 cleanup runs only on a lost CAS (`act.ts:999-1000`). `tidy` removes only orphan worktrees of stories unknown to the checkout (`packages/cli/src/commands/tidy.ts:3,44`). B still has the gh-23 worktree and slot lease 4 after the run. |
| B6 | Report refused while a person's answer waits to be applied | **CONFIRMED** (HIGH; incomplete fix of H3, made more frequent by R6.2) | `implicitAskOpen` returns null when an `answer` is unapplied (`packages/cli/src/runtime/agent-unit.ts:140-141`), so `refuseUnlessAgentWork` throws `parked_ask` (`:128-129`). It occurred 3 times: 12:11:43→12:11:4x (gh-19 implement, recovered by the nudge), 12:20:43→12:20:45 (gh-19 review, **lost**), and 12:42:38→12:42:4x (gh-28, recovered by the nudge). **norn keeps no record of a refused report.** The only trace is the agent's Stop text. |
| B7 | Approve then merge in one tick: main's record stays at the gate | **CONFIRMED** (MED) | `origin/main` has gh-18 `state.json` `parked ready#2`, `applied_through 35`, and `story.md` `status: done`. GR6 cleanup only sets `story_status: "done"` (`packages/core/src/decide.ts:270-285`). The approve was pushed to the story branch after the merge (e3c98ba). The inbox Approve item for a merged story shows on both checkouts to the end (`snaps/18-final-*/inbox.txt`). |
| B8 | A taken story parked on a foreign implicit ask is never judged | **CONFIRMED** (MED) | The `parked` branch returns `unit.parked.ask` before `classifyRun` is reached (`decide.ts:487-492`). The R7.2 foreign rule lives only in `classifyRun` (`decide.ts:749-754`). `implicitAskResolved` ignores foreign runs (`decide.ts:994-1006`). The run record did carry `machine: jakubpruszynski@machine-b`. `agent.died.foreign` and `agent.running.foreign` never fired in either trace, so **R7.2 is untested**. |
| B9 | Implicit ask flaps with parallel tool calls | **PARTLY**: the flap is confirmed, the cause is not | gh-28: parked at 12:41:53.321, resolved by "hook PreToolUse at 12:41:53.512", re-parked at 12:42:23 on the identical prompt. gh-19: parked at 12:22:49, resolved by a PreToolUse at 12:22:50.9 whose own permission Notification came at 12:22:57. **These were sequential calls, not parallel siblings.** The hook stamps `at` when the norn hook process runs (`packages/cli/src/commands/hook.ts:148`). The PreToolUse of the very command on screen can therefore carry a time later than the tick that saw the prompt. R6.1 accepts any non-waiting hook newer than `park.since`, even while the pane is still blocked (`decide.ts:1004-1005`). This is new R6.1 behaviour, so it counts as a regression (LOW–MED: noise receipts and commits, and the Answer item disappears for one tick). |
| B10 | Merged story offered for `take` on a non-holder | **CONFIRMED** (MED; A20/M7 not fixed) | `storyFinished` reads `story.frontmatter` (the checkout's own stale worktree wins under R3.4) and ignores `story.base_status` (`packages/core/src/inbox.ts:301-304, 408`). Decide uses `base_status` (`decide.ts:214`), and indeed decided `story.finished` for gh-19, gh-23 and gh-18 on B. After the run: B's gh-19 and gh-23 worktrees, A's gh-28 worktree and slot leases 3, 4 and 6 remain in `~/.norn/leases`. |
| B11 | Tick and agent resolve the same ask → S6 clash | **CONFIRMED** (LOW, **regression from PR #6**) | The decide-side `resolveImplicitAsk` numbers receipts from facts (`decide.ts:1010-1043`), and the agent-side `writeReport` appends its own `answer by: agent` (`packages/cli/src/runtime/report.ts:47-66`). Both target the same ask. S6 refused the second write correctly, but `watch-B.log` reports `failed_actions: 1`. |

### 1.3 Findings the driver missed

- **D1: B6 is more frequent than reported** (see INJ 6). Three of six `norn answer` deliveries led to a refused report. Refusals leave no trace in norn's records, so a person sees only "silent: nudges 1/1" (`snaps/08-H3-report-refused/inbox.txt`).
- **D2: Hooks on "machine B" ran checkout A's file.** The committed `.claude/settings.json` (from an older `norn init`) hard-codes `/Users/jakubpruszynski/Projects/norn-sandbox-todoist/.bin/norn`, which lives in checkout A. A real second machine would get **no hook facts at all** unless that path existed there. That would disable R5.1 adoption, R6.1, R9, `silent` and stalled detection. The R8.1 hook path (`NORN_BIN`) was not exercised.
- **D3: Several new rules never fired:**
  - R7.2 (`agent.died.foreign`, `agent.running.foreign`);
  - R9 second stage (`agent.silent.launch_prompt`);
  - R1.2 skip on claim loss;
  - R6.3 failed delivery, `ok:false` for an answer;
  - R5.1 adoption by a restarted watch (it happened in a manual tick).
- **D4: A failed launch is still `ok:true`** (R4.3 gap, part of B2). It cost gh-19 its only retry within 30 s.
- **D5: norn's own crash spends the agent's retry.** The R5.2 `died` is counted (4c). With `retries: 1`, a watch crash during launch leaves the step one agent failure away from `$stuck`. LOW, design question.
- **D6: Normal races are counted as failures.** A lost intake CAS is ok:false and sets `tick.end failed=1` (B 12:37:53 and 12:39:08), the same class as B11. `failed_actions` stops being a useful alarm.
- **D7: N6 residual.** `recover.commit` no longer follows every launch. It still runs for receipts written by CLI verbs (`answer`, `approve --reject`, `mode`) and for handoff.md: 3 times on A and 6 on B. For example, 6fd54af commits only `0025-answer.json` as a "recovered commit". LOW.
- **D8: Smaller view errors:**
  - B's Approve item for gh-18 links to `…-b-worktrees/gh-18-…/0035-classify.json`, a worktree B never had.
  - On a non-holder, `status gh-19` suggests `norn answer` (`snaps/12-B-returns/status-gh-19.txt`).
  - A stuck unit is still listed under Runs (`snaps/03`; A6 is open).
  - `remote.intake … skipped` still repeats on every sync tick for stories held elsewhere (A2 is open).
- **D9: A run-log attribution slip.** The gh-28 "turn_end 'Claude is waiting for your input' at 12:44:17" belongs to the finished implement run `…GKWPNM` (its idle notification), not to the review run. It does not change the R9 verdict.
- **D10: No duplicate runs and no conflicting receipts on origin.** Hook spans per `run_id` show no two live runs of one step. Overlaps are idle notifications of finished panes left open (A12/M11). The only wrong record pushed to origin is B7: main's gh-18 `state.json`, plus a commit on an already-merged branch. B pushed nothing for gh-19 after the take (R2.2 holds).

---

## 2. Before and after: first-run HIGH and relevant MED items

| First run | Status now | Evidence |
|---|---|---|
| H1: headless nudge always fails | **Fixed** | INJ 2 |
| H2: orphan after crash, duplicate run later | **Fixed on herdr.** The headless window was never hit; adoption was proven only by a manual tick. | INJ 4b, 4c |
| H3: prompts not answerable; approved report refused | **Partly fixed.** Keys are delivered and pane answers self-resolve. Reports are still refused after `norn answer` (B6). The ask flaps (B9). The trust dialog is untested. | INJ 6, B6, B9 |
| H4: renewal starves cleanup | **Fixed** | 8 merges, 21–46 s |
| H5: takeover loses the last receipts and records `died` | **Mostly fixed.** Take receipt, unpushed report, `orphaned/`, no false `died`, no retry spent, no number collision. Open: B8 (the foreign ask is never judged). The finished work of a dead machine is inherently redone. | INJ 5 |
| H6: intake loser claims the merged story | **Fixed in decide.** Views are stale (B10). A non-CAS loser keeps its intake (B5). | §1.1 |
| M1: snapshot shadowing (N1) | Not exercised. Decide reads `base_status`. | `decide.ts:214` |
| M2: herdr `silent` from pane state (A16) | **Open** (out of PR #6 scope) | INJ 3 |
| M3: heartbeat liveness (N3) | **Fixed** | `snaps/06`, `snaps/13` |
| M4: cross-machine liveness (N5) | **Untested.** R7.2 never fired, and B8 bypasses it. | §1.3 D3 |
| M5: wrong `norn` in panes (A1) | **Fixed for the agent env**, at the cost of the B2 regression. The hook path is unproven (D2). | `r8-agent-env.txt` |
| M6: launch prompt not noticed (A11) | **Fixed** (first stage) | R9 |
| M7: non-holder stale state (A18, A20) | **Half fixed.** Unpushed-work item and `tidy` work. Merged stories are still offered for `take` (B10). Stale worktrees and leases are left. | `snaps/12`, `snaps/16` |
| M8: take not recorded (A17) | **Fixed** | `inj5-take.json`, B trace `take` |
| M11: panes and workspaces pile up (A12) | **Open.** A new workspace per launch; panes are never closed. | `herdr-workspaces-end.txt` |
| N2: crashed tick missing from trace | **Fixed** | `why-crashed-tick.json` |
| N6: `recover.commit` after every launch | **Mostly fixed** (D7) | trace |
| A4: answer not deliverable, ok:true | **Fixed** for delivery. The failure path is untested. | `inj6-answer1.json` |
| A7/L1: raw-screen inbox | **Fixed.** The item shows the question, the first command line and the options. | `snaps/04` |

---

## 3. Observability scorecard

The test for each event: could a person with only `status`, `inbox`, `trace`, `why` and receipts tell **what** happened, **when**, **why**, and **what to do**? Y = clear, P = partial or misleading, N = absent. "First run" gives the earlier row for the same event where one exists.

| Event | What | When | Why | Do | First run | Gap |
|---|---|---|---|---|---|---|
| Agent killed → retry → stuck (INJ 1) | Y | Y | P | Y | Y Y P Y | "process gone, no receipt" only. The trace text still folds runs into one row (A5). |
| Launch never ran (B2) / prompt swallowed (B3) | P | Y | N | N | — | Shown as `died`. No pointer to the pane or run log. `unstick` repeats the failure. |
| Hung headless agent (INJ 2) | Y | Y | Y | Y | P P N P | Blind for one stalled window (by design). The nudge text says "you ended your turn" (B4). |
| Interrupted herdr turn (INJ 3) | P | Y | P | Y | P Y P Y | Classified `stalled` instead of `silent` (M2). |
| Watch crash mid-launch (INJ 4b) | Y | Y | Y | Y | N N N N | `why --tick` explains the crashed tick. The heartbeat item names `norn watch`. |
| Launch admitted but never ran (INJ 4c) | Y | Y | Y | Y | — | The trace row explains "launch unknown … (R5.2)". |
| Machine gone + take (INJ 5) | P | Y | N | P | P P N P | Take receipt and event are present. Nothing says the parked ask belongs to a dead machine. "Answer 1" works by accident. |
| Returning checkout (B) | Y | Y | Y | Y | N N N N | Check item + `tidy`. Status still offers `answer` to a non-holder. |
| Permission prompt (INJ 6) | Y | Y | Y | Y | Y Y P N | Question, command, options, keys delivered. |
| Report refused after `norn answer` (B6) | P | P | N | P | (A14) | norn records nothing about the refusal. The inbox says "silent: nudges 1/1". The person must read the pane to learn why. |
| Approve, then merge in one tick (B7) | N | N | N | N | — | Every checkout says "approve" for a merged story. |
| Merged story on a non-holder (B10) | N | N | N | N | P | Offers `norn take` for finished stories. |
| Intake-race loser (H6) | Y | Y | Y | Y | P Y N N | The trace lists what was removed. The watch counts it as a failed action (D6). |
| Ask flapping (B9) | P | Y | P | Y | — | "moved on" commits while the prompt is still on screen. |

**Summary.** The crash-adjacent paths, which were the first run's blind spots (heartbeat outage, orphan, launch unknown, returning checkout), are now explained by norn's own outputs.

The remaining blind spots are:

- **refusals of agent reports**, which are not recorded;
- **cross-machine parking** (B8);
- **views that trust a stale local record** over the base (B7, B10);
- **launches that never started** (B2, B3).

---

## 4. Detection latency

Settings in this run: `watch_interval` 15 s, `stalled` 3m, `claim.lease` 3m, `renew` 1m, `sync_interval` 1m, nudges 1, retries 1. The last column estimates the defaults: 30 s, 15m, 10m, 3m, 5m, nudges 2.

| Event | Injected (UTC) | First norn reaction | Latency | Outcome | With defaults |
|---|---|---|---|---|---|
| 1a SIGKILL agent | 12:03:26 | 12:03:38 `agent.died.retry` | 12 s | retry | ≤ 30 s |
| 1b SIGKILL retry | 12:04:11 | 12:04:23 `agent.died.stuck` | 12 s | `$stuck` | ≤ 30 s |
| 2 SIGSTOP agent | 12:08:43 | 12:11:50 `stalled.nudge.resume` | 3m07s | `done` 12:12:20 | ~15 min |
| 3 Esc (herdr) | 12:16:40 | 12:20:04 `stalled.nudge` | 3m24s | resumed in the same session | ~15 min |
| 4b watch killed mid-launch | 12:13:57.2 | 12:14:08 `run.adopt` (manual tick) | 11 s | adopted, no duplicate | 1 tick after restart |
| 4b heartbeat item | 12:13:57 | shown at threshold (3 × interval) | 45 s by rule; captured at 1m38s | Unblock "run `norn watch`" | 90 s |
| 4c launch never ran | 13:00:32.0 | 13:01:08 `died.launch_unknown.retry` | 36 s (15 s after restart) | retry | ~60 s after restart |
| 5 B dies after `done` | 12:24:05.9 | claim expiry 12:26:49; take 12:27:09 (manual); the foreign run is never classified | 2m43s to expiry; ∞ to classification | fresh run 12:31:40, only after a person answered (7m34s) | ≥ 10 min + a person |
| 6a permission prompt | PreToolUse 12:05:44.8 | 12:05:49 `agent.ask.implicit` | 4 s (bound: 1 tick) | parked | ≤ 30 s |
| 6b answer typed in the pane | 12:07:06 | 12:07:19 `ask.implicit.resolved` | 13 s | running | ≤ 30 s |
| B6 report refused | 12:20:45 | 12:21:04 `agent.silent.stuck` | 19 s | finished review lost | nudge first (budget 2), then the same |
| R9 prompt swallowed | SessionStart 12:40:27 | 12:41:38 re-send | 71 s (72 s on 12:44:11) | agent works | 60–90 s |
| H4 PR merged | 8 merges | `remote.pr_merged` | 21–46 s | cleanup | ≤ 5.5 min |
| H6 CAS lost | 12:37:49 (A wins) | 12:37:53 B removes its intake | same tick | clean | same |
| B2 truncated launch | 12:00:15 | 12:00:30 `died.retry`, 12:00:45 `$stuck` | 15 s / 30 s | stuck, cause unknown | 30 s / 60 s |

---

## 5. Process limits: what this run does and does not prove

1. **"Machine B" shared the host with A.** Same user, same `~/.norn`, same herdr server and same process table, with `NORN_MACHINE=machine-b` on B's watch, CLI and agents (via `agents.claude.env`). The consequences:
   - Agent and slot leases were global. B reclaimed A's dead agent leases (B `leases.reclaim` at 12:00:30 and later), and slot numbers were unique across checkouts. Neither would happen on two machines.
   - "Machine gone" meant killing B's watch and closing pane w18 by hand. With a real loss the pane would not be reachable either, so B8 would behave the same.
   - R7.2 was not exercised (D3), so cross-machine liveness is still unproven.
   - Hooks for B's agents ran checkout A's `.bin/norn` by absolute path (D2). On a real second machine, B would have no hooks unless that path existed.
2. **B's watch ran with a ~110-byte PATH from 14:01:49** (`tools/startwatch.sh`). This was a declared workaround for B2. Every herdr launch after that point avoided the regression, so B2's real-world impact was observed only twice (plus the doctor check).
3. **The trust dialog never appeared.** R6.2 for trust and arrow-menu prompts is untested.
4. **Headless permission behaviour is not visible.** A ran `claude -p` with `acceptEdits` and an `--allowedTools` list. No implicit ask ever occurred on A, because `-p` denies unlisted tools silently. Whether denials degraded any headless run cannot be told from norn's outputs.
5. **Manual ticks.** `tick --sync` by hand drove setup (A ×3, B ×4) and all three H6 attempts, and it performed the INJ 4b adoption. The H4 cleanups all came from watch ticks (their tick ids are in `watch-A.log` and `watch-B.log`).
6. **R9 was induced by a config** (the B3 argument order), not by the original A11 cause.
7. **Limits were shortened** (stalled 3m, lease 3m, nudges 1, retries 1). That made B6 end in `$stuck` for gh-19 review, because INJ 3 had already spent the nudge. With the default budget of 2 it would more often recover, after one extra silent window.
8. **A person acted in the panes.** They answered prompts in the pane (to avoid B6 from 14:24 on), pressed Esc and closed workspaces. One PR conflict (#29, gh-27) was resolved by hand outside norn (F8/M10).
9. **Evidence gaps:**
   - no pane capture of the truncated B2 command;
   - no `inbox` capture for A after the 45 s threshold;
   - `traces/A-…jsonl` is a tail copy (line offset 412).

**Hard rules: kept, per the evidence.**

- **No `bypassPermissions`.** It appears in no config (`config-A.yaml`, `config-B*.yaml` use `acceptEdits` + `--allowedTools`). The only match in the folder is the run log's own statement.
- **No agent wrapper.** `agents.claude.command` is unset in `config-A.yaml` and `config-B.yaml`. The first run's `claude-b.sh` remains only in `config-B.leftover.yaml`, which was replaced at setup. `.bin/norn` (`norn-wrapper-B.sh`) is a wrapper that runs norn from source, not an agent wrapper.
- **No manual `norn sync`.** None was run. `tick --sync` was used as listed in item 5.

---

## 6. Ranked backlog

"Reg" marks a regression introduced by PR #6.

| # | Sev | Item | Fix direction | Reg |
|---|---|---|---|---|
| 1 | **HIGH** | **B2**: the herdr launch is truncated by the inline `env PATH=<full PATH>`; the launch reports ok:true and burns the retry (R4.3 gap) | Do not inline the PATH. It already travels in `--env`. Inline only `NORN_BIN=<abs>` plus `PATH="$NORN_HOME_BIN:$PATH"` through `sh -c`, or wait for the pane shell's prompt before `pane run`. A launch with no foreground process after `startWaitMs` → `ok:false` with the pane id. Make `doctor` name the cause (command length > MAX_CANON). | **yes** |
| 2 | **HIGH** | **B6**: an agent report is refused while a person's answer waits to be applied; finished work is lost when the nudge budget is gone (3 of 6 answers) | `agent-unit.ts:140-141`: an implicit ask with a pending answer still accepts reports (write the report after that answer, without another `answer by: agent`). Only an explicit `norn ask` blocks. Trace every refused report (`report.refused`) so the views can say why a run went silent. | no (H3 remainder) |
| 3 | MED | **B8**: a taken story parked on a foreign implicit ask is never judged; the inbox asks for an answer to a dead pane | In the `parked` branch (`decide.ts:487`), for an implicit ask whose run is foreign and whose heartbeat differs, apply R7.2: after the stalled window with no hooks, `died` with the foreign rule. The Answer item should say "on <machine>, not reachable from here". | no |
| 4 | MED | **B7**: approve then merge leaves main's record at the gate | In GR6 cleanup, also take the story unit to `$done` in the base record, or apply pending receipts before cleanup. Views treat `story.md status: done` / `base_status` as finished. | no |
| 5 | MED | **B10 + B5**: merged stories are offered for `take` on non-holders; stale worktrees and slot leases remain | `storyFinished` uses `base_status` (`inbox.ts:301`). `tidy` removes worktrees whose story is done on base, or held elsewhere with nothing unpushed, and releases their slots. | no |
| 6 | MED | **D2**: hook commands in committed settings use a machine-specific absolute path | `init` and `doctor` flag absolute, foreign hook paths and rewrite them to `"${NORN_BIN:-norn}"`. Rerun on a real second machine. | no |
| 7 | MED | **B3**: agent args swallow the prompt; the cause is hidden | Emit `--` before the prompt (`claude/index.ts:172`). When a run dies within seconds of launch, put the tail of its run log in the classify receipt and the Unblock item. | no |
| 8 | MED | **M2/A16**: an interrupted herdr turn waits the full stalled window | Record the time of each pane-state transition and fill `since`. | no |
| 9 | LOW–MED | **B9**: the implicit ask flaps | Resolve on a hook only when the pane is no longer `waiting_input`, or when a PostToolUse for the prompted command arrives. Stamp hook times as early as possible. | **yes** |
| 10 | LOW | **B11 + D6**: normal races are counted as failed actions | Treat an S6 clash on an `answer by: agent`, and a lost intake CAS, as noop/ok with detail. | B11 **yes** |
| 11 | LOW | **B4**: one nudge text for every route | One text per route (`silent` / `stalled` / `timeout`). | no (new route) |
| 12 | LOW | **B1**: `doctor` runs the global `norn` for the hook check | Set `NORN_BIN` to the shim when firing the hook, and report the resolved binary. | no |
| 13 | LOW | D5, D7, D8, A6, A2, A12/M11 | Do not count a norn crash against the agent's retries. CLI verbs commit their own receipts. Fix the non-holder hints and paths. Hide stuck units from Runs. Close finished panes. | no |

---

## 7. Bottom line

**PR #6 does what its spec set out to do on the paths it tested.**

- The headless nudge works.
- Renewal no longer starves cleanup.
- A crash mid-launch is adopted or classified without duplicates.
- Takeovers are recorded, unpushed work is reported and kept off origin, and the old holder's receipts no longer collide.
- Heartbeat outages are visible.
- Crashed ticks are explained.

The first run's observability blind spots for crashes are largely closed. No duplicate runs and no conflicting receipts reached origin.

**It also ships one HIGH regression.** B2: R8.1's inline PATH makes herdr launches silently do nothing for a user with an ordinary long PATH, and the failure is reported as ok:true, then `died`, then `$stuck`. The other regressions (B9, B11) are LOW.

**Merge PR #6 after fixing B2.** The fix is small: drop the inline PATH, and make a launch with no foreground process ok:false. **Fix B6 in the same pass.** It is a two-line change in `agent-unit.ts`, and it is the main remaining way finished work is lost.

**Auto mode + crash recovery is not ready for a team yet.**

- Single-machine use on the headless runner is close to ready.
- The herdr runner needs B2 and B6.
- Multi-machine use needs:
  - B8 (foreign parked asks);
  - B7 and B10 (views and the record trusting stale local state over the base);
  - portable hook commands (D2);
  - then a rerun on **two real machines**, with default limits and the trust dialog exercised. R7.2, the R9 second stage and adoption by a restarted watch must actually fire there.
