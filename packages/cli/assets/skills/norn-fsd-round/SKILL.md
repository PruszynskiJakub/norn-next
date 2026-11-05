---
name: norn-fsd-round
description: Supervise the stories a person names through their current norn round, unattended — one supervisor in the main checkout, one foreground subagent per story, norn's own commands only; decides gates and answers on the person's behalf as delegated decisions with reasons, escalates only what the person keeps, and ends with one report. Use when a person asks to supervise, deliver or babysit named norn stories to the end of their round. Never a workflow step.
---

# Supervise named stories through their round

You supervise the stories the person named, in this checkout, until each one's current round ends. norn decides every next step; you decide only what the person delegated to you (SK3), always through norn's commands, always with a reason.

## Before you start

- **Main checkout only.** If the working directory or a parent holds a `.norn-unit` file, stop: "norn-fsd-round runs in the main checkout, never in a unit worktree." norn refuses `--delegated` there too.
- **One supervisor per checkout.** If another supervisor runs here, stop and tell the person to add the stories to it. Never restart or replace a watch another session relies on (two claims were lost that way).
- **Named stories only.** Supervise exactly the stories the request names; leave every other story in `norn status --json` alone. A `release` story only when the request names it (never run `/release-start`).
- **The watch.** Read `norn status --json`. A stale or missing heartbeat shows as an item in `groups.unblock` whose `id` starts with `heartbeat:`; when one is there → one escalation: "No watch is running. Start it in its own terminal: `! norn watch`", then wait for the heartbeat. Never start one yourself; never run `norn watch` or `norn tick`. A heartbeat that goes stale later gets the same escalation, naming the stories that stopped moving.

## Shape

- You, the top-level supervisor, are the only one who talks to the person. Name the story in every message ("gh-201: …"); pass escalations on one at a time.
- Start **one subagent per story**, with the brief below. Each loops in the **foreground** on `norn story wait <story> --until gate --timeout 5m` and returns to you only to escalate or to report. `--until` takes one condition, so the timeout bounds how long an ask, a stuck unit or the round's end waits to be seen. No background polling, no timers that expire.
- Read norn's JSON, never its text: `norn story view <story> --json`, `norn run view <unit> --json`, `norn run list <unit> --json`, `norn status --json`. Branch on fields; never grep markdown, and never pass a story to `norn status` (it takes none).

## Subagent brief (give it verbatim, with the story filled in)

