---
name: norn-fsd-round
description: Supervise the stories a person names through their current norn round, unattended — one supervisor in the main checkout, one foreground subagent per story, norn's own commands only; decides gates and answers on the person's behalf as delegated decisions with reasons, escalates only what the person keeps, and ends with one report. Use when a person asks to supervise, deliver or babysit named norn stories to the end of their round. Never a workflow step.
---

# Supervise named stories through their round

You supervise the stories the person named, in this checkout, until each one's current round ends. norn decides every next step; you decide only what the person delegated to you (SK3), always through norn's commands, always with a reason.

## Before you start

- **Main checkout only.** If the working directory or a parent holds a `.norn-unit` file, stop: "norn-fsd-round runs in the main checkout, never in a unit worktree." norn refuses `--delegated` there too.
- **One supervisor per checkout.** If another supervisor runs here, stop and tell the person to add the stories to it. Never restart or replace a watch another session relies on: two watches on one checkout fight over its claims.
- **Named stories only.** Supervise exactly the stories the request names; leave every other story in `norn status --json` alone. A `release` story only when the request names it (never run `/release-start`).
- **The watch.** Read `heartbeat.up` from `norn status --json`: true while a watch ticks in this checkout, false when none ever ticked or the last tick is stale, whatever mode the stories are in. False → one escalation: "No watch is running. Start it in its own terminal: `! norn watch`", then wait until it is true. Never start one yourself; never run `norn watch` or `norn tick`. Subagents read it again after every wait; a heartbeat that goes stale later gets the same escalation, naming the stories that stopped moving.

## Shape

- You, the top-level supervisor, are the only one who talks to the person. Name the story in every message ("gh-201: …"); pass escalations on one at a time.
- Start **one subagent per story**, with the brief below. Each loops in the **foreground** on `norn story wait <story> --until gate --timeout 5m` and returns to you only to escalate or to report. `--until` takes one condition, so the timeout bounds how long an ask, a stuck unit or the round's end waits to be seen. No background polling, no timers that expire.
- **Never loop on `--until gate` while you leave a gate parked** on purpose: it returns at once while that gate waits. Wait on what the gate waits for instead: a PR the person merged → `norn story wait <story> --until merged --timeout 5m` (it holds once the PR is merged or the story is done; a story merged at a `ready` gate never reaches `$done`); a new CI run on the PR's head → `gh run watch <run-id> --exit-status`; the person's answer to an escalation → nothing, the subagent has returned to you (see the brief). Then go back to the `--until gate` loop.
- Read norn's JSON, never its text: `norn story view <story> --json`, `norn run view <unit> --json`, `norn run list <unit> --json`, `norn status --json`. Branch on fields; never grep markdown, and never pass a story to `norn status` (it takes none).

## Subagent brief (give it verbatim, with the story filled in)

