---
name: norn-fsd-round
description: Supervises the norn stories a person names through their current round unattended, deciding gates and answers on the person's behalf and escalating only what is theirs. Use when asked to supervise, deliver or babysit named stories through their current round. Not for chaining rounds; use `/norn-fsd`.
---

# Supervise named stories through their round

You supervise the stories the person named, in this checkout, until each one's current round ends. norn decides every next step; you decide only what the person delegated to you, always through norn's commands, always with a reason. Never start another round.

## Before you start

- **Main checkout only.** If the `NORN_UNIT` environment variable is set, or the working directory is under the norn home's `repos/<id>/worktrees/` (where norn keeps unit worktrees), stop: "norn-fsd-round runs in the main checkout, never in a unit worktree."
- **One supervisor per checkout.** If another supervisor runs here, stop and tell the person to add the stories to it. Never restart or replace a watch another session relies on: two watches on one checkout fight over its claims.
- **Named stories only.** Supervise exactly the stories the request names; leave every other story in `norn status --json` alone. A `release` story only when the request names it (never run `/release-start`).
- **The watch.** Stories move only while a watch ticks (`norn watch`, in its own terminal or under cron). Ask the person once whether one runs; when none does, one escalation: "No watch is running. Start it in its own terminal: `! norn watch`". You never start one. A story whose units have not moved across several reads while nothing waits on a person gets the same escalation, naming the stories that stopped moving.

## Shape

- You, the top-level supervisor, are the only one who talks to the person. Name the story in every message ("gh-201: …"); pass escalations on one at a time.
- Start **one subagent per story**, with the brief below. It returns to you only to escalate or to report.
- **Every wait runs in the foreground, under the harness's foreground limit**, so it is never moved to the background and lost. For Claude Code (which backgrounds a command after about 180 s): `sleep 150` with a Bash timeout about 178 s (178000 ms) between two reads of the story, and `timeout 170 gh run watch <run-id> --exit-status` (exit 124: the timeout passed, watch again). Run every norn and gh command directly, never through a script or in the background, nor on a timer: a wrapper script hides the command from the permission check.
- **Never decide a gate you left parked on purpose** on the next read: wait on what the gate waits for instead. A PR the person merged → keep reading the story until it ends; a new CI run on the PR's head → `gh run watch` as above; the person's answer to an escalation → nothing, the subagent has returned to you.
- Read norn's JSON, never its text: `norn story view <story> --json` and `norn status --json`. Branch on fields (each unit's `step`, `waiting`, `parked`, `ended` and `run`, and the story's `change`); never grep markdown, and never pass a story to `norn status` (it takes none).

## Subagent brief (give it verbatim, with the story filled in)

> Supervise <story> to the end of its current round, from the main checkout, with norn's commands only. Load the `norn-fsd-round` skill first and follow it.
> 1. Never run `norn brief`, `norn tick` or `norn watch`; never type into a step pane.
> 2. Loop: read `norn story view <story> --json` and act on what waits (a unit's `waiting.for` is `gate`, `answer`, `permission` or `person`; `parked` names why a unit is held, `agent.ready.manual` being a manual step and any other reason a stuck unit; every unit `ended` `done` is the round's end), then `sleep 150` in the foreground with a Bash timeout about 178 s and read again. Every gate decision you send carries `--reason "fsd: <evidence>"`.
> 3. Return to the supervisor only with an escalation (one message, everything needed to answer) or with the report when the round ends. After an escalation you stop; once the person's reply has been sent, the supervisor starts you again with this brief.

## What you decide (on the person's behalf)

