# Friction and defects — sync-qa run 3 (impl-base-sync-qa @ 67219c9)

No HIGH defect found. D3 and D5 from run-2 did not reproduce (scenarios 1–3), D4 is fixed (scenario 4), D1 is fixed (0 `stale:*` items vs 17), D6 did not reproduce. Evidence paths relative to this directory.

## F1 — An implicit ask is marked "the agent moved on" by a PreToolUse hook while the prompt is still on screen; the Answer item disappears for one tick and comes back (MED-LOW)

Seen twice on B gh-52, both mid-merge in resolve:
- resolve#2: ask at 09:23:27Z, `agent.ask.implicit.resolved` at 09:23:42Z with answer receipt "the agent moved on: hook PreToolUse at 2026-10-25T09:23:28.852Z", Claude's `permission_prompt` notification at 09:23:35Z (the prompt was still up), ask re-raised at 09:23:57Z.
- resolve#3: ask at 09:34:27Z, resolved 09:34:42Z "hook PreToolUse at 09:34:32.170Z", `permission_prompt` 09:34:41Z, re-raised 09:34:57Z.

(s1-r3-trace.txt, s1-r3-watch-decisions.txt, inbox-history-B.json.) The PreToolUse comes from another tool call of the same turn (Claude issues several Bash calls at once; the second one's PreToolUse fires while the first one's prompt waits). Effect: the Answer item vanishes for ~15 s and a second item (new id, new receipt pair) appears, so a notifier fires twice and a person who runs `norn answer` in the gap is refused. Recovery is automatic, nothing is lost. Repro: herdr runner, allowlist that forces a prompt, an agent that sends two Bash calls in one message. Fix direction: do not treat a PreToolUse as "moved on" while the pane fact still says `waiting_input`/blocked, or only when the hook is newer than the pane's last waiting observation.

## F2 — After `norn answer`, the inbox keeps showing the answered question until the next tick (LOW)

At 10:35:14 I answered gh-52 (accepted, typed); `norn inbox` and `norn status` still showed "parked resolve#3 (ask: …)" with the old pending command at 10:35:35 (36 s old). Same at 10:38:28 → 10:38:52 (s1-r3-second-prompt-poll.txt and run-log). The answer receipt exists in runs/ the moment the CLI returns; the read model could show the unit as answered until the tick applies it. Cosmetic, but it made it hard to tell "my answer did not land" from "the agent hit the next prompt".

## F3 — Agents commit QA evidence and a repo-root handoff.md into the product tree (LOW)

PR #58 (gh-51) merged `qa-evidence/AC1.md`, `qa-evidence/AC3.md`, `qa-evidence/criteria.json` into main (and gh-53 added `qa-evidence/gh-53/`), next to the proper `.agents/specs/…/runs/_story/evidence/`; it also changed the repo-root `handoff.md` (a leftover from earlier runs), which then conflicted in later resolves (handoff.md is in gh-53 update#7's conflict list). Skill hygiene (qa/implement), not a base-sync rule; known in spirit from run-2 (D5's handoff.md).

## Carried over from run-2, still reproducible (D7 items)

- Non-holder checkouts create intake commits, worktrees and slot leases for stories held elsewhere (A2); `norn tidy` reports nothing to remove. Removed by hand again: gh-51 worktrees/branches on B and C, ~/.norn/leases slot-3/slot-6 (leftovers/).
- herdr: one workspace per run instead of a tab in the worktree's workspace — 15 workspaces for gh-52; one `agent.start` "command never started in herdr pane w2J:p1 within 10s", relaunched next tick.
- `appeared_at` of the head-changed item is the approval time, so it shows "1m" at first sight (s4-head-changed-item.txt).
- D2 (agent `git add -A` sweeping norn's deferred runs/ files into its merge commit) did not occur in this run's merges (b44bbea, 849aee1, e6b0fbd touch only product files) — not fixed, just not hit.

## Not norn defects, but they affected the run

- Host idle sleep (battery) twice paused all watches for 8 and 5 min; claims expired and were reacquired cleanly. Long dogfood runs need `caffeinate`.
- Someone answered several prompts directly in B's herdr panes and typed `norn trace gh-52` into an agent's input box; norn recorded those as "the agent moved on" correctly, but it cost me the live check of `norn answer` on a second mid-merge prompt.
- norn source was edited in the working tree at 10:45 and committed as 4e51ddb during the run; the watches kept running 67219c9.
- B's untracked `.claude/settings.local.json` from run-2 allowed `python3 -` and `sed *`, which silently defeated the tightened allowlist on resolve#1. Sandbox hygiene: check settings.local.json before relying on an allowlist.
