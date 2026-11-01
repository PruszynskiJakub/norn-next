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

## Plan

### Seams

- **S1 The cli harness, through `norn …` commands and `tick` against the fake remote, runner and clock.** Observes B1–B20, B28–B33, B36, and the effects of B22, B23, B34 and B35: command output and refusals (exit code, `code`, `do_instead`), the files under `runs/` (round folders, state, pinned workflow, receipts), the commits on the story branch, `status --json`, `story view`, `run list`, the handoff header, and the calls recorded on the fake remote (label swap, a failing label call).
  Prior art: the cli integration tests on the shared harness. `story edit` before and after start, mode and approve are in the human-verb tests. The GR6 wait after `$done` is in the runtime tests. Close and reopen are in the story-reopen tests. A flat record for B36 is written by a fixture, the way the view tests keep a flat `_story` record.
- **S2 `decide` and `buildInbox` over Facts.** Observes B21, B24–B27, and the rules behind B22 (GR6b), B34 (`round.migrate`) and B35 (an old remote park at `$done` read as a finished round). Built with the core fixtures (story, unit and facts builders). Every new rule id also gets a hand-built rule case or a harvested golden case, as the golden test requires.
  Prior art: the decide unit tests (story finished, GR7 remote park), the handoff and inbox unit tests (the GR6 "waiting for the PR merge" items), and the hand-built rule cases (remote park "issue closed").

The e2e effect transcripts, the observe snapshots, the brief snapshot and the view fixtures change because the story's record moves. They are regenerated and their diffs reviewed. They are not new seams.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | integration | triage round then story round on one branch; both folders present |
| B2 | S1 | integration | approve at `confirm` → round finished, story still active |
| B3 | S1 | integration | counter at max in round 1 → 0 in round 2 |
| B4 | S1 | integration | same worktree and branch; a second `open-pr` updates the open PR on the fake remote |
| B5 | S1 | integration | auto in round 1 → auto in round 2 |
| B6 | S1 | integration | finished, no PR → round 2 at the start step; the inbox shows Your turn |
| B7 | S1 | integration | finished with an open PR → round starts; PR body updated, not a second PR |
| B8 | S1 | integration | same workflow again as round 2 |
| B9 | S1 | integration | `--at` start step; unknown step refused, nothing written |
| B10 | S1 | integration | unfinished round, no `--force` → refused exit 3, `do_instead` names the `--force` command |
| B11 | S1 | integration | at a gate and at `$stuck` → old round ended by the person, new round started |
| B12 | S1 | integration | running agent step → refused, points to `run cancel` |
| B13 | S1 | integration | unfinished slice → refused; finished slices don't block |
| B14 | S1 | integration | `--force` on a finished round = without it |
| B15 | S1 | integration | `--at` alone moves the cursor in the same round, counters kept; unknown step refused |
| B16 | S1 | integration | `--at` alone on a finished round → refused, points to `--workflow` |
| B17 | S1 | integration | unknown workflow with `--force` → refused, round untouched |
| B18 | S1 | integration | claim held by another clone → refused with holder and checkout |
| B19 | S1 | integration | fake remote records the label swap; an edited label starts nothing |
| B20 | S1 | integration | fake remote fails the label call → round starts, warning in output and trace |
| B21 | S2 | unit | merged PR in round 3 → `remote.pr_merged` cleanup as today |
| B22 | S2 + S1 | unit + integration | S2: GR6b rule fires only on a seen `closed` issue, no PR, round finished, no unfinished slice. S1: branch pushed, worktree, branch, claim and mailbox refs gone, spec closed, gone from the inbox |
| B23 | S1 | integration | reopen restores the finished round; `--workflow` then starts round 2 |
| B24 | S2 | unit | closed issue with an unfinished round → park `remote: issue closed` as today |
| B25 | S2 | unit | finished round, no PR → Your turn item "<story>: <workflow> round done, no PR" with the `--workflow <name>` command |
| B26 | S2 | unit | item shows `<name>` whatever outcome the last step reported |
| B27 | S2 | unit | finished round with an open PR → merge item as today |
| B28 | S1 | integration | `status --json`, `story view` and the handoff header show round, workflow and step; a one-round story shows "Round 1" |
| B29 | S1 | integration | `run list` groups runs by round and says how each ended (finished / ended by the person) |
| B30 | S1 | integration | `rounds/01-triage/` and `rounds/02-story/`, each with state, pin, receipts from 0001, logs, evidence |
| B31 | S1 | integration | one `runs/_story/handoff.md`; Goal / Progress / Resume survive the round change |
| B32 | S1 | integration | the forced round's state records ended by the person at its step |
| B33 | S1 | integration | slices started in round 2 stay at `runs/<nn>-<slug>/` and record round 2 |
| B34 | S2 + S1 | unit + integration | S2: `round.migrate` comes first for a held flat story and is held during a rebase. S1: files moved with `git mv` in one commit, unit goes on at its step with counters unchanged |
| B35 | S2 + S1 | unit + integration | S2: an old `$done` story (including one parked `remote` by an older norn) reads as a finished round. S1: after the move the Your turn item shows and `--workflow` starts round 2 |
| B36 | S1 | integration | `run list` on a flat record from the base shows round 1; nothing is written |

