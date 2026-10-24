# Friction / new defects — auto-mode rerun (B-ids)

Severity: HIGH = loses or duplicates work or blocks auto mode; MED = wrong/misleading view or needs a person who knows internals; LOW = cosmetic.

## B1 — `doctor` hook check runs whatever `norn` is on the caller's PATH (LOW)
`hook_fires` runs the default hook command `"${NORN_BIN:-norn}" hook …`. From a plain shell NORN_BIN is unset, so it ran the global `~/.local/bin/norn` 0.11.0, which failed with the misleading "Not inside a git repository's checkout: /private/var/…/repo". With `NORN_BIN=~/.norn/bin/norn` doctor is ok. Doctor should test the hook with this norn (it already writes the shim), or say which binary ran.
Evidence: doctor-A.json (ok:false), doctor-B.json; rerun with NORN_BIN → ok:true (run-log 13:53).

## B2 — R8.1 makes herdr launches fail: the inline `env PATH=…` command is truncated in a fresh pane (HIGH)
R8.1 wraps the agent command as `env 'PATH=<shim>:<whole PATH>' NORN_BIN=… claude …`. With this user's PATH (1 773 bytes) the command is > 1 024 bytes. The herdr runner creates a workspace and immediately does `herdr pane run`; the text arrives while zsh is still reading its rc files, i.e. as type-ahead in canonical tty mode, which macOS truncates at MAX_CANON (1 024). The truncated line (open quote) never runs. Seen twice:
- `norn doctor` R8.2 check: "no answer from the herdr session within 15s" (doctor-B.json, doctor-B-2.json; pane w12 showed the cut command).
- the real gh-19 launch and its retry (13:00:15 / 14:00:30): pane w15 shows the cut `env 'PATH=…/Users` line; norn recorded `agent.start` ok:true, then `agent.died` "process gone, no receipt" twice → `$stuck` (retries spent) with no hint of the cause (snaps/03-B2-launch-truncated).
The same command typed into a pane whose shell is ready runs fine (r8-manual.txt). Workaround (outside the source, logged): B's watch started with a short PATH (~110 bytes) → launches work from 14:05. Fix ideas: pass PATH/NORN_BIN through `--env` only and put a short `PATH="$shimdir:$PATH"` prefix in the command (shell expands it), or wait for the pane's shell prompt before `pane run`, and treat "no foreground process after launch" as a launch failure (R4.3) instead of ok:true.

## B3 — a variadic flag in `agents.<name>.args` silently swallows the launch prompt (MED)
The claude adapter appends `config.args` and then the prompt with no `--` separator. `--allowedTools` is variadic in Claude Code, so with `args: [--permission-mode, acceptEdits, --allowedTools, "…"]` the prompt became one more tool name. Headless: `claude -p` exits at once ("Input must be provided either through stdin or as a prompt argument when using --print", trace/runs/01M5PWGZ1F….log). norn: `agent.start` ok:true → `agent.died.retry` → `agent.died.stuck` within 30 s for gh-17 and gh-18; the Unblock item says "died: retries 1/1" and never points at the run log that holds the reason (snaps/00-died-bad-args). Workaround: put a single-value flag last (`--allowedTools …, --permission-mode, acceptEdits`). Fix ideas: emit `--` before the prompt, and surface the last lines of the run log when a headless run dies within seconds of launch.

## B4 — the nudge text is the `silent` text for every route (LOW)
A `stalled` nudge delivered by resume reads "You ended your turn without reporting. Finish the step and report exactly once…" (gh-18 12:11:56 turn_start). The run was frozen, not finished. Same wording issue as A10's inbox text, now in the agent's prompt. `status` also kept the classification on the resumed process ("alive since 12:11:54 — stalled since 12:11:50") until it reported.
Evidence: snaps/05-stalled-nudge-resume/trace-events-gh-18.txt lines 183–188.

## B5 — intake leftovers on a checkout that never got to try the claim (LOW)
B took gh-23 in (`remote.intake`, worktree + local branch) in the same minute as A; A's claim landed first, so B never ran `claim.acquire.intake` and R3.1's cleanup (which is tied to a lost CAS) never ran. B keeps `…-b-worktrees/gh-23-version-in-page-footer` with only the intake commit, and `norn tidy --dry-run` lists nothing. Views are right ("held by …MacBook-Pro-Jakub-2").
Evidence: `git -C B worktree list`, `nB tidy --dry-run` at 14:18 (run-log).

## B6 — H3 still open: the agent's report is refused while the person's answer waits to be applied (HIGH)
R6.1 accepts agent reports while parked on an implicit ask, but `implicitAskOpen` (packages/cli/src/runtime/agent-unit.ts:141) returns null as soon as an *answer* receipt is waiting to be applied, and `refuseUnlessAgentWork` (line 129) then refuses with `parked_ask`. That is exactly the common case: the prompt is about the agent's own `… && norn done …` command, the person answers via `norn answer` as the inbox says, the keys arrive, the command runs within 2 s — before the next tick applies the answer. gh-19 review: answer 12:20:43, `norn done approve` 12:20:45 → exit 3 `parked_ask`; the agent ended its turn, `silent` → `$stuck` (nudge budget already used); the finished review was thrown away. Same outcome as A14 in the first run, now via the person's own norn answer. Fix: an implicit ask with a pending answer should not block reports either (treat as resolved); only an explicit `norn ask` parks reports.
Evidence: h3-transcript-excerpt.jsonl (tool_result "Exit code 3 … parked_ask"), snaps/08-H3-report-refused, B trace 12:20:43–12:21:04.

