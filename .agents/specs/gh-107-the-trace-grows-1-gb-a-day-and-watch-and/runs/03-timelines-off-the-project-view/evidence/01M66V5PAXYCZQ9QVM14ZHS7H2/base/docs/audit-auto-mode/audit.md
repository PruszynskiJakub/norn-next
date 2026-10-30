# Audit: norn auto-mode and crash-recovery dogfood (2026-10-24)

Independent check of the driver's run log (`run-log.md`) and defect list (`friction.md`, A1–A21) against the raw evidence in this folder and the norn source at `8853983` (`main`). Paths without a prefix are relative to this `auto-run/` folder. Source paths are relative to the norn repo.

Times: trace timestamps are UTC. The driver's run log uses local time (CEST = UTC+2). Where both appear, the UTC time comes first.

How the evidence was read: `traces/A-2026-10-24.jsonl` (412 records) and `traces/B-2026-10-24.jsonl` (381 records) were reduced to every non-noop decision plus every hook fact, then cross-checked against `snaps/*`, `watch-*.log`, `inj*` files, the receipts on disk in checkout B's stale gh-9 worktree, and the gh-9 receipts on `origin/main` of checkout A.

---

## 1. Verdicts

### 1.1 Injections

| # | Injection | Driver verdict | Audit | Notes |
|---|---|---|---|---|
| 1 | SIGKILL of the headless agent (gh-10) | works | **CONFIRMED** | `agent.died.retry` at 09:31:15 (kill at 09:30:53, `inj1-kill1.txt`). The 09:31:00 tick went to `claim.renew`. Second kill at 09:31:43 → `agent.died.stuck` at 09:31:45 with counter `retries 1/1`. Evidence: trace A, `snaps/01-died-retry`, `snaps/02-died-stuck`. |
| 2 | SIGSTOP of the headless agent (gh-11) | partly | **CONFIRMED, and worse than stated** | `agent.stalled.nudge` **ok:false** at 09:41:58 (`headless sessions take no input`), stuck at 09:45:43, process killed (`killed:true`). The driver missed this: between the two windows `status` reported the frozen agent as **`alive`** under Running and `inbox` had 0 items (`snaps/08-stalled-headless`). `why` said `agent.running`. Nothing visible to a person said a nudge was spent and failed. The final Unblock item says `stalled: nudges 1/1`, but no nudge was ever delivered. |
| 3 | Turn ends without a report (herdr) | works when hooks fire; stalled after Esc | **CONFIRMED with corrections** | 3a had no effect: the agent's Stop hook ran at 09:54:35, one second before the Esc. 3b: the last hook was an unmatched `PreToolUse Bash` at 10:00:10. Classified `stalled` at 10:03:12; `silent` never fired (A16). **The cited evidence `snaps/11-silent` was taken at 11:58:49 local, before INJ 3b (12:00:12 local); it shows gh-9 parked at `ready#2`, not the injection.** Only the trace supports 3b. 3c: 4 Stop events at 10:11:46–51, `agent.silent.nudge` at 10:12:13, `agent.silent.stuck` at 10:12:28. Stuck after `silent` leaves the session open by design (`kill` excludes silent/died, `packages/core/src/decide.ts:755`), so the person had to close pane wY by hand. |
| 4a | SIGKILL of watch A on a `started` receipt | missed window, clean recovery | **CONFIRMED** | The killed tick (09:35:15) completed and was traced. `start_run` carries `commit: null` (`decide.ts:654`), so only the commit was outstanding. The first tick after the restart (09:35:58) applied receipt 4 and committed 0002–0004. There were no duplicates. |
| 4b | SIGKILL of watch B between `started` and state (gh-9 review) | hit the window; orphan; duplicate review later | **CONFIRMED + two things missed** | (1) **The crashed tick `01M5PMCWAZ25THXKWJ77BT71YD` has no tick record in the trace.** Its id appears only inside the receipt `0014-started`, so `norn why` cannot explain where that receipt came from. (2) While the heartbeat was down, `status` showed `ready review#1` with the manual hint "cd … && claude-b.sh …" and `inbox` showed `review #1 (queued)`, but an agent was already live in pane wQ (`snaps/07-hb-crash-B-before-restart`). A person following that hint would have started a second agent. Nothing in `status` said that no heartbeat was running. |
| 5 | Watch B killed (stands in for the machine being gone) + `norn take` from A | works | **PARTLY** | The early take was refused correctly (`inj5-take-early.json`, exit 5, `claim_held`). The take after expiry worked (`inj5-take.json`). **But the driver's story of the gh-9 `done` is wrong.** B's agent wrote `0035-done.json` at **10:03:21.8**, about 10 s *before* the watch was killed (10:03:31, `inj5-kill-watchB.txt`), while B's heartbeat was still alive. B's next tick (10:03:27) was a `claim.renew` tick (renewal takes the unit's single action, F13) and was in flight when the watch was killed. That tick is also missing from the trace. A then classified the run, which had in fact finished, as `died` (`0035-classify` on `origin/main`, `agent.died.retry` at 10:05:58), spent the only retry, and re-ran the step. The permanent record now says the run died. Died-detection also worked only because the driver closed B's herdr pane by hand on the same host (see §4). |
| 6 | Hook facts / permission prompt | works; < 1 s | **CONFIRMED; the latency is a coincidence** | 205 hook facts in A and many in B carry `run_id` for runner-started agents. Permission prompt: `PreToolUse` at 09:34:29.849, then the tick that *started* at 09:34:30.485 saw the herdr pane `waiting_input` and parked with the pending command. The Notification hook came 6 s later. Detection is by pane state per tick, so the true bound is one `watch_interval` (15 s here, 30 s by default). The trust-dialog ask took 30 s because the 09:31:15 tick was spent on `recover.commit`. Headless runs were never exposed to a permission prompt (`bypassPermissions`, see §4). |

### 1.2 Defects A1–A21

There is no A19 in `friction.md`; the numbering skips from A18 to A20.

| Id | Claim (short) | Audit | Evidence / cause |
|---|---|---|---|
| A1 | herdr panes run the wrong `norn` | **CONFIRMED** | `herdr-path.txt` and `herdr-path2.txt` resolve to `~/.local/bin/norn`. Launch env is only `NORN_STORY`/`NORN_RUN`/`NORN_SLICE`/slot vars (`packages/core/src/decide.ts:602`; act adds `NORN_HOME`). No absolute norn path is given to the agent. `doctor` resolves binaries with norn's own `PATH` (`packages/cli/src/commands/doctor.ts:59`), not the pane's login shell. |
| A2 | Story claimed by another checkout is invisible; intake repeats | **CONFIRMED** | `a-setup-tick2.json` (`remote.intake`, ok:true). Trace A shows `remote.intake … skipped: … do_instead: norn take gh-9` on every sync tick from 09:28 to 10:05 (~38 times). T10 only promises "Unclaimed" lines, so this is an observability gap rather than a PRD violation. |
| A3 | No way to validate a workflow on its own | **CONFIRMED** | `doctor.ts` has no workflow check. LOW. |
| A4 | Trust dialog: raw-screen question, `answer` not deliverable, prompt lost | **CONFIRMED** | `snaps/03-implicit-ask/inbox.txt`. Trace B tick `…ZJAE9S`: `delivered: "not delivered: herdr agent prompt: agent wP:p1 is blocked…"` inside an **ok:true** decision. Cause: `packages/cli/src/runtime/act.ts:466-480` turns a failed `runner.send` into a detail string, so nothing reaches `inbox` or the failure count. Part (c) is the same environment issue as A11. |
| A5 | `trace --text` folds runs together | **CONFIRMED** | `snaps/02-died-stuck/trace-gh-10.txt`: one `implement#1` row with a list of tick ids and "agent.died" twice. No run ids, no retry counter, no pid. `--events` prints two `started` lines per run without run ids. |
| A6 | Stuck unit still listed under Runs | **CONFIRMED** | `snaps/02`, `snaps/10`, `snaps/16`. LOW. |
| A7 | Permission-prompt inbox items unreadable | **CONFIRMED** | `snaps/04-permission-ask/inbox.txt` is 108 lines. The `status` one-line summary starts with a code line. |
| A8 | Auto step queued on `max_agents` looks manual | **PARTLY** | Only one `agent.queued` decision exists (trace A 09:34:45, about 30 s), and no snapshot of it was captured. The pattern is confirmed elsewhere: `status` shows the manual start hint for any `ready` auto step (`snaps/07…` during the heartbeat outage) and `→ norn brief` for a *check* step (`snaps/12-after-take/status-gh-9.txt`). `inbox` does say "(queued)". |
| A9 | Headless `stalled`/`silent`/`timeout` → nudge always fails | **CONFIRMED (PRD B2 violation)** | `decide.ts:729` treats a session as typable when `session.runner === machine.runner`, which is true for headless. `packages/adapters/src/headless/index.ts:77` then throws `unsupported`. The answer path already resumes headless sessions with `--resume` (`decide.ts`, `applyAction` B2 branch); the nudge path does not. |
| A10 | Orphan run after a heartbeat crash | **CONFIRMED** | Receipts `0014-started` (no session) and `0015-classify` (stalled → nudge, surfaced) are in B's gh-9 worktree. The surface text "agent ended its turn without reporting" is fixed for every nudge route (`packages/core/src/inbox.ts:171`). Its start command would launch a *second* agent next to the live orphan (`snaps/09-orphan-stalled`). norn had the information it needed to find the orphan: a `SessionStart` hook with the orphan's `run_id` (…30R7Q4) at 09:38:18, and herdr's `workspace list` exposes `checkout_path` (`packages/adapters/src/herdr/index.ts:130-134`). |
| A11 | herdr launch prompt not submitted | **PARTLY** (environment) | The driver reproduced it outside norn, so the cause is Claude 2.1.310 in herdr. The norn part is that it does not notice: a `SessionStart` with no `UserPromptSubmit` for minutes is detectable from hook facts. All herdr runs after 11:47 local used the driver's wrapper (`claude-b.sh` v2), so the launch path as shipped was not exercised after that point. |
| A12 | Finished herdr panes never closed | **CONFIRMED + extra** | Every launch created a **new workspace** (session ids wP, wQ, wR, wV, wW, wX, wY, wZ, w0), even though `herdr/index.ts:130` intends to reuse the workspace whose `checkout_path` equals the worktree. Reuse never matched. LOW. |
| A13 | Config read once per `watch` | **CONFIRMED** | `packages/cli/src/runtime/observe.ts:198` uses `ctx.config`, which is cached in `packages/cli/src/context.ts:129-145` for the whole process. |
| A14 | Implicit ask blocks the approved command; duplicate review | **CONFIRMED** | `packages/cli/src/runtime/agent-unit.ts:126-127` refuses every agent report with `parked_ask` while parked on *any* ask, implicit ones included. B's receipts: `0016-ask` (implicit, command = the agent's heredoc), `0017-answer`, then `0018/0019-started` with a new run and workspace wR. That makes two review runs for one step, and the orphan's finished review was thrown away (`b-pane-orphan-end.txt`). |
| A15 | Claim renewal starves the remote lifecycle | **CONFIRMED** | In trace A, PR facts (`story.pr`) exist **only on sync ticks**, and every sync tick from 09:38:13 to 09:52:13 decided `claim.renew` for gh-10 while `pr.state` was `merged`. Cause: `decide.ts:209` emits renew, and `decide.ts:221` runs `storyLifecycle` only if the unit has no action yet. Every one of A's four `remote.pr_merged` cleanups (09:52:44, 09:54:09, 10:09:33, 10:18:07) happened on a *manual* `norn sync`. It is permanent when `sync_interval` is a multiple of `claim.renew`; with the defaults (3m/5m) it costs one sync in three. |
| A16 | herdr `silent` cannot fire from pane state | **CONFIRMED** | `packages/adapters/src/herdr/index.ts:190` always returns `since: null`; `decide.ts:681` requires `(since ?? 0) > touched`. |
| A17 | Takeover invisible in the record | **CONFIRMED** (holder part is single-host) | `packages/cli/src/commands/take.ts:201-211` journals only `--force`. `snaps/12-after-take/trace-gh-9.txt` shows implement#3 with `agent.died` and no take row. The identical `holder` comes from one host, one user. |
| A18 | Returning checkout thinks it still owns the story | **PARTLY** | "`mine`" comes from `packages/view/src/load.ts:223`, which counts `holder == user@machine` as mine, so it is an artifact of one host. On two machines B would show `other`. The rest holds: B shows `running implement#3` and lists the story under Running, and the unpushed `0035-done` collides with A's `0035-classify` on `origin/main`. Nothing warns. |
| A20 | Merged story stays alive on a non-holder checkout | **PARTLY** | `snaps/14-final-B` and `snaps/17-final-B` confirm "Unclaimed — norn take gh-9" for a merged story, and the stale worktree with its unpushed receipt remains. **But B's watch did decide `story.finished` for gh-9 from 10:10:50 to 10:17:29, and only by accident** (see N1). The `tidy --dry-run` claim has no captured output. |
| A21 | Intake-race loser later claims the merged story | **CONFIRMED + deeper cause** | Trace A: `claim.acquire.intake` ok:false at 10:10:58, then ok:true at 10:17:43 (after B's GR6 deleted the claim ref). `decide.ts:195` (`fresh` bypasses `storyFinished`), plus the snapshot preferring A's stale local spec (`status: new`) over the base record that says `done` (`packages/store/src/snapshot.ts:196-198`). The release on exit then tried to push A's stale branch (`watch-A.log`, last line). |

### 1.3 Findings the driver missed

- **N1 — Cross-story shadowing in the snapshot (MED).** `loadSnapshot` scans every story worktree for **all** spec folders, and the first root wins (`packages/store/src/snapshot.ts:169-175, 196-198`). B's gh-15 worktree was cut from `origin/main` after gh-9 merged, so it held gh-9's record as `done`. It sorts before the gh-9 worktree, so from 10:10:50 B's watch read gh-9 from **gh-15's worktree** and decided `story.finished`. When gh-15's worktree was removed (10:17:29), gh-9 flipped back to `active`/`claim.unclaimed` (tick `…J936R9`). Verified in trace B: gh-9 `frontmatter.status` is `active` → `done` → `active` while its own worktree is unchanged. The same mechanism is part of A21.
- **N2 — A crashed tick leaves no trace record (MED).** Ticks are written after act. Neither `…CWAZ25…` (INJ 4b) nor B's 10:03:27 tick (INJ 5) is in the trace, and receipts cite tick ids that `why` cannot resolve.
- **N3 — No heartbeat liveness in `status`/`inbox` (MED).** `status.json` has no last-tick time (keys: at, errors, holder, inbox, recently_done, repo, runner, runs, stories). During both watch outages the views looked normal, and in 4b they were wrong.
- **N4 — A finished run recorded as `died` (HIGH, part of H5).** See injection 5.
- **N5 — Cross-machine pid liveness (MED, untested risk).** `packages/cli/src/runtime/observe.ts:581` checks `run.process` against the *local* process table whatever machine started it. After a real cross-machine take, a run that is still alive on the old machine would read as `died`. A then starts a second agent while the first keeps writing to a worktree nobody pushes. A herdr session without a recorded pid (`wW:p1` at 09:55:42 had none) reads as never dead on a machine without herdr, and would wait for the stalled windows.
- **N6 — `recover.commit` after every launch (LOW).** `start_run` never commits (`decide.ts:654`), so every launch costs one extra tick and is labelled "recovered commit". The `started` receipts reach origin one tick late.
- **N7 — Retries can be spent by takeover (MED).** Same root as N4: A's retry budget for implement#3 was used up by B's finished run.

---

## 2. Observability scorecard

The question for each event: could a person who had only `status`, `inbox`, `trace`, `why` and receipts tell **what** happened, **when**, **why**, and **what to do**? Y = clear, P = partial or misleading, N = absent.

| Event | What | When | Why | Do | Missing |
|---|---|---|---|---|---|
| Agent SIGKILL → retry → stuck (1) | Y | Y | P | Y | Trace row folds both runs (A5). "Running implement #1" does not say it is a retry. No pid or run id in text views. |
| Agent hang (SIGSTOP) → failed nudge → stuck (2) | P | P | N | P | Between windows `status` says **alive**, `inbox` is empty, and `why` says `agent.running`. The ok:false nudge appears only in raw trace JSON and the watch line `failed:1`. The stuck reason claims a nudge that never happened. |
| Interrupted turn (herdr, 3b) | P | Y | P | Y | Classified `stalled` ("no activity for 3m") instead of `silent`. The nudge is visible only as a trace event. |
| Silent agent (3c) | Y | Y | Y | P | Good: `silent: nudges 1/1`, C4 transcript snapshot. Missing: that the session is still open and must be closed by hand. |
| Watch killed between ticks (4a) | N | N | N | Y | Nothing records the outage. Recovery was clean, so nothing was needed. |
| Watch killed mid-launch → orphan (4b) | N | N | N | N | Crashed tick missing (N2). During the outage the views showed `ready` + manual hint + "(queued)" while an agent was live. Afterwards they showed "agent ended its turn without reporting" plus a command that starts a second agent. |
| Machine gone + take (5) | P | P | N | P | `take` is not in the trace (A17). The trace records `died` for a run that finished (N4). Nothing shows that the old checkout had unpushed work. |
| Returning checkout B | N | N | N | N | Shows `mine · running` (single host) or `other`. No item for unpushed local receipts or the stale worktree. Offers `norn take` for a merged story. |
| Permission prompt / trust dialog (6) | Y | Y | P | N | The question is a raw screen dump (A7). The suggested `norn answer` cannot answer a blocked pane (A4). Nothing tells the person to answer *before* pressing Enter (A14). |
| Answer not delivered (A4) | N | N | N | N | ok:true with the failure buried in `detail.delivered`. The unit silently re-parks. |
| PR merged, no cleanup (A15) | N | N | N | N | `story.wait_merge` / Merge item stays. Nothing says that renewal pre-empted the lifecycle. |
| Intake-race loser (A21) | P | Y | N | N | `claim.acquire.intake ok:false {reason: held}` in the trace only. Later it silently owns a merged story. The release failure shows only in the watch exit JSON. |

Overall, norn's own outputs explain the clean paths (died, silent, asks) well. Crash-adjacent paths are where they fail: heartbeat outage, orphan, takeover, returning checkout. For those a person needed the driver's notes or the raw JSON.

---

## 3. Detection latency

UTC from the injection files and trace. `watch_interval` 15 s, `stalled` 3m, `claim.lease` 3m, `renew` 1m, `sync_interval` 1m. The last column scales to defaults (30 s / 15m / 10m / 3m / 5m, nudges 2).

| Event | Injected | First norn reaction | Latency | Outcome reached | With defaults (estimate) |
|---|---|---|---|---|---|
| 1a SIGKILL agent | 09:30:53 | 09:31:15 `agent.died.retry` | 22 s (one tick lost to `claim.renew`) | retry | ≤ 60 s |
| 1b SIGKILL retry | 09:31:43 | 09:31:45 `agent.died.stuck` | 2 s | `$stuck` | ≤ 30 s |
| 2 SIGSTOP agent | 09:38:52 | 09:41:58 `agent.stalled.nudge` (failed) | 3m06s | `$stuck` + kill 09:45:43 (6m51s) | ~45 min to `$stuck` (15m × 3) |
| 3a Esc (too late) | 09:54:36 | — | — | agent had reported at 09:54:35 | — |
| 3b Esc, no Stop hook | 10:00:12 | 10:03:12 `agent.stalled.nudge` | 3m00s (should be one tick via `silent`) | resumed same session | ~15 min |
| 3c silent refusal | 10:11:45 | Stop hook blocked ×3 (10:11:46–50); 10:12:13 `agent.silent.nudge` | 28 s (22 s after last Stop) | `$stuck` 10:12:28 (43 s) | ~1–2 min |
| 4a SIGKILL watch A | 09:35:18.4 | restart (manual) 09:35:58 → recovered in first tick | 0 s after restart | consistent | same |
| 4b SIGKILL watch B mid-launch | 09:38:16.0 | restart 09:39:26 → `receipts.apply` 09:39:42; `agent.stalled.surface` 09:42:42 | 16 s to apply; 4m26s to any signal; orphan **never identified** | duplicate run at 09:46:42 | ~15 min to first signal |
| 5 watch B killed | 10:03:31 | claim expired 10:05:27; take refused 10:03:36; take 10:05:39 (manual); `agent.died.retry` on A 10:05:58 | 1m56s to expiry; 2 s after pane closed | resumed on A; `done` of B lost | 10 min lease |
| 6 permission prompt | 09:34:29.8 | 09:34:30.5 `agent.ask.implicit` | 0.6 s (phase luck; bound = 1 tick) | parked | ≤ 30 s |
| 6 trust dialog | launch 09:31:00 | 09:31:30 `agent.ask.implicit` | 30 s (one tick spent on `recover.commit`) | parked | ≤ 60 s |
| PR #12 merged (A15) | 09:37:49 | 09:52:44 `remote.pr_merged` (manual sync) | never automatic | cleanup | ~5–15 min, never if `sync_interval` is a multiple of `renew` |
| B returns after takeover | watch up 10:06:56 | `claim.other` same tick | 0 s in decide; views stale indefinitely | — | — |

---

## 4. Process notes (limits on what this run proves)

1. **Both checkouts on one host, one user, one `~/.norn`.**
   - `holder` is identical, which produces A17's holder part and A18's "mine".
   - Agent leases were shared, so `max_agents` 2 was enforced *across* checkouts, and each checkout reclaimed the other's dead leases (B reclaimed A's `agent-1.json` at 09:31:00). That would not happen on two machines.
   - pid liveness after the take worked only because the driver **closed B's herdr workspace by hand** at 10:05:56. On two machines the check runs against the wrong process table (N5). Cross-machine takeover is still unproven.