> Supervise <story> to the end of its current round, from the main checkout, with norn's commands only.
> 1. Run `norn story edit <story> --auto` once. Never run `norn brief`, `norn story start`, `norn tick` or `norn watch`; never type into a step pane.
> 2. Loop: `norn story wait <story> --until gate --timeout 5m` in the foreground (exit 0: a gate waits; exit 7: five minutes passed), then read `norn story view <story> --json` either way and act on what waits (a gate, an ask, a stuck unit or the round's end) by the rules of the `norn-fsd-round` skill: load it first. Every decision you send carries `--delegated --reason "fsd: <evidence>"`.
> 3. Return to the supervisor only with an escalation (one message, everything needed to answer) or with the report when the round ends.

## What you decide (delegated, always with `--delegated --reason`)

- **Asks** the spec, the repo or the issue settle: `norn story answer <unit> "<answer>" --delegated --reason "fsd: spec B4 says …"`. A permission prompt the step plainly needs: its option number.
- **Gates**: read what the gate judges (slice files against the spec's Behaviour items, the plan, the diff, the PR) and run `norn story approve <unit> --delegated --reason "…"` or `norn story reject <unit> --delegated --reason "…"`. The reason names the evidence: Behaviour items, the CI run, the merge danger.
- **Before any gate, read the PR's state** (`gh pr view <branch> --json state,headRefOid`). A PR the person merged → wait for the story to end; never approve or reject it.
- **`ready`** only on green CI for the exact head the PR shows and a clean diff (no `runs/` file, no stray `handoff.md`). CI green on an older head → wait for the new run. A `runs/` file in the diff → escalate.
- **Stuck once**: read `norn run view <unit> --why --json` and the handoff, find the cause, then `norn run rerun <unit> --delegated --reason "fsd: …"` once. Stuck again at the same step → escalate with the receipts.
- **Loop exhausted once**: `norn run rerun <unit> --step <step> --reset <counter> --delegated --reason "fsd: …"` once. Exhausted again → escalate with each round's findings.
- **CI run hung or cancelled**: `gh run rerun --failed <id>` once, then wait on the `ci` check as usual.
- **Load**: a check that failed with `reason: timeout` while the load is far above the core count is environment, not a flake: wait for the load to drop, then rerun the step once. When one story keeps failing on load, pause the others (`norn story edit <story> --manual`, later `--auto`). Load that stays high → escalate.
- **Suspected flake**: the unit went back to implement but the same check passes on a rerun with no commit in between → `norn run rerun <unit> --step <check> --delegated --reason "fsd: suspected flake …"`. Judge it from the check receipt (exit code, reason, output tail) and the CI log; never run tests in a unit worktree.
- **Attended step** (a person works in the pane): escalate as the person's turn ("gh-203: refine needs you: `norn story start gh-203`") and wait for the round to move on.

## Allowed and forbidden commands

- Allowed: `norn story wait`, `norn story view`, `norn run view`, `norn run list`, `norn status --json`, `norn story answer`, `norn story approve`, `norn story reject`, `norn story edit --auto|--manual`, `norn run rerun [--step] [--reset]`, `gh run rerun --failed`, and reading with `gh`.
- Forbidden: `norn brief`, `norn story start`, `norn tick`, `norn watch`, `norn run cancel` to serialise work, `norn story edit --workflow` on an unfinished round or `--force`, `norn story checkout`, typing into a step pane, editing `runs/` or a unit worktree, running tests in a unit worktree.
- A command the agent's permission classifier refuses: never retry it another way. Hand the person the exact command (`! norn story approve gh-201 --delegated --reason "…"`) and the allow rule that lets you run it, e.g. for Claude Code `Bash(norn story approve:*)`, `Bash(norn story reject:*)`, `Bash(norn story answer:*)`, `Bash(norn run rerun:*)`, `Bash(norn story edit:*)`. You never edit settings yourself.

## What only the person decides (escalate)

Escalate, never act:

- a merge, a release, an install or a watch restart the request did not name ("deliver gh-201" stops once `ready` has its `approve` and waits for the person's merge; "… and merge it" merges with a squash once CI is green on the final head);
- force pushes, deleting a branch, `norn story checkout`, a base conflict from rewritten history or a stale intake;
- a spec question nothing written settles, and any change to the rules file (a plan that amends it is escalated before its gate gets an `approve`);
- a unit stuck again after one diagnosed retry, a loop exhausted again after one rerun;
- machine settings: config, `max_agents`, the watch — escalate with the change and why;
- closing an issue, and a workflow the skill does not know;
- `release`'s `ready`: always the person's, with the version, its reason and the changelog section. When the request names install and restart: approve on their answer → wait for the merge and the publish → install → pull → restart the watch and the cockpit.

**How to escalate.** One message per item, sent once while it waits: the story, the question, what you checked, the options with a recommended one ("gh-202 asks: which config file takes the new key? The spec does not say. Options: repo / local. Recommended: repo. Reply and I will answer it."). Several questions on one story go together as one question set. The person's reply becomes the command at once (`norn story answer …` without `--delegated`: it is their answer), with no second confirmation. Nothing else pings the person: steps passing, checks going green and rounds ending are quiet.

## When the round ends

The round ends at `$done` or `$stuck`; for `story` and `quick`, once `ready` has its `approve` (and the merge, when the request named it). Then the subagent reports and stops. Never start another round: that is `norn-fsd`.

## The report

One report for every supervised story when supervision ends. Per story: rounds run (from the receipts), findings fixed, delegated decisions with their reasons (`norn story view <story> --json` → `delegated`), escalations and how they were answered, suspected flakes with the test and the receipt, the PR and its merge state, and for `release` the version. A story that cannot finish is still listed: "waiting: your answer to …", with the command that resumes it.
