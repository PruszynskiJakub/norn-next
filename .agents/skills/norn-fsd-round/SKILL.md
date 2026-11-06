---
name: norn-fsd-round
description: Supervises the norn stories a person names through their current round unattended, deciding gates and answers as delegated decisions and escalating only what is theirs. Use when asked to supervise, deliver or babysit named stories through their current round. Not for chaining rounds; use `/norn-fsd`.
---

# Supervise named stories through their round

You supervise the stories the person named, in this checkout, until each one's current round ends. norn decides every next step; you decide only what the person delegated to you (SK3), always through norn's commands, always with a reason. Never start another round: that is `norn-fsd`.

## Before you start

- **Main checkout only.** If the working directory or a parent holds a `.norn-unit` file, stop: "norn-fsd-round runs in the main checkout, never in a unit worktree." norn refuses `--delegated` there too.
- **One supervisor per checkout.** If another supervisor runs here, stop and tell the person to add the stories to it. Never restart or replace a watch another session relies on: two watches on one checkout fight over its claims.
- **Named stories only.** Supervise exactly the stories the request names; leave every other story in `norn status --json` alone. A `release` story only when the request names it (never run `/release-start`).
- **The watch.** Read `heartbeat.up` from `norn status --json`: true while a watch ticks in this checkout, false when none ever ticked or the last tick is stale, whatever mode the stories are in. False → one escalation: "No watch is running. Start it in its own terminal: `! norn watch`", then wait until it is true. You never start one; subagents read it again after every wait. A heartbeat that goes stale later gets the same escalation, naming the stories that stopped moving.

## Shape

- You, the top-level supervisor, are the only one who talks to the person. Name the story in every message ("gh-201: …"); pass escalations on one at a time.
- Start **one subagent per story**, with the brief below. It returns to you only to escalate or to report.
- **Every wait runs in the foreground, under the harness's foreground limit**, so it is never moved to the background and lost. For Claude Code (which backgrounds a command after about 180 s): `norn story wait … --timeout 160s` with a Bash timeout about 178 s (178000 ms), and `timeout 170 gh run watch <run-id> --exit-status` (exit 124: the timeout passed, watch again). `--until` takes one condition, so the timeout also bounds how long an ask, a stuck unit or the round's end waits to be seen. Run every norn and gh command directly, never through a script or in the background, nor on a timer: a wrapper script hides the command from the permission check.
- **Never loop on `--until gate` while you leave a gate parked** on purpose: it returns at once while that gate waits. Wait on what the gate waits for instead: a PR the person merged → `norn story wait <story> --until merged --timeout 160s` (it holds once the PR is merged or the story is done; a story merged at a `ready` gate never reaches `$done`); a new CI run on the PR's head → `gh run watch` as above; the person's answer to an escalation → nothing, the subagent has returned to you. Then go back to the `--until gate` loop.
- Read norn's JSON, never its text: `norn story view <story> --json`, `norn run view <unit> --json`, `norn run list <unit> --json`, `norn status --json`. Branch on fields; never grep markdown, and never pass a story to `norn status` (it takes none).

## Subagent brief (give it verbatim, with the story filled in)

> Supervise <story> to the end of its current round, from the main checkout, with norn's commands only. Load the `norn-fsd-round` skill first and follow it.
> 1. Run `norn story edit <story> --auto` once. Never run `norn brief`, `norn story start`, `norn tick` or `norn watch`; never type into a step pane.
> 2. Loop: `norn story wait <story> --until gate --timeout 160s`, run directly in the foreground with a Bash timeout about 178 s (exit 0: a gate waits; exit 7: the timeout passed). After every wait read `heartbeat.up` from `norn status --json` (false → escalate "No watch is running") and `norn story view <story> --json`, and act on what waits: a gate, an ask, a stuck unit or the round's end. Every decision you send carries `--delegated --reason "fsd: <evidence>"`.
> 3. Return to the supervisor only with an escalation (one message, everything needed to answer) or with the report when the round ends. After an escalation you stop; once the person's reply has been sent, the supervisor starts you again with this brief.

## What you decide (delegated, always with `--delegated --reason`)

