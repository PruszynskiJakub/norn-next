# Parity: the old decide's rules and actions in the kernel

Every rule id the old decide (`packages/core/src/decide/`) can emit, and every old `Action` kind,
mapped to the kernel rule and action that replace it, to a plugin step kind, or to `dropped: <reason>`.
The kernel's rule ids are the stable strings in `src/decide/rules.ts` (`RULE_IDS`); each one appears in
the New rule column below, and `test/unit/parity.test.ts` holds this file to that list, to every old
rule id the old golden corpus and rule cases fire, and to every action kind on both sides. The
golden corpus (`test/golden/`) fires every new rule id at least once.

Placeholders in old ids: `<base>` is a classified agent rule (`agent.died`, `agent.died.foreign`,
`agent.died.launch_unknown`, `agent.timeout`, `agent.silent`, `agent.silent.launch_prompt`,
`agent.stalled`); `<route>` is where the routed outcome sent the unit (a step name, `$done`, `$stuck`,
`park`); `<action>` is a git step's action (`integrate`, `push`, `open-pr`, `update`); `<kind>` is a
park kind (`ask`, `gate`, `merge`, `attended`). Every combination the old engine fired is also written
out in full below.

Where a new action is `apply_receipts (X)`, decide writes receipt X through the action's `receipts`
and commits the state applyReceipts computes, all in one act. A refusal (`rejected`) is among those
`receipts` as a `receipt.rejected`, written after what was refused and applied in the same commit, so
recording it costs no tick of its own. A `park` writes a `unit.parked` receipt and commits the state that
applies it (a unit with no run state keeps the receipt alone, and the same park on its record is held
as `unit.parked`), so state and facts agree and a park is never sent twice. A `mark_corrupt` writes a
`unit.marked` corrupt receipt, appended even to a record that fails validation, which the journal reads
back as the unit's `corrupt_marked` fact.

## Rule ids

### Tick-wide (old `decide/index.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `leases.reclaim` | `reclaim_leases` | dropped: machine slot leases belong to the host, not decide | |
| `worktree.marker` | `restore_markers` | dropped: worktree markers belong to the host | |
| `remote.intake` | `intake_story` | `intake.story` | `intake_story` (one per open item not yet a story, when a tracker is configured), on the workflow a `norn:wf:<name>` label names (prefix `intakeWorkflowLabelPrefix`) when that workflow loads, else `config.workflow`; the label is read once, as the person's choice |