- **Asks** the spec, the repo or the issue settle: `norn story answer <story> "<answer>"`, the answer naming what settled it ("the spec's story on <what it says> settles it: …"). A permission prompt the step plainly needs: its option number.
- **Gates**: read what the gate judges (slice files against the spec's user stories, the plan, the diff, the PR) and run `norn story approve <story> --reason "fsd: …"` or `norn story reject <story> --reason "fsd: …"` (`--gate <step>` when the story waits on several). The reason names the evidence in words a person reads without the spec open: the user stories by what they say, the CI run, the merge danger.
- **Before any gate, read the PR's state** (`gh pr view <branch> --json state,headRefOid,statusCheckRollup`). A PR the person merged → wait for the story to end; never approve or reject it.
- **`ready`** only on green CI for the exact head the PR shows and a clean diff (no run-data file, no stray `handoff.md`, `gh pr diff <branch> --name-only`). Every check in `statusCheckRollup` must have passed and belong to `headRefOid` (`gh run list --branch <branch> --json headSha,conclusion` names each run's head). CI green on an older head → wait for the new run, not on the gate. A run-data file in the diff → escalate.
- **CI run hung or cancelled**: a hung run first gets `gh run cancel <id>` (`gh run rerun` refuses a run in progress), then `gh run rerun --failed <id>` once. Passes → on to `ready`; fails again → the unit goes where norn routes it.
- **Manual step** (`parked` is `agent.ready.manual`): `norn run start <unit>` once, only when the request named manual steps as yours; otherwise escalate it as the person's turn.
- **Attended step** (a person works in the pane): escalate as the person's turn ("gh-203: refine needs you: `norn run start <unit>`") and wait for the round to move on.

## Sending work back: the person's, unless handed to you

`norn run rerun <unit> [--step <step>] [--reset <counter>]` runs a unit's step again or moves it to another step of its workflow (a slice included); `norn story round` starts a new round. A new round is always the person's. A rerun is the person's too unless the request handed reruns to you: then run it yourself, once per failure, with `--reason "fsd: <evidence>"` (`norn run rerun gh-201/02 --step check` after a suspected flake, `--step <to> --reset <counter>` for an exhausted loop). Otherwise escalate each case below with what you found and the rerun that would fix it:

- **A stuck unit** (`parked` with any reason but `agent.ready.manual`, or `ended` with anything but `done`): read the unit's handoff and the check's output, find the cause, and escalate with it and a recommended fix.
- **A loop exhausted**: escalate with each round's findings.
- **A suspected flake**: a check failed and sent the unit back to implement, but the failure has nothing to do with the change (the failing test is untouched by the diff, CI is green on the same head). Escalate with the check's exit code, output tail and the CI log; never run tests in a unit worktree.
- **Load**: a check that failed on a timeout while the load is far above the core count is environment, not the change. Escalate with the load.

## Allowed and forbidden commands

- Allowed: `norn story view`, `norn story list`, `norn status --json`, `norn story answer`, `norn story approve`, `norn story reject`, `norn run start` on a manual step the request named, `norn run rerun` when the request handed reruns to you, `gh run cancel` on a hung run, `gh run rerun --failed`, and reading with `gh`; when the request named them, `gh pr merge --squash` and installing norn, pulling and restarting the watch.
- Forbidden: `norn brief`, `norn tick`, `norn watch` (unless the request named a watch restart), `norn run stop` (never to serialise work), `norn story close`, typing into a step pane, editing run data or a unit worktree, running tests in a unit worktree.
- A command the agent's permission classifier refuses: never retry it another way. Hand the person the exact command (`! norn story approve gh-201 --reason "…"`) and the allow rule that lets you run it, e.g. for Claude Code `Bash(norn story approve:*)`, `Bash(norn story reject:*)`, `Bash(norn story answer:*)`, `Bash(norn run start:*)`, `Bash(norn run rerun:*)`. You never edit settings yourself.

## What only the person decides (escalate)

Escalate, never act:

- a merge, a release, an install or a watch restart the request did not name ("deliver gh-201" stops once `ready` has its `approve` and waits for the person's merge; "… and merge it" merges with a squash once CI is green on the final head);
- force pushes, deleting a branch, a base conflict from rewritten history or a stale intake;
- a spec question nothing written settles, and any change to the rules file (a plan that amends it is escalated before its gate gets an `approve`);
- a stuck unit, an exhausted loop, a suspected flake, and anything else that needs a rerun, unless the request handed reruns to you (then one `norn run rerun` per failure, as above); a new round (`norn story round`) always;
- machine settings: config, the executors, the watch — escalate with the change and why;
- a story another machine holds (its `claim` in `norn story view <story> --json` names another holder, or is null while a unit is still under way): moving it here is the person's, escalated with `norn story take <story> --force --reason "…"`; never take a claim yourself;
- an open PR of a story whose round ended that conflicts with its base or lags it: updating it is the person's, escalated with `norn story update-branch <story> --reason "…"` (a conflict there is refused with its paths, and resolved by the round its `do_instead` names); never run it yourself;
- closing an issue, and a workflow the skill does not know;
- `release`'s `ready`: always the person's, with the version, its reason and the changelog section. When the request names install and restart: approve on their answer → wait for the merge and the publish → install → pull → restart the watch.

**How to escalate.** One message per item, sent once while it waits: the story, the question, what you checked, the options with a recommended one ("gh-202 asks: which config file takes the new key? The spec does not say. Options: repo / local. Recommended: repo. Reply and I will answer it."). Several questions on one story go together as one question set. The person's reply becomes the command at once (`norn story answer …`: it is their answer), with no second confirmation. Nothing else pings the person: steps passing, checks going green and rounds ending are quiet.

## When the round ends

The round ends at `$done`, when every unit of the story has `ended` `done`; for `story` and `quick`, once `ready` has its `approve` (and the merge, when the request named it). Then the subagent reports and stops.

**One report**, when supervision ends, for every supervised story: the steps run, findings fixed, the decisions you made with their reasons, escalations and how they were answered, suspected flakes with the test and the check's output, the PR and its merge state, and for `release` the version. A story that cannot finish is still listed: "waiting: your answer to …", with the command that resumes it.