### Prefactoring

1. **One resolver for a unit's record folder.** Every place that builds `runs/<unit>` by hand goes through the store's path module: act's env and start, story checkout, leases, the human-verb remote read, brief's rulings scan, reopen, tidy and the unpushed check. No behaviour change. This puts B30, B34 and B36 in one function instead of about ten.
2. **Pull `story close`'s effects out of the command** into a runtime function: mark the spec closed, commit, push the story and slice branches, then remove worktrees, local branches, leases, the claim and mailbox refs. The command and a tick action both call it. No behaviour change. This lets B22 do exactly what `story close` does.
3. **A label-editing method on the remote port** (replace one issue label with another), in the gh and glab adapters and the harness's fake remote, with contract-suite runs, unused for now. No behaviour change. B19 and B20 then need only a call and a warning.

### Implementation decisions

- D1 **A round starts through a receipt, and the tick applies it.** `norn story edit <story> --workflow <name> [--at <step>] [--force]` runs under the tick lock. It checks everything, then writes a new `round` receipt into the current round: workflow name, hash of the workflow file, target step, `forced`, and the step the round is left at. It writes no state. The next tick applies it in one action and one commit. That action ends the old round in its own state: `$done`, and with `ended` recorded as the person at `<step>` when forced. It then creates `rounds/NN-<workflow>/` with the pinned workflow and a fresh state (counters 0, mode carried over, cursor at `--at` or the start step), and swaps the issue label. If the workflow file's hash at the tick differs from the receipt's, the receipt is rejected into the trace with an inbox item to run the edit again. Why: receipts before effects (P6), state last (S5), and decide stays pure and replayable. This is the same pattern as the `workflow` and `mode` receipts. The receipt kinds grow from 14 to 15, and the JSON schemas are re-emitted.
- D2 **The story keeps its identity, and files are found through a record folder.** The story unit keeps `dir: "_story"`, so hook files, the `.norn-unit` marker and keys don't change. The unit reference gains a record folder field filled by the resolver from P1: `runs/_story/rounds/NN-<wf>` for the story, `runs/<nn>-<slug>` for a slice. Decide, act and view build paths from it, never from `dir`. The story unit is always the current round, meaning the highest-numbered round folder. Story facts gain `rounds: [{n, workflow, ended}]` for `status`, `story view`, `run list` and the handoff header. Unit state gains an optional `round` (absent = 1) and an optional `ended {by: workflow | person, step, at, receipt_id}`. A slice's state records `round`, the story round that started it (B33). The `unit_dir` pattern in state is unchanged. Why: the dir-is-the-round-folder alternative would change the `unit_dir` schema, hook keys and markers for no gain.
- D3 **What `story edit` refuses, and in what order.** First the claim held elsewhere (T9, B18). Then an unknown or invalid workflow (B17). Then an unknown `--at` step (B9, B15). Then, on an unfinished round without `--force` (B10), it refuses with the `--force` command in `do_instead`. With `--force` it refuses while an agent runs a step of the round, pointing to `norn run cancel` (B12), and while any slice is unfinished, naming it (B13). `--at` alone on a finished round is refused and points to `--workflow` (B16). All refusals exit 3 and write nothing. `--force` on a finished round is ignored (B14). `--at` without `--workflow` stops being a usage error.
- D4 **On a story, `--workflow X --at s` no longer switches the workflow in place.** It always starts a round. `--at s` alone moves the cursor inside the round, journaled as today's `workflow` receipt with the same workflow and hash (B15). Slices keep today's in-place `--workflow X --at s`, because slices have no rounds. S7's tested phrase stays in the PRD.
- D5 **Remote changes on a finished round.** GR6b fires only when the issue is seen as `closed` (not `null` or unobserved), with no PR and no unfinished slice. It emits a new close action that calls the effects from P2, so `story reopen` works unchanged (B23). A finished round is never parked by GR7 for a missing label, an unassigned issue or an unseen issue. Each of those becomes a Check item, and the round stays finished. A PR closed without a merge still parks, as GR7 says. A story an older norn parked as `remote` while at `$done` is read as a finished round, and the first tick drops the park (B35). This also fixes the current bug where GR7 rewrites a `$done` story to `stuck`.
- D6 **Inbox.** A finished round with no PR is a **Your turn** item: "<story>: <workflow> round done, no PR". Its command is `norn story edit <story> --workflow <name>`, with "or close the issue" as detail. It shows no recommendation (B25, B26) and replaces the "workflow done — waiting for the PR merge (GR6)" item. With an open PR the merge item stays (B27). Decide's noop for a finished round is renamed from waiting for the merge to "round done", and its rule id becomes `story.round_done`.
- D7 **Moving flat records (B34, B35).** A new rule, `round.migrate`, runs first for a story this heartbeat holds whose `runs/_story/state.json` sits directly in the folder. It runs before receipts and anything else, and never during a rebase (H1). Act moves everything under `runs/_story/` except `handoff.md` (state, workflow.yaml, receipts, logs, evidence, orphaned) into `rounds/01-<state.workflow>/` with `git mv`, in one commit, then pushes. Paths stored in receipts are relative to the round, so they stay valid. Slice folders are not touched. Read-only commands (`run list`, `run view`, the view and the trace view) read a flat record as round 1 and never write it (B36).
- D8 **Slices belong to the whole story.** A later round's `slices` step sees every slice file. Integrated or dropped slices count as finished, and only new or unfinished ones run. Slice numbers keep growing across rounds, as the slice skill already says (append, never renumber).
- D9 **Label (B19, B20).** The round-start action swaps the issue's `norn:wf:<old>` for `norn:wf:<new>` through the port method from P3. A failure becomes a warning in the action result and the trace, never a failed action. A label edited on the remote is never read as a request to start a round.
- D10 **The handoff header and views** show "Round N · Workflow: <wf> · Step: <step> (attempt k)". `run list` prints a heading for each round, "round N · <wf>", and how it ended: finished, or ended by the person at <step>.
- D11 **Prompt text.** Where the `triage` and `reproduce` workflows' gate prompts say a done story without a PR waits for a merge, they are corrected to say that approving ends the round and the next round starts with `norn story edit <story> --workflow <name>`. The gates themselves don't change.