> Supervise <story> to the end of its current round, from the main checkout, with norn's commands only.
> 1. Run `norn story edit <story> --auto` once. Never run `norn brief`, `norn story start`, `norn tick` or `norn watch`; never type into a step pane.
> 2. Loop: `norn story wait <story> --until gate --timeout 5m` in the foreground (exit 0: a gate waits; exit 7: five minutes passed), then, after every wait, read `heartbeat.up` from `norn status --json` (false → escalate "No watch is running") and `norn story view <story> --json`, and act on what waits (a gate, an ask, a stuck unit or the round's end) by the rules of the `norn-fsd-round` skill: load it first. Every decision you send carries `--delegated --reason "fsd: <evidence>"`.
> 3. Return to the supervisor only with an escalation (one message, everything needed to answer) or with the report when the round ends. After an escalation you stop; once the person's reply has been sent, the supervisor starts you again with this brief.

## What you decide (delegated, always with `--delegated --reason`)

- **Asks** the spec, the repo or the issue settle: `norn story answer <unit> "<answer>" --delegated --reason "fsd: spec B4 says …"`. A permission prompt the step plainly needs: its option number.
- **Gates**: read what the gate judges (slice files against the spec's Behaviour items, the plan, the diff, the PR) and run `norn story approve <unit> --delegated --reason "…"` or `norn story reject <unit> --delegated --reason "…"`. The reason names the evidence: Behaviour items, the CI run, the merge danger.
- **Before any gate, read the PR's state** (`gh pr view <branch> --json state,headRefOid,statusCheckRollup`). A PR the person merged → wait for the story to end (`--until merged`, not `--until gate`); never approve or reject it.
- **`ready`** only on green CI for the exact head the PR shows and a clean diff (no `runs/` file, no stray `handoff.md`, `gh pr diff <branch> --name-only`). Every check in `statusCheckRollup` must have passed and belong to `headRefOid` (`gh run list --branch <branch> --json headSha,conclusion` names each run's head). CI green on an older head → wait for the new run (`gh run watch`), not on the gate. A `runs/` file in the diff → escalate.
- **Stuck once**: read `norn run view <unit> --why --json` and the handoff, find the cause, then `norn run rerun <unit> --delegated --reason "fsd: …"` once. Stuck again at the same step → escalate with the receipts.
- **Loop exhausted once**: `norn run rerun <unit> --step <step> --reset <counter> --delegated --reason "fsd: …"` once. Exhausted again → escalate with each round's findings.
- **CI run hung or cancelled**: a hung run first gets `gh run cancel <id>` (`gh run rerun` refuses a run in progress), then `gh run rerun --failed <id>` once. The `ci` check fails on the cancelled run and sends the unit to implement, so then rerun at its check (`--step ci`, below): it watches the rerun of the same run. Passes → on to `ready`; fails again → implement as norn routes it.
- **Load**: a check that failed with `reason: timeout` while the load is far above the core count is environment, not a flake: wait for the load to drop, then rerun at its check once (`--step <check>`, below). When one story keeps failing on load, pause the others (`norn story edit <story> --manual`, later `--auto`). Load that stays high → escalate.
- **Suspected flake**: a check failed and sent the unit back to implement, but the failure has nothing to do with the change (the failing test is untouched by the diff, CI is green on the same head) → rerun at its check once (below), not in implement, with `--reason "fsd: suspected flake …"`. Passes → a suspected flake for the report; fails again → it goes to implement as norn routes it, no second rerun. Judge it from the check receipt (exit code, reason, output tail) and the CI log; never run tests in a unit worktree.
- **Rerun at its check** (CI glitch, load, suspected flake): a failed check sent the unit to implement, and `norn run rerun` refuses a running unit. Only while the branch has no commit newer than the check receipt's `at` outside `runs/` (`git log -1 --format=%cI <branch> -- . ':(exclude,glob)**/runs/**'`: norn's own transition commits touch only `runs/`; a newer commit means implement already works on it, leave it): `norn run cancel <unit>`, wait for `norn story view <story> --json` to show it stuck, then `norn run rerun <unit> --step <check> --delegated --reason "fsd: …"`. Once per failure, never a second time. `run cancel` refusing with `nothing_to_cancel` means implement has not launched yet: already stuck → rerun at once; otherwise read the story again after the next wait and cancel once it runs. The cancel is a mechanical step recorded as the person's; the delegated rerun that follows carries the reason.
- **Attended step** (a person works in the pane): escalate as the person's turn ("gh-203: refine needs you: `norn story start gh-203`") and wait for the round to move on.

## Allowed and forbidden commands

- Allowed: `norn story wait`, `norn story view`, `norn run view`, `norn run list`, `norn status --json`, `norn story answer`, `norn story approve`, `norn story reject`, `norn story edit --auto|--manual`, `norn run rerun [--step] [--reset]`, `norn run cancel` only right before a rerun at its check, `gh run cancel` on a hung run, `gh run rerun --failed`, and reading with `gh`; when the request named them, `gh pr merge --squash` and installing norn, pulling and restarting the watch.
- Forbidden: `norn brief`, `norn story start`, `norn tick`, `norn watch` (unless the request named a watch restart), `norn run cancel` for anything but a rerun at its check (never to serialise work), `norn story edit --workflow` on an unfinished round or `--force`, `norn story checkout`, typing into a step pane, editing `runs/` or a unit worktree, running tests in a unit worktree.
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

The round ends at `$done`; for `story` and `quick`, once `ready` has its `approve` (and the merge, when the request named it). Then the subagent reports and stops. A stuck unit does not end the round: it gets its one diagnosed rerun (Stuck once), and only a second stuck at the same step is escalated; the subagent then returns with that escalation, not a report. Never start another round: that is `norn-fsd`.

## The report

One report for every supervised story when supervision ends. Per story: rounds run (from the receipts), findings fixed, delegated decisions with their reasons (`norn story view <story> --json` → `delegated`), escalations and how they were answered, suspected flakes with the test and the receipt, the PR and its merge state, and for `release` the version. A story that cannot finish is still listed: "waiting: your answer to …", with the command that resumes it.