### Claims and the story's record (old `decide/story.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `claim.acquire.intake` | `claim` | `claim.take` | `claim` (expect_version null), with `claim.pending` (`noop`) for every unit that tick |
| `claim.reacquire` | `claim` | `claim.reacquire` | `claim` (expect_version of this machine's expired claim), with `claim.pending` for every unit |
| `claim.reacquire.merged` | `claim` | dropped: a merged change ends the story (`story.change_merged`), which needs no claim to read | |
| `claim.renew` | `claim` | `claim.renew` | `renew_claim` (a story action: the units keep their action of the tick) |
| `claim.other` | `noop` | `claim.held_elsewhere` | `noop` for every unit; another holder's expired claim is left to a person too, who moves it with `norn story take --force` (the store's `claims.takeOver`, recorded as a `claim.taken` receipt on the story's own unit, applied as a no-op to the run state wherever the unit stands) |
| `claim.corrupt` | `noop` | dropped: a store validates its own claim envelope and answers a failure, never a corrupt claim | |
| `claim.unclaimed` | `noop` | `claim.none` | `noop` for every unit (in progress and unclaimed: a person takes it over with `norn story take`, recorded as `claim.taken`) |
| (none) | | `claim.pending` | `noop` (the claim is taken or reacquired this tick; units wait for it) |
| (none) | | `claim.release` | `release_claim` (nothing of the story is left open) |
| (none) | | `story.finish` | `finish_story` before `release_claim`: remove the worktrees of units that ended done; close the item when the story ended done, its change merged, the item is open and `capabilities.tracker.close` |
| `story.finished` | `noop` | `story.ended` | `noop` |
| `story.corrupt` | `mark_corrupt` | `unit.corrupt` | `mark_corrupt` (each unit whose record fails validation, once: its `unit.marked` receipt is read back as `corrupt_marked`; there is no story-wide record to fail) |
| `story.record_only` | `noop` | dropped: a record without a branch is an old-layout case; the store holds the record | |
| `start.record_unplaced` | `noop` | dropped: the store holds the record; there is nothing to place | |
| `round.migrate` | `round_migrate` | dropped: old on-disk layout | |
| `record.released` | `set_aside_record` | dropped: the store's compare-and-swap settles a lost race, and the journal re-reads | |
| `record.superseded` | `set_aside_record` | dropped: same as `record.released` | |
| `record.push` | `push_record` | `store.flush` | `flush` (shared stores only, by `capabilities.store.shared`, after the story's other decisions) |
| (none) | | `store.diverged` | `noop` for every unit of a held story whose run data in this clone and on the remote diverged (the store's `unsynced` fact), and no `flush`; the claim is still renewed, and a person carries the story on from the remote's record with `norn story take --force` |
| `recover.commit` | `commit_push` | dropped: run state is committed through the store, never git | |

### Tracker and forge facts (old `decide/story.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `remote.pr_merged` | `cleanup_merged_story` | `story.change_merged` | `mark_done` (`unit.marked` done) for every unit not ended; `claim.release` follows once nothing is open |
| `remote.issue_closed` | `close_story` | `story.item_closed` | `apply_receipts` (`unit.marked` stuck, reason: the item closed); `claim.release` follows |
| (none) | | `story.change_merged.stop`, `story.item_closed.stop` | `stop_run` (with a `stop.sent` intent) when the unit's run may still be going (an agent session not ended, a check or step run running) and no stop was ordered; the mark follows the next tick, the order applied with it |
| `remote.park` | `park` | `story.change_closed` | `park` (inbox `stuck`: the change closed unmerged), at any step once no receipt waits and no run is live, so a story polled at merge parks too |
| (none) | | `story.change_merged_elsewhere` | `park` (inbox `stuck`: the change merged into a branch other than the config's base), under the same conditions as `story.change_closed`; the story is not ended and its worktree stays |
| `remote.unpark_finished` | `apply_receipts` | dropped: a park the facts no longer support is lifted by a person's receipt, never by decide reading a tracker | |
| `story.halted` | `noop` | `unit.parked` | `noop` (the unit waits on its park) |
| `remote.mirror` | `update_story_mirror` | dropped: labels and comments are display; the host's tracker plugin mirrors after a commit, decide never reads them back | |
| `remote.mirror.body_changed` | `update_story_mirror` | dropped: decide never reads an item's body | |
| `remote.mirror.refined` | `update_story_mirror` | dropped: same as `remote.mirror` | |
| `remote.pr_title` | `retitle_pr` | dropped: forge display; an `open-pr` step kind sets the title it opens with | |

### Mailbox and rounds (old `decide/story.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `mailbox.import` | `import_mailbox` | `mailbox.import` | `import_mailbox` (letters that validate and name a unit of the story) |
| `mailbox.reject` | `reject_receipt` | `mailbox.reject` | `import_mailbox` (a letter failing `MailboxLetter` is acknowledged and recorded as `receipt.rejected`) |
| `round.start` | `round_start` | `round.start` | `apply_receipts` (`round.started` and the new run state, entered at its `at` step or the workflow's start, an `at` the workflow lacks refused onto the record; written by `norn story round`, which first records `unit.marked` stuck when `--force` ends a round under way) |
| `round.reject` | `reject_receipt` | `receipts.reject` | `apply_receipts` (rejected: a `round.started` written for another step or attempt) |
| `round.workflow_changed` | `reject_receipt` | `round.workflow_invalid` | `apply_receipts` (rejected: the round pins a workflow decide cannot load) |
| (none) | | `unit.move` | `apply_receipts` (a person's `step.moved`, written by `norn run rerun`: the unit enters the step as a fresh visit with no run and no park, the named counters at 0, a unit that ended stuck taken up again; a `stop.sent` that follows it for the run it takes off the record is applied with it) |
| (none) | | `unit.move.stop` | `stop_run` (with a `stop.sent` intent) when the unit's run may still be going, before the move is applied the next tick; a move apply would refuse (a unit that ended done, another visit, a step or counter the pinned workflow lacks, a story whose change merged or item closed) is refused at once as `receipts.reject` |
| (none: the old `norn story update-branch` sent the story back through its update step) | | `receipts.apply` | `apply_receipts` (a person's `branch.update` intent and its `branch.updated` outcome, written by `norn story update-branch` under the story's claim through the act protocol: the intent before it merges the base into the branch of a story whose round ended, the outcome after the push; both applied as no-ops wherever the unit stands, so the story finishes again, the worktree of a unit that ended done removed, and gives its claim up. An intent with no outcome is an update cut short, which the next run of the verb finishes under the same intent) |
| `story.start` | `start_unit` | `round.start` | `apply_receipts` (`round.started`, `newRunState`) |
| `start.workflow_invalid` | `mark_corrupt` | `round.workflow_invalid` | `park` (inbox `workflow`: the workflow fails to load, a `missing_kind` named) |
| `start.no_worktree` | `noop` | dropped: the host makes the worktree as part of the act; decide does not see worktrees | |

### Unit lifecycle (old `decide/story.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `unit.corrupt` | `mark_corrupt` / `noop` | `unit.corrupt` (mark), `unit.corrupt.held` (already marked: an ended corrupt state, or `corrupt_marked` on a record that fails validation) | `mark_corrupt` / `noop` |
| `unit.workflow_missing` | `mark_corrupt` | `unit.workflow_missing` | `mark_corrupt` (the pinned hash is in no loaded workflow) |
| `workflow.drift` | `park` | dropped: a unit runs its pinned workflow by hash; a changed file affects only a new round | |
| `unit.rebase_in_progress` | `noop` | dropped: worktree state belongs to the repository plugin's step kinds | |
| `unit.no_step` | `noop` | `unit.workflow_missing` | `mark_corrupt` (the pinned workflow has no such step: it fails validation) |
| `unit.stuck` | `noop` | `unit.ended.stuck` | `noop` |
| `slice.done` | `noop` | `unit.ended.done` | `noop` |
| `story.round_done` | `noop` | `unit.ended.done` | `noop` |
| `slice.done.cleanup` | `commit_push` | dropped: worktree cleanup belongs to the host after the unit ends | |
| `slice.not_started` | `noop` | `slice.not_started` | `noop` |
| `unit.parked.<kind>`: `unit.parked.ask`, `unit.parked.gate`, `unit.parked.merge`, `unit.parked.attended` | `noop` | `unit.parked` | `noop` (a merge no longer parks: `await-merge` is polled with `step.poll`) |
| (none) | | `unit.unpark` | `apply_receipts` (no receipts: a park decide derived from facts whose cause is gone is lifted) |
| `receipts.apply` | `apply_receipts` | `receipts.apply` | `apply_receipts` |
| `receipts.apply.resume` (`${rule}.resume`) | `apply_receipts` | `receipts.apply` | `apply_receipts` (`answer.sent` lifts the park; the host delivers the answer to the live session, so there is no resume rule) |
| (none) | | `receipts.apply.undelivered` | `apply_receipts` naming the `answer.sent` receipts in `undelivered`: the run's session ended and its executor cannot resume one, or none of its events are on this machine (a story taken from another machine), so the host applies them without delivering, the ended session is retried next tick, and the retry's brief carries the answers (delivered, it would be refused on every tick and the unit would stay parked) |
| `receipts.reject` | `reject_receipt` | `receipts.reject` | `apply_receipts` (every unapplied receipt refused, each recorded as `receipt.rejected` in the same act and applied with it) |

### Slices (old `decide/steps.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `slices.start` | `start_slices` | `slices.start` | `start_slices` |
| `slice.start` | `start_unit` | `slices.start` | `start_slices` (each slice's first state is committed by the host's act) |
| `slices.wait` | `noop` | `slices.wait` | `noop` |
| `slices.done` | `classify` | `slices.done` | `apply_receipts` (`step.finished` slices done) |
| `slices.none` | `classify` | `slices.none` | `apply_receipts` (`step.finished` slices stuck) |
| `slices.blocked` | `classify` | `slices.blocked` | `apply_receipts` (`step.finished` slices stuck) |
| `slices.slice_stuck` | `classify` | `slices.slice_stuck` | `apply_receipts` (`step.finished` slices stuck) |
| `slices.file_invalid` | `noop` | `slices.plan_invalid` | `park` (inbox `stuck`, from `plan.invalid`) |
| `slices.workflow_invalid` | `park` | `slices.workflow_invalid` | `park` (inbox `workflow`) |
| `slices.resume` | `apply_receipts` | dropped: a person's receipt resumes a stuck unit; decide does not unstick | |

### Checks, gates and git steps (old `decide/steps.ts`, `decide/story.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `check.run` | `run_check` | `check.run` | `run_check` (with its `run.started` intent) |
| (none) | | `check.rerun` | `run_check` under the run on the record, with a `run.resumed` intent (recorded, never answered: the host stopped before it ran, or it could not run), while `run.resumes` < `maxRetries` |
| (none) | | `check.rerun.exhausted` | `apply_receipts` (`unit.marked` stuck, naming the retries spent and the host's `step_run.error`) |
| (none) | | `check.finished.rejected` | `park` (inbox `stuck`: the check answered an outcome the step does not declare; no receipt is written, so nothing repeats each tick) |
| `check.running` | `noop` | `check.running` | `noop` |
| (none) | | `check.finished` | `apply_receipts` (`check.finished` from the check's answered outcome) |
| `check.queued` | `noop` | dropped: every due check starts; no cap bounds the runs at once | |
| `check.no_worktree` | `noop` | dropped: the host resolves the worktree when it runs the check | |
| `verify.run` | `run_check` | folded into `base_stale`: the host runs the vcs plugin's `verify-base` step kind on a clean base move under a story waiting at a step that routes `stale`, once per (head, base) pair, and a red merged tree reads as `base_stale` | then `gate.stale` or `step.stale` (the failing output is not handed to the next step as `last_check`) |
| `verify.awaits_sync` | `noop` | dropped: as `verify.run` | |
| `gate.wait` | `noop` | `gate.park` (entering), then `unit.parked` | `park` (inbox `gate`, the gate's prompt) |
| `gate.stale` | `classify` | `gate.stale` | `apply_receipts` (`step.finished` gate stale, from `base_stale`) |
| `gate.stale.awaits_sync` | `noop` | dropped: the host gathers fresh facts before decide | |
| `gate.carried` | `apply_receipts` | dropped: decide never decides a gate; a light path is a route the workflow names | |
| (none) | | `step.stale` | `apply_receipts` (`step.finished` stale at a `wait` step kind, from `base_stale`, between polls; `await-merge` never answers `stale` itself, since the base policy is the workflow's) |
| `merge.wait` | `noop` | `step.poll` | `run_step` (step kind `await-merge`, mode `wait`, no intent after the first poll) |
| `open_pr.guard` | `classify` | `gate.unpushed` (a gate), `step.unpushed` (a `wait` step kind, between polls) | `apply_receipts` (`step.finished` unpushed, from the story's `unpushed` fact, the story's own unit only); the workflow routes `unpushed` back to its open-pr step (`shared/ship.yaml`'s `ready` and `merge` gain `unpushed: open-pr` as mechanical edits), counted as a stale route is, where the old engine took it with no edge and no counter |
| `open_pr.guard.awaits_sync` | `noop` | dropped: as `gate.stale.awaits_sync` | |
| `git.integrate` | `run_git` | `step.run` | `run_step` (step kind `integrate`, mode `effect`) |
| `git.push` | `run_git` | `step.run` | `run_step` (step kind `push`, mode `effect`) |
| `git.open-pr` | `run_git` | `step.run` | `run_step` (step kind `open-pr`, mode `effect`) |
| `git.update` | `run_git` | `step.run` | `run_step` (step kind `update-branch`, mode `effect`) |
| (none) | | `step.resume` | `run_step` under the run on the record, with a `run.resumed` intent (an effect recorded but never answered was cut short, or its plugin failed; the plugin is idempotent by run id), while `run.resumes` < `maxRetries` |
| (none) | | `step.resume.exhausted` | `apply_receipts` (`unit.marked` stuck, naming the retries spent and the host's `step_run.error`) |
| `git.<action>.queued`: `git.integrate.queued`, `git.update.queued`, `git.push.queued`, `git.open-pr.queued` | `noop` | `step.running` | `noop` (one run of a step kind per unit; serializing integrations is the plugin's) |
| `git.no_worktree` | `noop` | dropped: the host resolves the worktree for `run_step` | |
| `git.update.no_base` | `noop` | dropped: the `update-branch` step kind reports its own failure | |
| (none) | | `step.finished` | `apply_receipts` (`step.finished` from the step run's outcome) |
| (none) | | `step.finished.rejected` | `park` (inbox `stuck`: the step kind answered an outcome it does not declare; no receipt is written) |

### Agent steps (old `decide/agent.ts`)

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `agent.start` | `start_run` | `agent.start` | `start_run` |
| `agent.start.retry` | `start_run` | `agent.died.retry`, `agent.silent.retry`, `agent.turn_ended.retry`, `agent.limited.retry` | `retry_run` (the fresh session is decided where the old run is judged) |
| `agent.ready.manual` | `noop` | `agent.ready.manual` | `park` (inbox `manual`), until a person starts the step's agent with a `run.requested` receipt (`norn run start`), which lifts it for that visit only and has the run judged as an auto run |
| `agent.ready.manual.no_runner` | `noop` | `agent.ready.no_headless` | `park` (inbox `manual`: auto mode, the executor lacks `headless`) |
| (none) | | `agent.no_executor` | `park` (inbox `stuck`: the step's executor is not configured) |
| (attended) | `noop` | `agent.ready.attended` | `park` (inbox `attended`) |
| `agent.queued` | `noop` | dropped: every due agent starts; no cap bounds the runs at once | |
| `agent.start.wait_active` | `noop` | dropped: the act protocol records a run before launching it, so no second run starts beside one on the record | |
| `agent.no_worktree` | `noop` | dropped: the host resolves the worktree for `start_run` | |
| `agent.running` | `noop` | `agent.running` | `noop` |
| `agent.attended.running` | `noop` | `agent.running` | `noop` |
| `agent.running.unobserved` | `noop` | `agent.unobserved` | `noop` (a run on the record, no session facts yet) for `silentAfterMs`, then judged by the died rules |
| `agent.running.foreign` | `noop` | dropped: the claim makes one machine the story's only actor | |
| `run.adopt` | `apply_receipts` | dropped: `run.started` is written before the launch, so a run is never found without its record | |
| `run.launch_unknown.wait` | `noop` | `agent.unobserved` | `noop` while a recorded launch has shown no session for less than `silentAfterMs`; after it, `agent.died.retry` / `agent.died.exhausted` |
| `agent.launch_prompt.resend` | `nudge` | dropped: typing into a pane is harness-specific; a session that never starts ends `died` | |
| `agent.ask.implicit` | `park` | `agent.permission.park` | `park` (inbox `permission`, from `session.permission`, its text naming the call it asks about) |
| `agent.ask.implicit` (trust prompt) | `park` | `agent.no_events.park` | `park` (inbox `permission`) once a run whose process still runs in a pane has sent no event for `silentAfterMs`, or at once when its runner reads a dialog in the pane (`run_dialog`): its hooks never loaded, as behind a trust dialog; lifted by its first event |
| `agent.ask.implicit.resolved` | `apply_receipts` | dropped: the session reducer clears the permission on the next event; nothing to record | |
| (explicit ask) | (verb receipt) | `agent.asking.park` | `park` (inbox `ask`, from `session.ask`) |
| (none) | | `agent.ask.route` | `apply_receipts` (`run.classified` ask: the step routes `ask`) |
| (none) | | `agent.limited.wait` | `noop` until `limit.resets_at`; never a nudge, and never stopped by the deadline, which counts from the reset |
| (none) | | `agent.limited.record` | `apply_receipts` (`run.limited`: the reset kept on the run as `limited_until`, once per reset) |
| (none) | | `agent.limited.unknown` | `park` (inbox `limited`: a limit with no reset time, shown to a person rather than waited on unseen) |
| (none) | | `agent.reported` | `apply_receipts` (the `run.reported` receipt) |
| (none) | | `agent.reported.rejected` | `park` (inbox `stuck`: the report would be refused, e.g. an outcome the step does not declare; nothing is written, and a new report is applied as it comes) |
| (none) | | `agent.retry.no_headless` | `park` (inbox `stuck`: a fresh session is needed and the executor cannot run headless) |
| `answer.resume.wait_active` | `noop` | dropped: as `agent.start.wait_active` | |
| `answer.resume.queued` | `noop` | dropped: an answer is delivered to the live session, never by starting one | |
| `agent.nudge.queued` | `noop` | dropped: a nudge waits on nothing | |

### Classified agent rules (old `<base>.<suffix>`)

The old engine classified a run (`<base>`), then named what it did with the outcome as a suffix. The
kernel judges a run from its classified session: a dead session (`agent.died`), a run past its
deadline (`agent.timeout`), and a quiet one (`agent.silent`, `agent.turn_ended`, `agent.limited`, the
last once its limit reset), each with these suffixes:

| New suffix | New action | Meaning |
|---|---|---|
| `.route` | `apply_receipts` (`run.classified`) | the step routes the outcome (`silent`, `died`, `timeout`, `ask`) |
| `.nudge` | `nudge` | a quiet agent nudged, bounded by the step's `nudges` |
| `.nudged` | `noop` | a nudge sent within the silent window is still on its way |
| `.manual` | `park` (inbox `stuck`) | manual mode: the person driving the run decides |
| `.retry` | `retry_run` | a fresh session, bounded by the step's `retries` (a quiet one only when the executor takes no input) |
| `.exhausted` | `apply_receipts` (`run.classified`) | nudges or retries ran out: the unit ends stuck naming the limit |

New rule ids: `agent.died.route`, `agent.died.manual`, `agent.died.retry`, `agent.died.exhausted`,
`agent.timeout` (`stop_run`; the session's end is then judged by the died rules), `agent.timeout.route`,
`agent.silent.route`, `agent.silent.nudge`, `agent.silent.nudged`, `agent.silent.manual`,
`agent.silent.retry`, `agent.silent.exhausted`, `agent.turn_ended.route`, `agent.turn_ended.nudge`,
`agent.turn_ended.nudged`, `agent.turn_ended.manual`, `agent.turn_ended.retry`,
`agent.turn_ended.exhausted`, `agent.limited.route`, `agent.limited.nudge`, `agent.limited.nudged`,
`agent.limited.manual`, `agent.limited.retry`, `agent.limited.exhausted`.

| Old rule | Old action | New rule | New action |
|---|---|---|---|
| `agent.died` | `classify` | `agent.died.route`, `agent.died.manual`, `agent.died.retry`, `agent.died.exhausted` | as below |
| `agent.died.retry` | `retry_fresh` | `agent.died.retry` | `retry_run` |
| `agent.died.<route>`, `agent.died.route`, `agent.died.park` | `classify` | `agent.died.route` | `apply_receipts` (`run.classified` died) |
| `agent.died.stuck`, `agent.died.$stuck` | `classify` | `agent.died.exhausted` | `apply_receipts` (`run.classified` died: retries ran out) |
| `agent.died.surface` | `classify` | `agent.died.manual` | `park` (inbox `stuck`) |
| `agent.died.foreign`, `agent.died.foreign.retry` | `classify` / `retry_fresh` | dropped: the claim makes one machine the story's only actor | |
| `agent.died.launch_unknown`, `agent.died.launch_unknown.retry` | `classify` / `retry_fresh` | `agent.died.retry`, `agent.died.exhausted` | as `agent.died`: a session that never started reads as ended |
| `agent.timeout` | `classify` | `agent.timeout` | `stop_run` with a `stop.sent` intent, sent once; then judged as `agent.died` unless the step routes `timeout` |
| (none) | | `agent.timeout.stopping` | `noop` while a stop ordered less than `silentAfterMs` ago has not ended the session; past that the run is judged by the died rules |
| `agent.timeout.<route>`, `agent.timeout.route` | `classify` | `agent.timeout.route` | `apply_receipts` (`run.classified` timeout) |
| `agent.timeout.nudge`, `agent.timeout.nudge.resume` | `nudge` | dropped: a run past its deadline is stopped, never nudged | |
| `agent.timeout.surface` | `classify` | `agent.died.manual` | `park`, once the stopped session reads as ended in manual mode |
| `agent.timeout.retry` | `retry_fresh` | `agent.died.retry` | `retry_run`, once the stopped session reads as ended |
| `agent.timeout.stuck`, `agent.timeout.$stuck` | `classify` | `agent.died.exhausted` | as `agent.died` |
| `agent.silent` | `classify` | `agent.silent.*` (a quiet session), `agent.turn_ended.*` (a turn ended without a report) | as below |
| `agent.silent.nudge` | `nudge` | `agent.silent.nudge`, `agent.turn_ended.nudge` | `nudge` (bounded by the step's `nudges`) |
| `agent.silent.nudge.resume` | `nudge` | `agent.silent.retry` | `retry_run`: a harness without input in a live session gets a fresh one; resuming is the host's way to deliver a nudge, not a rule |
| `agent.silent.surface` | `classify` | `agent.silent.manual`, `agent.turn_ended.manual` | `park` (inbox `stuck`: manual mode) |
| `agent.silent.retry.no_nudge` | `retry_fresh` | `agent.silent.retry`, `agent.turn_ended.retry` | `retry_run` (the executor takes no input in a live session, by capability) |
| `agent.silent.<route>`, `agent.silent.route`, `agent.silent.park` | `classify` | `agent.silent.route`, `agent.turn_ended.route` | `apply_receipts` (`run.classified` silent) |
| `agent.silent.stuck`, `agent.silent.$stuck` | `classify` | `agent.silent.exhausted`, `agent.turn_ended.exhausted` | `apply_receipts` (`run.classified` silent: nudges ran out) |
| `agent.silent.launch_prompt`, `agent.silent.launch_prompt.nudge` | `classify` / `nudge` | dropped: as `agent.launch_prompt.resend` | |
| `agent.stalled` | `classify` | `agent.stalled.route`, `agent.silent.*` | a session with no activity (the reducer's `silent`) takes the step's `stalled` route when it has one, else the silent rules |
| `agent.stalled.nudge` | `nudge` | `agent.silent.nudge` | `nudge` |
| `agent.stalled.route`, `agent.stalled.<route>` | `classify` | `agent.stalled.route` | `apply_receipts` (`run.classified` stalled), ahead of a `silent` route; a turn ended without a report and a limit waited out stay `silent` |
| `agent.stalled.surface` | `classify` | `agent.silent.manual` | `park` |
| `agent.stalled.stuck` | `classify` | `agent.silent.exhausted` | `apply_receipts` |

## Action kinds

| Old action | New action |
|---|---|
| `apply_receipts` | `apply_receipts` |
| `start_unit` | `apply_receipts` (`round.started` and `newRunState`) |
| `start_run` | `start_run` |
| `nudge` | `nudge` |
| `retry_fresh` | `retry_run` (the host stops `previous_run_id` first) |
| `run_check` | `run_check` |
| `run_git` | `run_step` (step kinds `integrate`, `push`, `open-pr`, `update-branch`) |
| `start_slices` | `start_slices` |
| `classify` | `apply_receipts` (`run.classified` or `step.finished`), or `nudge` / `retry_run` / `park` |
| `park` | `park` |
| `mark_done` | `mark_done` |
| `commit_push` | dropped: run state is committed through the store, never git |
| `reject_receipt` | `apply_receipts` (rejected, recorded as `receipt.rejected` among its `receipts`) |
| `mark_corrupt` | `mark_corrupt` |
| `import_mailbox` | `import_mailbox` |
| `claim` (acquire / renew / release) | `claim` / `renew_claim` / `release_claim` |
| `notify` | `notify` (declared for the host's inbox; no rule emits it yet, since every inbox item travels on the `park` that raises it) |
| `update_story_mirror` | dropped: tracker display, mirrored by the host after a commit |
| `retitle_pr` | dropped: forge display, set by the `open-pr` step kind |
| `cleanup_merged_story` | `mark_done`, then `finish_story` (done worktrees removed, the item closed) and `release_claim`; a round that ends done with no merged change is finished too, its item left open for the next round |
| `close_story` | `apply_receipts` (`unit.marked`), then `release_claim`; a stuck unit keeps its worktree |
| `round_migrate` | dropped: old on-disk layout |
| `round_start` | `apply_receipts` (`round.started`) |
| `noop` | `noop` |
| `intake_story` | `intake_story` |
| `push_record` | `flush` |
| `set_aside_record` | dropped: the store's compare-and-swap settles a lost race |
| `restore_markers` | dropped: worktree markers belong to the host |
| `reclaim_leases` | dropped: machine slot leases belong to the host |
| (none) | `stop_run`, `run_step`, `renew_claim`, `release_claim`, `finish_story`, `flush` are new |
