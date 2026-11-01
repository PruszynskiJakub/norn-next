---
id: gh-71
slug: approving-triage-s-confirm-gate-ends-the
provider: gh
number: 71
url: https://github.com/PruszynskiJakub/norn-next/issues/71
title: Approving triage's confirm gate ends the story, so the recommended workflow can't be switched to
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-11-01T08:42:30.030Z
body_hash: 6d64972f8ea9f4a62211dd96a477faf5b35ad809bad3e399a3710a7620086173
---

# Approving triage's confirm gate ends the story, so the recommended workflow can't be switched to

## Problem

A story runs exactly one workflow, and reaching `$done` ends the story for good. Intake workflows that change no code (`triage`, `reproduce`) end at a `confirm` gate, where the person reads a recommendation (go on with `quick` or `story`, or close the issue) and then presses `approve`, the obvious key to press. That sends the story to `$done`. From there:

- `norn story edit gh-N --workflow story --at refine` is refused (`gh-N is done`, `unit_done`). The recommended workflow can't be started.
- With no PR, the story sits under "Recently done — waiting for the PR merge (GR6)" forever. No PR is coming.
- The only ways out are `norn story close` or `norn story reset` and filing the work again. Both lose the story's place: the history no longer reads as one issue going from triage to delivery.

The gate prompt tells the person to switch *before* approving, but nothing enforces that, and one mistaken approve is enough to strand the story (seen on gh-61). Closing a story whose triage recommends closing is also a four-command chore, because a `$done` story without a PR never finishes on its own.

## Solution

An issue goes through a sequence of **rounds**: one workflow after another on the same story. Triage, then delivery, is the first case.

- `gh-N` stays the story. Each workflow applied to it is a new numbered round, with its own pinned workflow, cursor, counters and receipts, in its own folder of the record.
- One issue, one branch, one worktree, one PR. A later round builds on whatever earlier rounds left on the branch, and a later round's `open-pr` updates the open PR's body.
- `$done` ends a **round**, not the story. A person merging the PR still ends the story. A closed issue with no PR and no unfinished round now ends it too.
- The person starts the next round with the command they already know: `norn story edit gh-N --workflow <name>`. An unfinished round has to be ended on purpose with `--force`. `--at <step>` becomes the way to jump to a step inside the current round.

After this ships, approving triage's `confirm` gate ends the triage round. The inbox then shows "triage round done, no PR" with the command for the next round, and `norn story edit gh-61 --workflow story` just works.

## Behaviour

### Rounds

- B1 As a person, I want every workflow applied to a story to be a numbered round, so that a story's history reads as one issue going through several workflows.
  Example: gh-71 runs `triage` (round 1), then `story` (round 2). Both rounds belong to gh-71, on branch `gh-71-<slug>`.

- B2 As a person, I want `$done` to end the round, not the story, so that finishing a workflow never strands the story.
  Example: `norn story approve gh-71` at triage's `confirm` gate (`approve: $done`) → round 1 is finished, and gh-71 stays active and can start round 2.

- B3 As a person, I want each new round to start with fresh counters, so that loops spent in one workflow don't eat into the next.
  Example: triage's `triage_loop` reached 2/2 in round 1 → round 2 (`story`) starts with every counter at 0.

- B4 As a person, I want a new round to keep the branch, the worktree and the PR, so that a later round builds on earlier work.
  Example: a `quick` round started after a finished `story` round works in the same worktree, on top of the story round's commits, and its `open-pr` replaces the body of the PR that is already open instead of opening a second PR.

- B5 As a person, I want the story's mode (auto or manual) to carry over to the next round, so that I don't have to set it again.
  Example: gh-71 is `auto` in round 1 → round 2 starts in `auto`.

### Starting a round

- B6 As a person, I want `norn story edit gh-N --workflow <name>` on a story whose round is finished to start a new round at that workflow's start step, so that I can act on a recommendation after approving the gate.
  Example: gh-61's triage round is finished, no PR → `norn story edit gh-61 --workflow story` → round 2 starts at `refine`, and the inbox shows "Your turn" for refine.

- B7 As a person, I want a new round to be allowed even when the finished round left an open PR, so that I can add a round (for example a small fix) before I merge.
  Example: gh-71's story round finished at `ready`, PR #150 open → `norn story edit gh-71 --workflow quick` starts round 3. Its `open-pr` updates #150, and the story still ends only when #150 merges.

- B8 As a person, I want to be able to start the same workflow again as a new round, so that "triage again" is just another round.
  Example: `norn story edit gh-71 --workflow triage` on a finished triage round → round 2, `triage`, at `explore`.