2. **"Machine gone" was simulated by killing only `norn watch`.** B's agent kept running and wrote `done` 10 s before the kill. A real machine loss (or a watch crash with the agent left alive) gives different results, and both remain untested.
3. **Headless agents ran with `--permission-mode bypassPermissions`** (`config-A.yaml`). This has four implications:
   - (a) Every A-side run had unrestricted shell and file access with no prompt, so the smooth A runs say nothing about headless behaviour under a safe permission set.
   - (b) The permission-prompt → implicit-ask path (injection 6) was tested **only on herdr**. With `claude -p` and a restrictive mode, a denied tool does not park the unit; the run would probably end without a report or work around the denial, and that path is unexercised.
   - (c) norn itself has no guard against destructive agent commands (force-push, deleting `runs/`). Bypass mode removes the agent-side guard too, which is not a configuration to recommend to a team.
   - (d) Hooks still fired (205 hook facts), so hook-fact coverage *is* proven for headless.
4. **B's permissions were changed mid-run.** B started on `acceptEdits` with a narrow `--allowedTools` (`config-B.initial.yaml`) and was widened to plain `Bash` at 11:36:51 local (`config-B.yaml`). Because of A13 the change took effect only at the 11:39 restart. Prompt frequency before and after is not comparable.
5. **Driver workarounds hid defects.** `claude-b.sh` re-exported `PATH` (A1) and, from 11:47 local, stripped the prompt and submitted it with `herdr agent prompt` after 8 s (A11). Every herdr run from 11:53 local on used this, so norn's shipped herdr launch path was effectively tested only for the first three launches.
6. **A person did things inside the panes:** answered trust and permission dialogs with keys, pressed Esc, typed the start prompt into the orphan pane and into wR, closed workspaces. In several places recovery happened because a person acted, not because norn did.
7. **Stories were merged by hand.** The driver merged PRs #12–#16 (expected, GR5). PRs #13 and #14 also had conflicts in `test/web.test.ts` that the driver resolved in the worktrees outside norn (F8). The final code of gh-11 and gh-9 is partly not norn-produced.
8. **`norn sync` was run by hand four times**, so A15 never showed its full effect. Without those syncs gh-10, gh-11, gh-9 and gh-15 would have stayed un-cleaned.
9. **Loops were driven synthetically.** `approve --reject` was used to get more agent runs (gh-11 `ready_loop 1/2`, gh-9 `ready_loop 2/2`). gh-9's last ready had no reject left.
10. **Limits were shortened** (stalled 3m, lease 3m, renew 1m, sync 1m vs defaults 15m/10m/3m/5m). Latencies in §3 scale up. The A15 starvation is partly an artifact of renew == sync, but a team can easily pick such values.
11. **Single injections and one hit.** INJ 4 hit the receipt→state window once, on herdr only. The headless launch window (a few ms) was never hit. Nothing was repeated, so nothing is known about flakiness.
12. **Evidence gaps:**
    - `snaps/11-silent` predates INJ 3b.
    - No snapshot of the A8 queued state.
    - No `tidy --dry-run` output.
    - The sandbox config edits were not committed (A's original was restored at the end; B keeps its edit).
    - A global norn 0.11.0 sits on the host's `PATH`.
    - Agents used `sonnet`.

---

## 5. Ranked backlog

Severity: **HIGH** = wrong or unsafe behaviour, or silent loss. **MED** = needs a person's workaround. **LOW** = readability. "Spec" = covered by `.agents/SPEC-base-sync-and-qa.md` (branch `spec-base-sync-qa`).

| # | Sev | Item (ids) | Fix direction | Spec |
|---|---|---|---|---|
| H1 | HIGH | Headless nudge always fails; the nudge budget is spent for nothing; the frozen agent shows as `alive` (A9, injection 2) | For headless, route `nudge` like answers do: resume with `--resume <agent_session_id>` and `NUDGE_TEXT` (PRD B2). Never decide `nudge` for a runner whose `send` is unsupported. Surface a failed act as an inbox item. | no |
| H2 | HIGH | Watch crash between `started` and launch record leaves an orphan agent norn cannot see; the later answer launches a duplicate run (A10, A14b, N2) | Before launching, persist the launch intent; or adopt orphans on restart by `run_id` from hook facts (agent session id, cwd) and herdr `workspace list` by `checkout_path`/label. Never start a new run for a step while a `started`-without-session run has hook activity. Write a tick-start trace record. | no |
| H3 | HIGH | Permission and trust prompts: `norn answer` cannot reach a blocked herdr pane and reports ok:true; the approved command is then refused with `parked_ask` (A4, A14) | Treat an implicit ask as resolved when the pane leaves `waiting_input` or a later hook arrives. Accept agent reports while parked on an *implicit* ask (the report is the answer). For blocked panes send keys or the choice, and turn delivery failure into `ok:false` plus an inbox item. | no |
| H4 | HIGH | Claim renewal starves GR6/GR7 whenever renew and sync coincide, permanently for aligned intervals (A15, F13) | Do not count `claim.renew` as the unit's one action, or run `storyLifecycle` before renew, or keep the last PR/issue facts between syncs. | no |
| H5 | HIGH | Takeover loses the old holder's last receipts: B's `done` was never applied (renew-starved, then killed), A recorded the run as `died` and spent the retry, and B's unpushed receipt collides on number `0035` (injection 5, N4, N7, A18) | Apply receipts before renew (same fix as H4). Push agent receipts promptly (`norn done` commits and pushes, or the heartbeat applies within the same tick). On a checkout without the claim, detect unpushed `runs/` changes and report "local work not in the record", never reusing receipt numbers. | no |
| H6 | HIGH | Intake-race loser later claims a merged story; release on exit pushes a stale branch and leaves a claim ref on origin (A21) | On CAS loss, drop or mark the local intake. Before any `claim.acquire`, consult the base record (`done` wins). Release only pushes branches this heartbeat committed to. | no |
| M1 | MED | Snapshot shadowing: one story's worktree supplies another story's record (N1) | Scan each story worktree only for the story named in its `.norn-unit` marker; other stories come from the base ref. | no |
| M2 | MED | herdr `silent` never fires from pane state; interrupted turns wait for the full stalled window (A16) | Record pane-state transition time across ticks (or from herdr) and fill `since`. | no |
| M3 | MED | No heartbeat liveness in views; a dead watch looks normal (N3, injection 4) | `status`/`inbox` show the last tick time per checkout and a "no heartbeat for Xm" item. | no |
| M4 | MED | Cross-machine liveness: foreign pid checked locally (N5) | When the session's machine differs from this one (record the holder/heartbeat in the `started` receipt), classify by claim expiry and hooks, not pid. | no |
| M5 | MED | Wrong `norn` in herdr panes (A1) | Pass an absolute `NORN_BIN` in the launch env and use it in hooks and the skill. `doctor` checks `command -v norn` inside a runner pane. | no |
| M6 | MED | Launch prompt not submitted goes unnoticed (A11) | Flag `SessionStart` with no `turn_start` within N s and re-send the prompt once, else surface it. | no |
| M7 | MED | Returning or non-holder checkout keeps stale state and offers `take` for merged stories (A18, A20) | Apply the GR6 local cleanup from the base record without a claim. `tidy` reports stale worktrees, panes and unpushed receipts. | no |
| M8 | MED | Takeover not recorded (A17) | Write a `take` receipt or trace event for every take, forced or not, with the previous holder and heartbeat. | no |
| M9 | MED | Config read once per watch (A13) | Reload when the config file's mtime changes, or log a warning. | no |
| M10 | MED | Story branches go stale; conflicts resolved by hand (PR #13, #14) | Base sync `update` step, `stale` re-entry, `norn update`. | **yes (BS1–BS10)** |
| M11 | MED | Silent → `$stuck` leaves the session open; finished panes and workspaces pile up; workspace reuse never matches (A12, injection 3c) | Close panes at step end or stuck (keep the transcript snapshot). Fix the `checkout_path` match. | no |
| L1 | LOW | Permission or trust inbox is a raw screen dump (A7, A4a) | Extract the question block and the first line of the command; full text behind `--details`. | no |
| L2 | LOW | Trace folds runs; no run id, retry counter or pid (A5) | One row per run. | no |
| L3 | LOW | Manual hint shown for queued, outage or check steps (A8) | Say "queued: max_agents", "waiting for heartbeat", "norn runs this check". | no |
| L4 | LOW | Repeated `remote.intake` skip for a story held elsewhere; such stories invisible (A2) | Make the skip a noop and show "held by X (other checkout)" in status. | no |
| L5 | LOW | `recover.commit` after every launch (N6) | Commit `started` receipts in the launch tick. | no |
| L6 | LOW | Stuck runs listed under Runs (A6); no standalone workflow validation (A3) | Hide non-running runs; `norn workflow --check <file>` or a `doctor` check. | no |

Only M10 is covered by the open spec. None of the auto-mode or crash-recovery items are.

---

## 6. Bottom line

**Auto mode and crash recovery are not ready for a team.**

What works:
- The happy path in auto mode works on both runners.
- `died` → retry → `$stuck` works.
- Hook facts reach norn.
- `silent` with hooks works.
- Claim CAS and the refusal of an early `take` work.
- Recovery from a heartbeat crash *between* ticks is clean and idempotent.

What fails:
- Hangs on the headless runner: the nudge is a no-op.
- A crash in the receipt → launch window leaves an orphan and later a duplicate run.
- Permission prompts need hand-typing plus a specific order of `answer` and Enter.
- Takeover silently loses the previous holder's last report and records a finished run as `died`.
- Renewal can starve merge cleanup forever.

The views do not show a dead heartbeat, an orphan or a takeover, so a teammate would not notice any of this. The run was on one host with bypassed permissions and with driver workarounds, so cross-machine takeover and safe-permission headless runs are still unproven.

**Fix first:**
1. H4/H5: take renewal out of the one-action budget and apply or push receipts promptly. This is small and removes two HIGHs.
2. H1: headless nudge via `--resume`.
3. H2: orphan adoption and a crash-safe launch record, plus a trace record for crashed ticks.
4. H3: implicit-ask resolution for permission prompts.
5. M3: heartbeat liveness in `status`.

Then repeat injections 2, 4b and 5 on **two machines**, with a non-bypass permission set on headless, without the `claude-b.sh` wrapper and without manual `norn sync`.