### Testing decisions

- A good test drives a command or a tick through S1, or calls `decide` / `buildInbox` with Facts through S2, and checks only what a person or the next tick sees: output and exit codes, files under `runs/`, commits, inbox items, recorded remote calls. Never internal helpers, never the resolver directly.
- Only system boundaries are faked: the remote (fake remote, including a failing label call), the runner (fake runner, which stands in for a running agent in B12), and the clock. Real git and real files are used in S1.
- New rule ids (`round.start`, `round.migrate`, `story.round_done`, the GR6b close rule, the finished-round remote Check item, the rejected-round-receipt case) each get a rule case or a harvested golden case. The existing golden decisions that change (renamed wait rule, finished-round GR7) are rewritten with `golden --update` and reviewed.
- The prefactors land with the existing suites green and no new tests, except the contract runs for the new port method in P3.
- Transcripts, observe snapshots, the brief snapshot and the view fixtures are regenerated in the slice that moves the record, and their diffs reviewed as the layout change.

### Risks

- **The path move is wide.** About ten readers and writers, plus many tests, hard-code `runs/_story`. A missed one reads an empty folder and silently treats the story as not started. Mitigation: P1 lands first. The slice that switches the resolver to round folders runs the whole integration and e2e tiers, and the regenerated transcripts show every path that moved.
- **The move of flat records runs on live stories on every checkout.** Two clones could each try it. Only the claim holder decides it (T7), and it happens in one commit. A clone without the claim keeps reading the flat record as round 1 until it fetches. The B34 test should include a story with receipts, logs and evidence, so the relative paths are checked after the move.
- **Receipt order across rounds.** The `round` receipt lives in the old round, and the new round's receipts start at 0001. A mailbox receipt made for the old round's cursor must be rejected as stale once round 2 starts. This is covered in S1 with a second clone, using the existing mailbox setup.
- **GR6b closes a story without a person running a command.** A wrong "closed" fact would close active work. Mitigation: it fires only on an observed `closed` issue with the round finished and no PR. It reuses `story close`'s push-first effects, so nothing is lost and `story reopen` brings the story back.