- B9 As a person, I want `--workflow <name> --at <step>` to start the new round at that step instead of the start step, so that I can skip steps the branch already covers.
  Example: gh-9's reproduce round is finished → `norn story edit gh-9 --workflow quick --at sync` → round 2, `quick`, at `sync`.
  Example (unknown step): `--workflow quick --at nope` → refused, exit 3, naming `quick`'s steps; nothing changes.

- B10 As a person, I want starting a round on a story whose round is still unfinished to be refused unless I pass `--force`, so that I never end a round by accident.
  Example: gh-71 waits at triage's `confirm` gate → `norn story edit gh-71 --workflow story` → refused, exit 3: "gh-71's triage round is not finished; pass --force to end it and start a story round", with that command in `do_instead`. Nothing changes.

- B11 As a person, I want `--force` to end the unfinished round and start the new round in one command, so that I can move on from a round that waits at a gate, on an ask, or stuck.
  Example: gh-71 waits at `confirm` → `norn story edit gh-71 --workflow story --force` → round 1 is recorded as ended by the person, and round 2 (`story`) starts at `refine`.
  Example: gh-30 is `$stuck` in round 1 → `norn story edit gh-30 --workflow quick --force --at sync` → round 2 at `sync`.

- B12 As a person, I want `--force` to be refused while an agent is running a step of the round, so that no agent keeps writing to the branch after its round has ended.
  Example: the triage agent is running `explore` → `norn story edit gh-71 --workflow story --force` → refused, exit 3: an agent is running explore, stop it first with `norn run cancel gh-71`. Nothing changes.

- B13 As a person, I want `--force` to be refused while any slice of the story is unfinished, so that ending a story round never orphans a running slice.
  Example: slice gh-71/02 is at `implement` → `--force` → refused, exit 3: "slice gh-71/02 is not finished; finish or drop it first". Finished slices don't block it.

- B14 As a person, I want `--force` on a finished round to behave like starting a round without it, so that the flag is never in the way.
  Example: gh-61's round is finished → `norn story edit gh-61 --workflow story --force` → round 2 at `refine`, the same as B6.

- B15 As a person, I want `norn story edit gh-N --at <step>` without `--workflow` to move the current round to that step of its own workflow, so that I can jump inside a round without starting a new one.
  Example: gh-71's story round waits at `ready` → `norn story edit gh-71 --at implement` → same round, cursor at `implement`, counters kept.
  Example (no such step): `--at nope` → refused, exit 3, naming the round's steps.

- B16 As a person, I want `--at` on a story whose round is finished to be refused and point me to `--workflow`, so that I don't try to revive a finished round.
  Example: gh-61's round is finished → `norn story edit gh-61 --at explore` → refused, exit 3: "gh-61's triage round is finished; start a new round with `norn story edit gh-61 --workflow <name>`".

- B17 As a person, I want an unknown or invalid workflow name to be refused before anything changes, as today, so that a typo never ends a round.
  Example: `norn story edit gh-71 --workflow sotry --force` → refused, `unknown_workflow`, listing the workflows. The current round is untouched.

- B18 As a person on another machine, I want starting or ending a round to be refused while another machine holds the story's claim, as `story edit` is refused today, so that two machines never start different rounds.
  Example: gh-71 is held by `ana@laptop` → `norn story edit gh-71 --workflow story` on `jakub@desk` → refused with the holder and `norn story checkout gh-71`.

- B19 As a person, I want the story's `norn:wf:<name>` label on the remote issue to follow the current round's workflow, for visibility only, so that the issue list shows what each story is doing.
  Example: round 2 starts with `story` → the issue's `norn:wf:triage` label is replaced by `norn:wf:story`.
  Example: an edited label never starts or changes a round. Only `norn story edit` does.

- B20 As a person, I want a failed label update to warn and not stop the round, so that a network hiccup never blocks work.
  Example: the provider is unreachable when round 2 starts → round 2 starts, and the command's output and the trace carry a warning that the label was not updated.

### Ending the story

- B21 As a person, I want merging the PR to end the story as today, whatever round it is in, so that the PR stays the one end of delivery.
  Example: gh-71 in round 3 with PR #150 → #150 merged into the base → story done, cleanup as today.

- B22 As a person, I want a story whose issue is closed, with no PR and no unfinished round, to be finished by norn itself, so that a story triage recommended closing needs no cleanup chore.
  Example: gh-61's triage round is finished, there is no PR, and I close issue #61 → on the next sync norn pushes the story branch (the record stays there), removes the worktree, the local branch, the claim and the mailbox refs, marks the story closed as `norn story close` does, and gh-61 leaves the inbox.

- B23 As a person, I want a story finished this way to be reopenable like a closed one, so that reopening the issue brings it back.
  Example: I reopen #61 → `norn story reopen gh-61` restores it at its finished round, and `norn story edit gh-61 --workflow story` starts round 2.