## B7 — approve then merge within one tick: the approve lands on the merged branch, main's record stays "waiting at ready" (MED)
`norn approve gh-18` at 12:17:51, PR merged by the person at 12:17:59. A's next tick (12:18:05) applied the approve and pushed `ready.approve → $done` to the story branch after it was merged; the cleanup tick (12:18:20) wrote `status: done` into story.md on main but main's state.json is still `parked ready#2`. Every checkout now shows "unclaimed · parked ready#2 → norn approve gh-18" for a merged story, and B's inbox has an Approve item for it. GR6 cleanup should take the unit to `$done` in the base record (or apply pending receipts first), and the views should trust story.md `status: done`.
Evidence: run-log 14:17:51; `git log origin/gh-18-…` (e3c98ba after merge commit f9a90b1); `git show origin/main:…/gh-18-…/runs/_story/state.json`; snaps/08-H3-report-refused/inbox.txt (B, Approve gh-18).

## B8 — after a take, a foreign run parked on an implicit ask is never judged (MED)
INJ 5: B's review run was parked on an implicit pane ask when B died (its agent had in fact answered and reported `done`, unapplied). After `norn take` on A, R7.2 should judge the foreign run by hooks/claim and classify it `died` after the stalled window. A instead decided `unit.parked.ask` (noop) every tick for 4+ minutes and offered an Answer item ("A variable in this command can't be checked … options 1/2/3") for a pane on a machine that is gone. Only `norn answer gh-19 "1"` moved it: applied, then a fresh run on A. A person following the inbox gets there, but the question is meaningless to them and nothing says the run belongs to the old holder's machine.
Evidence: snaps/11-take-parked-foreign-ask (why: rule `unit.parked.ask`), watch-A.log 12:27–12:31.

## B9 — implicit ask flaps when the agent has parallel tool calls (LOW)
gh-28 12:41:53 `agent.ask.implicit` (pane blocked on "Contains brace with quote character"), 12:42:08 `agent.ask.implicit.resolved` "the agent moved on: hook PreToolUse at 12:41:53.512Z" — that PreToolUse was a sibling parallel tool call, the prompt was still on screen — 12:42:23 parked again on the same prompt. Each flap writes an ask + answer receipt and a commit ("review moved on (hook PreToolUse …)", "waits for input"; also seen on gh-19 12:22:49–12:23:19). R6.1 should only count hook events newer than the prompt *and* a pane that is no longer `blocked`.
Evidence: snaps/14-R9-resend and `nB trace gh-28 --events --text` 12:41:53–12:42:23.

## B10 — a merged story stays alive on a checkout that once worked on it (MED; A20 not fixed)
After gh-19 merged (story.md on main: `status: done`), B — which held it before the take, and kept a worktree with its orphaned/ commit — shows in `inbox` "Unclaimed — Stats endpoint … → `norn take gh-19`" and in `status` "unclaimed · parked review#2 (ask: …)". gh-23 (B lost the intake, A merged it) shows "manual · unclaimed · not started". B's own stale worktree wins over the base record (R3.4 allows own worktree or base ref, but the base says done). R3.2 holds — B never tried to claim them — but a person following B's inbox would `take` a finished story. Same for gh-18 everywhere via B7.
Evidence: snaps/16-B-after-merges/inbox.txt, status-gh-19.txt, status-gh-23.txt.
Also on A: gh-28 (A intook and claimed it, released it to B, B merged it) shows "Unclaimed — Favicon link in page head → `norn take gh-28`" in A's final inbox, with A's stale worktree and slot lease 6 left (snaps/18-final-A/inbox.txt).

## B11 — tick and agent both resolve the same implicit ask → receipt number clash (LOW)
gh-31 13:03:38: the tick's `agent.ask.implicit.resolved` failed with "receipt number 13 is taken by …/0013-answer.json (S6)" — the agent's `norn done` had just written its own `answer by: agent` for the same ask. S6 refused the duplicate correctly, but the watch reports a failed action (`failed_actions: 1`) for a normal flow.
Evidence: watch-B.log 13:03:38.

## Ranking
1. B2 (HIGH) — herdr launches silently do nothing with a normal-length PATH; norn reports ok and burns the retry.
2. B6 (HIGH) — H3 still loses finished work when the person answers through `norn answer`.
3. B8 (MED) — taken story waits on a dead machine's pane prompt.
4. B7 (MED) — approve-then-merge race leaves the record at the gate.
5. B10 (MED) — merged stories offered for `take` on non-holder checkouts (A20).
6. B3 (MED) — prompt swallowed by agent args; cause hidden in the run log.
7. B9, B11, B4, B5, B1 (LOW).