- **Asks** the spec, the repo or the issue settle: `norn story answer <unit> "<answer>" --delegated --reason "fsd: spec B4 says …"`. A permission prompt the step plainly needs: its option number.
- **Gates**: read what the gate judges (slice files against the spec's Behaviour items, the plan, the diff, the PR) and run `norn story approve <unit> --delegated --reason "…"` or `norn story reject <unit> --delegated --reason "…"`. The reason names the evidence: Behaviour items, the CI run, the merge danger.
- **Before any gate, read the PR's state** (`gh pr view <branch> --json state,headRefOid,statusCheckRollup`). A PR the person merged → wait for the story to end (`--until merged`, not `--until gate`); never approve or reject it.
- **`ready`** only on green CI for the exact head the PR shows and a clean diff (no `runs/` file, no stray `handoff.md`, `gh pr diff <branch> --name-only`). Every check in `statusCheckRollup` must have passed and belong to `headRefOid` (`gh run list --branch <branch> --json headSha,conclusion` names each run's head). CI green on an older head → wait for the new run, not on the gate. A `runs/` file in the diff → escalate.
- **Stuck once**: read `norn run view <unit> --why --json` and the handoff, find the cause, then `norn run rerun <unit> --delegated --reason "fsd: …"` once. Stuck again at the same step → escalate with the receipts. A stuck unit does not end the round.
- **Loop exhausted once**: `norn run rerun <unit> --step <step> --reset <counter> --delegated --reason "fsd: …"` once. Exhausted again → escalate with each round's findings.
- **CI run hung or cancelled**: a hung run first gets `gh run cancel <id>` (`gh run rerun` refuses a run in progress), then `gh run rerun --failed <id>` once. The `ci` check fails on the cancelled run and sends the unit to implement, so then rerun at its check (`--step ci`, below): it watches the rerun of the same run. Passes → on to `ready`; fails again → implement as norn routes it.
- **Load**: a check that failed with `reason: timeout` while the load is far above the core count is environment, not a flake: wait for the load to drop, then rerun at its check once (`--step <check>`, below). When one story keeps failing on load, pause the others (`norn story edit <story> --manual`, later `--auto`). Load that stays high → escalate.
- **Suspected flake**: a check failed and sent the unit back to implement, but the failure has nothing to do with the change (the failing test is untouched by the diff, CI is green on the same head) → rerun at its check once with `--reason "fsd: suspected flake …"`. Passes → a suspected flake for the report; fails again → it goes to implement as norn routes it. Judge it from the check receipt (exit code, reason, output tail) and the CI log; never run tests in a unit worktree.
- **Rerun at its check** (CI glitch, load, suspected flake): read `norn run view <unit> --json`; its `check_retry` names the check, the rerun command and `code_changed`. Only while `code_changed` is `false` (a change since the fail means implement already works on it; `null` means it cannot be told; leave both): `norn run rerun <unit> --step <check> --delegated --reason "fsd: …"`. It is accepted while implement runs or waits to start, and norn stops that session itself (O2a). Once per failure. `check_retry` is `null` once implement has reported or the unit moved on: nothing to rerun.
- **Attended step** (a person works in the pane): escalate as the person's turn ("gh-203: refine needs you: `norn story start gh-203`") and wait for the round to move on.

## Allowed and forbidden commands

- Allowed: `norn story wait`, `norn story view`, `norn run view`, `norn run list`, `norn status --json`, `norn story answer`, `norn story approve`, `norn story reject`, `norn story edit --auto|--manual`, `norn run rerun [--step] [--reset]`, `gh run cancel` on a hung run, `gh run rerun --failed`, and reading with `gh`; when the request named them, `gh pr merge --squash` and installing norn, pulling and restarting the watch.
- Forbidden: `norn brief`, `norn story start`, `norn tick`, `norn watch` (unless the request named a watch restart), `norn run cancel` (never to serialise work; a rerun at its check needs none, O2a), `norn story edit --workflow` or `--force` (starting a round is `norn-fsd`'s), `norn story checkout`, typing into a step pane, editing `runs/` or a unit worktree, running tests in a unit worktree.
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

The round ends at `$done`; for `story` and `quick`, once `ready` has its `approve` (and the merge, when the request named it). Then the subagent reports and stops.

**One report**, when supervision ends, for every supervised story: rounds run (from the receipts), findings fixed, delegated decisions with their reasons (`norn story view <story> --json` → `delegated`), escalations and how they were answered, suspected flakes with the test and the receipt, the PR and its merge state, and for `release` the version. A story that cannot finish is still listed: "waiting: your answer to …", with the command that resumes it.