- B24 As a person, I want a story whose issue is closed while a round is unfinished to park as today (`remote: issue closed`), so that norn never throws away work in progress.
  Example: gh-30 is at `implement` and #30 gets closed → gh-30 parks under Unblock with `remote: issue closed`. `norn story close` or `norn run rerun` stay the ways out.

### Visibility

- B25 As a person, I want a story whose round is finished and which has no PR to show in the inbox among the items that need me, with the next commands, so that it never looks like it waits for a merge.
  Example: gh-61 → "gh-61: triage round done, no PR", next: `norn story edit gh-61 --workflow <name>`, or close the issue. It replaces "workflow done — waiting for the PR merge (GR6)", and stays until a round starts or the issue is closed.

- B26 As a person, I want the inbox item for a finished round to be generic, with no recommendation text, so that it doesn't depend on how a workflow names its outcomes.
  Example: a finished triage round whose `explore` reported `story` still shows `--workflow <name>`, not `--workflow story`. The recommendation is on the issue comment.

- B27 As a person, I want a finished round with an open PR to keep showing the merge item, so that the PR stays visible.
  Example: gh-71's story round finished, PR #150 open → the "Merge PR #150" item as today. Starting another round (B7) stays possible.

- B28 As a person, I want `norn status`, `norn story view` and the handoff header to show the round number and its workflow, so that I know where the story is.
  Example: handoff header line "Round 2 · Workflow: story · Step: refine (attempt 1)". A story that never had a second round shows "Round 1".

- B29 As a person, I want `norn run list` to mark where each round starts and how the previous one ended, so that I can follow the story's history across rounds.
  Example: `norn run list gh-71` → "round 1 · triage" (its runs, "finished") then "round 2 · story" (its runs). Ending with `--force` shows "ended by the person".

### The record

- B30 As a person reading the record, I want each round of the story in its own folder, so that every round is self-contained.
  Example: gh-71's record has `runs/_story/rounds/01-triage/` and `runs/_story/rounds/02-story/`. Each holds that round's state, its pinned workflow, its numbered receipts (from 0001), its logs and its evidence. Round numbers are two digits from 01.

- B31 As a person, I want one handoff for the story, shared across rounds, so that the next agent or person reads the whole context in one place.
  Example: `runs/_story/handoff.md` stays where it is. Its generated header shows the current round (B28), and Goal / Progress / Resume carry over into the next round.

- B32 As a person, I want how a round ended (finished, or ended by the person with `--force`) recorded in that round's own folder, so that the history says why a round stopped.
  Example: round 1 ended with `--force` at `confirm` → its folder records "ended by the person at confirm", and `run list` shows it (B29).

- B33 As a person, I want slice folders to stay next to the story's folder, each recording the round that started it, so that slices keep their paths and numbers.
  Example: round 2 starts slices 01 and 02 → `runs/01-<slug>/` and `runs/02-<slug>/`, each recording round 2. A later round's slices take the next numbers, so they never clash.

- B34 As a person with stories already in progress, I want norn to move a story's flat record into `rounds/01-<workflow>/` the first time a new norn touches it, as one commit on the story branch, so that I do nothing and the code knows one layout.
  Example: gh-60 started before this ships, at `implement`, with its state and receipts directly under `runs/_story/` → the first tick moves them into `runs/_story/rounds/01-story/` in one commit. gh-60 goes on at `implement`, round 1, counters unchanged.

- B35 As a person whose stories already sit at "done, no PR", I want them to become finished round 1, so that I don't have to rescue them by hand.
  Example: gh-61 (triage, `$done`, no PR) → after the move it shows "gh-61: triage round done, no PR", and `norn story edit gh-61 --workflow story` starts round 2.

- B36 As a person reading an old story, I want records already merged into the base branch to stay flat and still be readable by commands that show history, so that old records are never rewritten.
  Example: `norn run list gh-40` for a story merged before this ships reads its flat record and shows it as round 1. Nothing is written to the base branch.

## Out of scope

- Removing or changing the `confirm` gates of `triage` and `reproduce` — whether a workflow ends with a gate is its own decision; with rounds, `approve` there simply ends the round. Their prompt text is still corrected where it says a done story without a PR waits for a merge.
- Showing a round's recommendation in the inbox (`--workflow story` instead of `<name>`) — it would tie norn to how a workflow names its outcomes.
- How a later round treats earlier rounds' slices (for example a second `story` round adding slices) — left to the plan.
- Triage writing only an issue comment — #69, its own story.
- A workflow that merges its own PR (`git: merge`) — its own issue. A person still merges (GR5).
- Rewriting records already merged into the base branch — norn never rewrites the base.

## Open questions

None.

## PRD

Amended in this step: §5 (core noun *round*), §7 (record layout), S7, W7, W9, the default story workflow sketch, new §11.1 (RD1–RD8), new GR6b, GR7.
