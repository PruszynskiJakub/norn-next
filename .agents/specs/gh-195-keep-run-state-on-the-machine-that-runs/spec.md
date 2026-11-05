---
id: gh-195
slug: keep-run-state-on-the-machine-that-runs
provider: gh
number: 195
url: https://github.com/PruszynskiJakub/norn-next/issues/195
title: Keep run state on the machine that runs it, and hand it over only when asked
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:story
workflow: story
status: done
intake_at: 2026-11-04T08:34:16.652Z
body_hash: daab49a1f6e19f9adece43a08de2e7ee1559163b2e979cbaa5e838e337c7bb9f
criteria:
  - { id: "01.AC1", verifier: test }
  - { id: "01.AC2", verifier: test }
  - { id: "02.AC1", verifier: test }
  - { id: "02.AC2", verifier: test }
  - { id: "03.AC1", verifier: test }
  - { id: "03.AC2", verifier: test }
  - { id: "04.AC1", verifier: test }
  - { id: "04.AC2", verifier: test }
  - { id: "05.AC1", verifier: test }
  - { id: "05.AC2", verifier: test }
  - { id: "05.AC3", verifier: test }
  - { id: "05.AC4", verifier: test }
  - { id: "05.AC5", verifier: test }
  - { id: "05.AC6", verifier: test }
  - { id: "05.AC7", verifier: test }
  - { id: "06.AC1", verifier: test }
  - { id: "06.AC2", verifier: test }
  - { id: "06.AC3", verifier: test }
  - { id: "06.AC4", verifier: test }
  - { id: "07.AC1", verifier: test }
  - { id: "07.AC2", verifier: test }
  - { id: "07.AC3", verifier: test }
  - { id: "07.AC4", verifier: test }
  - { id: "07.AC5", verifier: test }
  - { id: "07.AC6", verifier: test }
  - { id: "08.AC1", verifier: test }
  - { id: "08.AC2", verifier: test }
  - { id: "08.AC3", verifier: test }
  - { id: "08.AC4", verifier: test }
  - { id: "08.AC5", verifier: test }
  - { id: "08.AC6", verifier: test }
  - { id: "08.AC7", verifier: test }
  - { id: "09.AC1", verifier: test }
  - { id: "09.AC2", verifier: test }
  - { id: "09.AC3", verifier: test }
  - { id: "09.AC4", verifier: test }
  - { id: "10.AC1", verifier: test }
  - { id: "10.AC2", verifier: test }
  - { id: "10.AC3", verifier: test }
  - { id: "10.AC4", verifier: test }
  - { id: "11.AC1", verifier: test }
  - { id: "11.AC2", verifier: test }
  - { id: "11.AC3", verifier: test }
  - { id: "11.AC4", verifier: test }
  - { id: "12.AC1", verifier: test }
  - { id: "12.AC2", verifier: test }
  - { id: "12.AC3", verifier: test }
  - { id: "12.AC4", verifier: test }
  - { id: "12.AC5", verifier: test }
  - { id: "13.AC1", verifier: test }
  - { id: "13.AC2", verifier: test }
  - { id: "13.AC3", verifier: test }
  - { id: "13.AC4", verifier: test }
  - { id: "14.AC1", verifier: test }
  - { id: "14.AC2", verifier: test }
  - { id: "14.AC3", verifier: test }
  - { id: "14.AC4", verifier: test }
  - { id: "15.AC1", verifier: test }
  - { id: "15.AC2", verifier: test }
  - { id: "15.AC3", verifier: test }
  - { id: "15.AC4", verifier: test }
  - { id: "15.AC5", verifier: person }
  - { id: "16.AC1", verifier: test }
  - { id: "16.AC2", verifier: test }
  - { id: "16.AC3", verifier: test }
  - { id: "16.AC4", verifier: test }
  - { id: "16.AC5", verifier: test }
  - { id: "16.AC6", verifier: test }
  - { id: "17.AC1", verifier: test }
  - { id: "17.AC2", verifier: test }
  - { id: "17.AC3", verifier: test }
  - { id: "17.AC4", verifier: test }
  - { id: "18.AC1", verifier: test }
  - { id: "18.AC2", verifier: agent }
merge:
  pr: 216
  url: https://github.com/PruszynskiJakub/norn-next/pull/216
  head_sha: 13540716f90109f03aa462879989da663d855044
  merge_commit_sha: 3ba417502b79aba55cf071c959fc73a264f3573b
  merged_by: PruszynskiJakub
  merged_at: 2026-11-05T16:10:14.000Z
---

# Keep run state on the machine that runs it, and hand it over only when asked

## Problem

Every step boundary commits a unit's run state (state, receipts, pinned workflow, check logs, QA evidence, handoff.md) to the story branch and pushes it, and the merged PR leaves it on the base branch as the record (S8, GR6). People pay for that in four ways:

- **Reviewers** wade through norn's files in every PR. #106 changed 39.7k lines, of which 32.4k were run state; collapsing them (S10) hides them on GitHub and GitLab but not in a local diff, a `git log -p` or a review tool.
- **Everyone who clones** carries it. This repository's main holds about 1,870 run-state files (about 10 MB of blobs), and it grows with every story.
- **The person whose story is running** gets bitten when the branch moves under it: a rebase or reset rewinds live state (#101, #97, #79), and the boundary commit sweeps norn's files and other work together (#92).
- **A person on a second machine** sees "local work on gh-9 is not in the record" Check items and `orphaned/` folders (T7a, R2.3), which exist only because run state travels on the branch.

All of this is paid on every step so that a story can be taken over from git alone (G3), and handing a story to another machine or person is rare.

## Solution

Run state lives on the machine that runs the story, in that checkout's machine dir, and the story branch and its PR carry only the work and the story's handoff.md (prose only). When the record has to leave the machine, norn packs it into one commit on a per-story ref on the remote, `refs/norn/runs/<story>`, which no branch and no clone ever carries.

A team picks one of two **record policies** in its team config:

- **local** (the default): the record leaves the machine only when the claim is released (`story handoff`, a clean `watch` exit, `story close`), each time `open-pr` opens or updates the PR (so the PR can link evidence), and once at the end as the archive.
- **remote**: the record is pushed to the ref at every step boundary as well, so another machine can always see the current step and take over with the full record even if the holder dies.

Taking over reads the ref when there is one. When there is none (a local-policy holder that died without releasing), `story checkout` restarts the last step from the branch's code with fresh counters, and says the record was lost. When a story finishes, its record stays on the ref for `run list`, `run view` and `norn-retro`; the base branch never receives it. Open stories and the run state already on main are moved over by the next tick and by `norn upgrade`.

## Behaviour

### Where run state lives

- B1 As a person reviewing a story's PR, I want it to contain only the work and the story's handoff.md, so that the diff is the change.
  Example: a story runs implement → review → qa → pr; its PR's changed files are the code, the spec, `pr.md` and `handoff.md`; no `runs/` path appears in the PR, on the story branch or in any slice branch.

- B2 As the person running a story, I want its run state (state, receipts, pinned workflow, logs, evidence) kept in this checkout's machine dir, so that nothing in the working tree or in git holds it.
  Example: while gh-9 runs, `git status` in its worktree never shows run-state files, and `git clean -fdx` in the worktree leaves the story where it was: the next tick goes on from the same step and attempt.

- B3 As the person running a story, I want removing and recreating a unit's worktree to leave its run state alone, so that a worktree is disposable.
  Example: the story worktree of gh-9 is removed while it is parked on an ask; `norn story start gh-9` recreates it, and `norn status` still shows the same ask with the same attempt.

- B4 As the person running a story, I want S1, S2, P6, S3, S5 and S6 to hold for run state in its new place exactly as they do today, so that moving it changes nothing about its safety.
  Example: a receipt file in the machine dir that fails validation marks its unit `corrupt` (S2); parallel slices write only their own unit's folder (S3); a crash between a receipt and `state.json` re-applies on the next tick (S6).

- B5 As the person running a story, I want a step boundary to commit only the agent's work and handoff.md, so that norn's files and my work never land in one commit.
  Example: an agent reports `norn done done`; the boundary commit on the story branch contains the files the agent changed and `handoff.md`, carries the S4 trailers (`Norn-Story`, `Norn-Step`, …), and contains no state, receipt, log or evidence file.

### handoff.md

- B6 As an agent or person working a step, I want handoff.md on the story branch to hold only Goal, Progress and Resume, so that it changes only when someone writes in it.
  Example: a boundary where the agent did not edit handoff.md leaves it untouched in the commit; the file has no generated status header and no heartbeat lines.

- B7 As an agent starting a step, I want the brief to show the status the header used to carry (story, slice, step, attempt, counters, last outcome, next command), so that I lose nothing by its leaving the file.
  Example: `norn brief` on gh-9 at review attempt 2 shows "Step: review (attempt 2)", the counters and the last outcome above the handoff's written part; `story checkout` prints the same status above the handoff.

- B8 As a person whose story was made before this change, I want the old generated header and heartbeat block taken out of handoff.md once, so that the file is prose only from then on.
  Example: the first boundary commit on gh-9 after the upgrade removes the `norn:header` and `norn:heartbeat` blocks from its handoff.md and keeps Goal, Progress and Resume as written.

### The record policy

- B9 As a team, I want to choose the record policy with the team config key `record.policy`, `local` or `remote`, with `local` as the default, so that each team decides whether takeover without a handoff keeps the full record.
  Example: a team config without `record.policy` behaves as `local`; `norn config set record.policy remote --repo` (the team file) makes every machine of the team push the record at each boundary; `norn config get record.policy` shows which file the value came from; `norn doctor` reports an unknown value as a failed check.

- B10 As a team under `remote`, I want the record pushed to `refs/norn/runs/<story>` at every step boundary right after the branch push, so that any machine can see and take over the current state.
  Example: gh-9 under `remote` finishes implement; the branch and then the ref are pushed; on another machine `story view gh-9` shows "Step: review (attempt 1)".

- B11 As a team under `local`, I want the record pushed only on a claim release, when `open-pr` runs (B28) and at the end (B29), so that a normal step costs no extra push.
  Example: gh-9 under `local` runs implement, review and qa; `git ls-remote origin 'refs/norn/runs/*'` lists no ref for gh-9 until a claim release or `open-pr`.

- B12 As a team that changes its policy while stories are open, I want the new policy to apply from each story's next boundary, so that open stories follow without waiting.
  Example: a team switches `local` → `remote` while gh-9 is in review; gh-9's next boundary pushes its ref, and every boundary after it does too.

- B13 As a person on another machine after a team switched `remote` → `local`, I want a ref that is no longer kept current labelled with its age, so that I never read old state as current.
  Example: `story view gh-9` on a non-holder shows the ref's step and attempt under "record as of 2026-11-02 14:10 — gh-9 now keeps its record on <holder>'s machine".

- B14 As the holder under `remote`, I want a failed ref push retried at the next tick, as a failed branch push is, so that a network blip neither stops the story nor loses the record.
  Example: the network drops right after the branch push; the step goes on; the next tick pushes the ref; until then a non-holder sees the record one boundary behind.

### Claim release and handoff

- B15 As the holder, I want every claim release (`norn story handoff`, a clean `watch` exit, `norn story close`) to push the story's record to its ref before the claim goes, under either policy, so that whoever takes it next gets the full record.
  Example: `norn story handoff gh-9` pushes the story branch, the slice branches and `refs/norn/runs/gh-9` (recording the story branch commit it matches), then deletes the claim, and says "handed over gh-9: record at <commit>, matches story branch <sha>".

- B16 As the holder, I want a release whose record push fails to release nothing, so that a released claim never means a lost record.
  Example: `norn story handoff gh-9` with the remote rejecting the ref push keeps the claim, deletes nothing, and refuses (exit 3) with the reason and "check the remote, then run norn story handoff gh-9 again"; a `watch` exit in the same case keeps that claim and says so (T6a).

### What other machines see

- B17 As a person on a machine that does not hold a `remote` story, I want `story view` and `status` to show its step, attempt and counters from the ref, so that I see what I see today.
  Example: `norn story view gh-9` on a non-holder shows "Step: qa (attempt 1)" and the counters, read from `refs/norn/runs/gh-9`.

- B18 As a person on a machine that does not hold a `local` story, I want `story view` and `status` to show the claim, the branch, the PR with its CI, and the last step from the last boundary commit, with a line saying where the record is, so that I know whom to ask.
  Example: `norn story view gh-9` on a non-holder shows the holder, heartbeat and expiry, the branch's last commit, "last boundary: implement", the PR and CI, and "run state is on kuba@laptop's machine — ask them to run norn story handoff gh-9, or take it over after the claim expires (2026-11-04 18:00)". Attempt and counters are not shown.

- B19 As a person on a non-holder for a `local` story whose branch has no boundary commit yet, I want the view to say so instead of a step, so that I am not shown a guess.
  Example: `story view gh-9` shows "no boundary pushed yet" where the last step would be.

### Mailbox

- B20 As a person answering or approving a `local` story from a machine that does not hold it, I want my mailbox receipt stamped with the step the last boundary commit led to, and no attempt, and to be told that the step check happens on the holder, so that I know it may still be turned away.
  Example: gh-9's last boundary ended refine and moved it to plan (`Norn-Step: refine`, `Norn-Outcome: done`, `Norn-Next: plan`); `norn story answer gh-9 "use option b"` on a non-holder posts a receipt with step plan and no attempt to the mailbox and replies "sent to kuba@laptop; the holder checks it against the step it is at (last boundary: refine -> plan)"; the holder matches it by step alone. Under `remote` the sender stamps step and attempt from the ref, as it does from the branch today.

- B21 As the holder, I want a mailbox receipt whose step or attempt no longer matches to show as a Check item in my inbox, besides the trace, so that a stale answer never vanishes silently.
  Example: an answer stamped for refine arrives after gh-9 moved to plan; the holder's tick rejects it, and `norn status` on the holder shows a Check item "answer from ana@desk for gh-9 was rejected: gh-9 is at plan now". The item clears on its own when a later answer or approval for gh-9 is accepted, or when the story finishes; there is no dismiss command.

### Takeover

- B22 As a person taking over a story with a record on the ref, I want `story checkout` to fetch it, unpack it into my machine dir and continue where it was, so that a handover loses nothing.
  Example: after `norn story handoff gh-9` on the laptop, `norn story checkout gh-9` on the desktop claims it, checks out the branches, unpacks the record, prints the status and handoff, and the next tick resumes review at attempt 2 with the same counters.

- B23 As a person taking over, I want a branch that moved ahead of the commit the record matches to be accepted, so that commits pushed after the record do not block me.
  Example: the record matches `abc123`; a person pushed a fix on top; checkout unpacks and continues, and the step works on the newer code.

- B24 As a person taking over a story whose branch was rewritten (the record's commit is no longer in the branch), I want the record kept and the current step restarted as a new attempt with the reason given, so that the agent never trusts state about code that is gone.
  Example: the branch was force-pushed; checkout says "the branch of gh-9 was rewritten since the record (abc123 is gone); restarting review as attempt 3"; counters and history stay; the brief's "Why this attempt" says the same.

- B25 As a person taking over a story whose holder left no record (claim expired or `--force`, no ref), I want `story checkout` to restart the last step from the branch with fresh counters and say the record was lost, so that the story goes on without a person rebuilding it.
  Example: the laptop died holding gh-9 at implement; after expiry `norn story checkout gh-9` on the desktop prints "the run record of gh-9 was on kuba@laptop and is lost; restarting implement from the branch"; it starts a new round of the workflow in the story's frontmatter, pinned fresh from the branch's workflows, at the step of the last boundary commit, attempt 1 and counters at zero; the `take` receipt says the record was lost; `run list` shows the new round; the brief tells the agent the record was lost and to check the branch for what is already done before it starts. With no boundary commit on the branch at all, the round starts at the workflow's first step.

- B26 As a person whose machine dir was wiped while it held a story, I want `story checkout --force` on that same machine to recover it as any takeover does, so that a wiped home is not a dead end.
  Example: `~/.norn` was deleted; the next tick no longer recognises the claim as this checkout's; `norn story checkout gh-9 --force` takes it, as B22 when a ref exists, else as B25.

- B27 As the person on the old holder's machine after someone else took the story over without a release from me, I want my local copy of its record set aside as superseded, never pushed, with one Check item, so that I know work of mine may not be in the new record; after I handed it over cleanly, I want my copy removed quietly, since the ref already holds it.
  Example: the laptop wakes after the desktop took gh-9 over after the claim expired; its next tick sees the claim is the desktop's, moves its record of gh-9 aside and shows "your record of gh-9 was superseded when ana@desk took it over (last local receipt 0035-done)"; nothing is merged into the new holder's record; `norn tidy` deletes the superseded copy once it is older than `trace.retain`. Had the laptop run `norn story handoff gh-9` first, its copy would be gone after its next tick, with no Check item.

### PR evidence

- B28 As a reviewer of a PR, I want the QA evidence the PR body cites to render inline, so that I see the screenshots without the evidence being on the branch.
  Example: the describe agent writes `![B2 after](evidence/01-parser/01ABC/shot.png)` in `pr.md`, a path inside the story's record; `open-pr` pushes gh-9's record to its ref, rewrites each such link to that record commit's URL on GitHub or GitLab, and then opens or updates the PR, where the image shows inline. A later `open-pr` after rework pushes and rewrites again; links in an older body stay valid, since every record commit stays reachable from the ref.

### The archive

- B29 As a person looking back at a finished story, I want its final record pushed to its ref when the PR merges (GR6) or the story closes without a PR (GR6b), and kept, so that `run list`, `run view` and `norn-retro` can read it on any machine.
  Example: gh-9's PR merges; norn pushes the final record to `refs/norn/runs/gh-9`, then cleans up as GR6 says; the base branch gains no run-state file; months later `norn run list gh-9` on a fresh clone fetches the ref and lists every round and step.

- B30 As a person cloning the repository, I want the archive refs left out of a normal clone, so that a clone carries only the code.
  Example: `git clone` fetches no `refs/norn/runs/*`; norn fetches one only when a command needs that story's record.

- B31 As a person, I want the archive kept until someone deletes its ref by hand, so that a retro is possible at any time.
  Example: `norn tidy` never lists or deletes a `refs/norn/runs/*` ref.

- B32 As a person reopening a story closed without a PR, I want `norn story reopen` to unpack its record from the ref, so that it goes on where it stopped.
  Example: gh-9 closed by GR6b; the issue is reopened; `norn story reopen gh-9` unpacks the record and the story is at its last round's `$done`, ready for a new round.

- B33 As a person with a story that has no branch yet (#126), I want its record kept and handed over the same way, so that the record never depends on a branch.
  Example: a story with no branch is handed over; its ref records no matching branch commit, and checkout on another machine unpacks it without the ancestry check.

### Migration

- B34 As the person running an open story that started before this change, I want the first tick of the new norn to move its run state off the branch, so that it goes on where it was.
  Example: gh-9 has `runs/` on its story branch; the holder's first tick copies it into the machine dir, removes it from the branch in one commit "norn: move gh-9 run state off the branch" (and pushes the ref under `remote`), and the story continues at the same step and attempt.

- B35 As a person upgrading a repository, I want `norn upgrade` to move each finished story's run state from the base branch into its archive ref and stage its removal, so that every finished story reads the same way and the base branch's tree no longer holds run state.
  Example: in the main checkout `norn upgrade` packs each spec folder's run state into `refs/norn/runs/<story>`, pushes those refs, stages the removal of all run state from the tree and of the `runs/**` line from `.gitattributes`, and commits nothing (LY3); a rerun after an interruption pushes only the refs still missing and says nothing is left when done; `norn run list` for an old story then reads its ref.

- B36 As a person upgrading, I want an upgrade whose ref push fails to stage no removal for that story, so that run state is never removed before it is safe on the remote.
  Example: the push of `refs/norn/runs/gh-4` is rejected; `upgrade` leaves gh-4's run state in the tree, stages the others, and names gh-4 with the reason.

- B37 As a person running `norn init` in a new repository, I want no `runs/**` line added to `.gitattributes`, so that nothing hints at run state in git.
  Example: `norn init` in a fresh repository leaves `.gitattributes` without a norn line (S10 is retired).

### Rules and docs

- B38 As a reader of the rules and docs, I want them to say where run state lives and when it leaves the machine, so that the docs match what norn does.
  Example: G3 reads that a story can be continued from git in full after a handoff or under `remote`, and from the branch alone with the record lost otherwise; S8, S9, §7 and §7.1, GR6, GR6b, T5, T6, T6a, R3.3, T9, R10.1, C5, RD6, RD7, H2, O6 and MO1 say the same; T7a and R2.3 describe superseded records instead of `orphaned/`; new rules state the record policy and where run state lives; S10 is marked retired with its id kept.

- B39 As an agent or person working a unit, I want each unit's handoff kept as its own file under the spec folder's `handoffs/` (`_story.md` for the story, `<nn>-<slug>.md` for a slice) and committed on that unit's branch, so that the handoff travels with the work while run state does not.
  Example: gh-9 with slice `01-parser` has `handoffs/_story.md` on the story branch and `handoffs/01-parser.md` on the slice branch; the first boundary after the upgrade moves an open story's old `runs/<unit>/handoff.md` there with Goal, Progress and Resume unchanged (B8, B34); the story's handoff stays one file across rounds.

## Out of scope

- #92's second-session check (a second session joining a live run) — needs its own issue.
- Intake of a story without a branch (#126) — only where its record lives is covered (B33).
- Committing the evidence a PR cites onto the branch — the fallback if B28's inline rendering fails, not built now.
- Merging a superseded record back into the new holder's — a person passes on what mattered.
- A configurable path for the machine dir or for run state in it — the machine dir stays where ID2 puts it.
- Pinning the record policy per story — read at every boundary instead (B12).

## Open questions

None. One fact to verify first in planning: that GitHub and GitLab render an image linked from a commit reachable only through a `refs/norn/runs/*` ref (B28). If they do not, the fallback in Out of scope comes back as a decision for the person.

## Plan

Every seam, prefactor and decision below was agreed with the person in the plan interview (2026-11-04).

### Seams

- **S1 The cli harness, through `runCli` and the tick, on clones of one bare remote (agreed).** A second machine is a second clone of the same bare remote with its own norn home, user and machine name; the remote's refs (`git ls-remote`), the branch trees, command output, `norn status`/`story view`/`brief` and the machine dir are what a test observes. Only the issue/PR provider, the runner and the clock are faked (`FakeRemote`, `FakeRunner`, `FakeClock`); git, the remote's refs and the file system are real. Observes B2–B27, B29–B37, B39.
  Prior art: the cli integration tests of handoff/checkout across clones (`team`), claim lost and recovery (`recovery`), mailbox from another machine (`human`), merge cleanup and the base record (`records`, `housekeeping`), upgrade from an older layout (`upgrade`, `round-folders`), the machine dir (`machine-dir`), config edits and doctor (`config`, `doctor`).
- **S2 Multi-tick stories in the e2e tier, through the same harness (agreed).** A whole story driven tick by tick, with the effect transcripts and the observe snapshots. Observes B1 (no run-state path in any branch or PR), and pins the new effects (ref pushes, machine-dir writes) in the rewritten transcripts.
  Prior art: the slice-workflow, base-sync and recovery transcripts; the observe snapshots; the team story.
- **S3 The docs lint, through the unit tier (agreed).** Observes B38: no rule id lost or defined twice (S10 kept as retired), links and anchors resolve, commands and flags exist.
  Prior art: the docs lint and the glossary lint in the repo tests.
- **S4 A person on a real GitHub and GitLab PR (agreed).** Observes B28's inline rendering, which no harness can observe. S1 observes the rest of B28: `open-pr` pushes the ref, then sends a body whose record paths are rewritten to that commit's URLs.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S2 | e2e | slice-workflow story to PR: no `runs/` in any branch tree or PR file list |
| B2 | S1 | integration | `git status` clean of run state; `git clean -fdx` then tick goes on at the same step and attempt |
| B3 | S1 | integration | remove the story worktree while parked on an ask; `story start` recreates it; same ask, same attempt |
| B4 | S1 | integration | a bad receipt in the machine dir marks the unit corrupt; parallel slices write only their own folder; crash between receipt and state re-applies |
| B5 | S1 | integration | boundary commit holds the agent's files and the handoff, S4 trailers, no run-state file |
| B6 | S1 | integration | a boundary with no handoff edit leaves the handoff out of the commit; no generated block in the file |
| B7 | S1 | integration | `brief` and `story checkout` print the status block above the handoff text |
| B8 | S1 | integration | an old handoff with header and heartbeat blocks loses them at the first boundary, prose kept |
| B9 | S1 | integration | absent `record.policy` = local; `config set record.policy remote --repo`; `config get` names the file; doctor fails an unknown value |
| B10 | S1 | integration | under remote, branch then ref pushed at a boundary; other clone's `story view` shows the new step |
| B11 | S1 | integration | under local, no ref on the remote through implement, review, qa |
| B12 | S1 | integration | switch local → remote mid-story; next boundary pushes the ref |
| B13 | S1 | integration | after remote → local, the other clone labels the ref "record as of …" |
| B14 | S1 | integration | ref push rejected once (remote hook), step goes on, next tick pushes it |
| B15 | S1 | integration | `story handoff` pushes branches and ref, then deletes the claim; message names both commits |
| B16 | S1 | integration | ref push rejected: claim kept, refusal exit 3; `watch` exit keeps the claim and says so |
| B17 | S1 | integration | non-holder view of a remote story: step, attempt, counters from the ref |
| B18 | S1 | integration | non-holder view of a local story: claim, branch, last boundary step, PR and CI, where the record is |
| B19 | S1 | integration | no boundary commit yet: "no boundary pushed yet" |
| B20 | S1 | integration | non-holder answer stamped from the last boundary (local) or the ref (remote); reply names the holder |
| B21 | S1 | integration | stale mailbox receipt rejected and shown as a Check item on the holder |
| B22 | S1 | integration | handoff then checkout on the other clone resumes the same step, attempt and counters |
| B23 | S1 | integration | branch ahead of the record's commit: checkout continues |
| B24 | S1 | integration | branch force-pushed: record kept, step restarted as a new attempt with the reason in the brief |
| B25 | S1 | integration | holder gone, no ref: forced checkout starts a new round at the last boundary's step, `take` says `record_lost` |
| B26 | S1 | integration | machine dir deleted on the holder: `checkout --force` on the same clone recovers |
| B27 | S1 | integration | old holder's next tick after a takeover without a release sets its record aside as superseded, one Check item; tidy removes it after retain; after a clean handoff the copy is removed quietly |
| B28 | S4 | person | S1 checks that `open-pr` pushes the ref and rewrites record paths in the body sent to `FakeRemote` to that commit's URLs; a person checks rendering on GitHub and GitLab |
| B29 | S1 | integration | merge: final record on the ref, base branch gains no run state; `run list` on a fresh clone reads the ref |
| B30 | S1 | integration | a fresh clone and a sync fetch no `refs/norn/runs/*` but the one a command needs |
| B31 | S1 | integration | `tidy` lists and deletes no run-state ref |
| B32 | S1 | integration | close without PR, reopen issue, `story reopen` unpacks and is at `$done` |
| B33 | S1 | integration | a story without a branch is handed over and checked out without the ancestry check |
| B34 | S1 | integration | a story with `runs/` on its branch (older layout fixture) moves at the first tick, one commit, same step and attempt |
| B35 | S1 | integration | `upgrade` on a base with run state: refs pushed, removal staged, `.gitattributes` line removed, nothing committed; rerun pushes only missing refs |
| B36 | S1 | integration | one ref push rejected: that story's run state stays, others staged, the story named |
| B37 | S1 | integration | `init` writes no `.gitattributes` norn line |
| B38 | S3 | unit | docs lint; content checked in review |
| B39 | S1 | integration | story handoff on the story branch, slice handoff on the slice branch under `handoffs/`; old handoff moved at the first boundary |

### Prefactoring

1. **The run-state resolver takes the checkout, the story and the unit, not a spec folder in a worktree (agreed).** Today every caller joins a worktree path with the spec folder and hands the result to the resolver, and each caller picks its own worktree. After this change every reader and writer asks the resolver for `(checkout, story, unit)`, and the folder is unchanged. The move to the machine dir then changes one function instead of about thirty callers (B2–B4, B34).
2. **One resolver for a unit's handoff, independent of its record folder (agreed).** The handoff path is derived from the record folder today (it sits above the round folders). Giving it its own resolver, location unchanged, lets B39 move it to `handoffs/<unit>.md` without touching record readers (B6, B8, B39).
3. **The sync fetch names the claim and mailbox prefixes instead of all of `refs/norn/*` (agreed).** No other norn ref exists yet, so behaviour is unchanged; without it every sync would fetch every archive (B30).
4. **The headless runner's session logs move from the machine dir's `runs/` to `sessions/` (agreed).** S12 puts run state at `runs/<story>/<unit>/` in the machine dir, where the runner's logs sit today. The logs are machine-local and disposable; old ones are left for `tidy` (D1).

### Implementation decisions

- D1 **Run state lives at `<machine dir>/runs/<story>/<unit>/` as S12 says; the runner's session logs move out to `sessions/` (agreed).** The rules already name the path, so the runner's logs give way rather than the rules. The alternative, a different name for run state such as `records/`, would mean amending S12 and §7.
- D2 **A record is one commit whose tree is the story's run-state folder as it is in the machine dir (agreed).** That means `_story/rounds/NN-<wf>/…` and each slice's `<nn>-<slug>/…`, with no wrapper folder. Its parent is the previous record commit of the ref, so the ref's history is the story's push history and blobs dedupe. Its trailers are `Norn-Story`, `Norn-Branch-Commit` (absent for a story without a branch, B33) and `Norn-Holder`. The commit time is what "record as of" shows (B13). It is pushed with a lease on the sha this checkout last saw, as claims are, so two holders never overwrite each other. The alternative, a parentless snapshot force-pushed each time, beat on simplicity but loses the push history and the lease.
- D3 **Pack and unpack live in store, next to claims and mailbox, using git plumbing directly (agreed).** Pack uses a temporary index over the folder, `write-tree` and `commit-tree`. Unpack extracts into a temp folder, validates every JSON file against the schema (S2), then renames into place, so S1 holds. Claims and mailbox already do their ref work in store, so the git port stays as it is. The alternative was new git port methods with a contract run; it would add a second home for ref plumbing.
- D4 **When the record is owed is decided by decide, from facts (agreed).** Observe reports per held story the record's local tree id and the last pushed one, kept machine-local, plus the policy read from the team config at every tick (B12). Under `remote`, decide emits a new `push_record` action after the branch push when the tree changed. A failed push leaves the record owed, so the next tick retries it (B14). Claim releases (B15, B16) and the archive (B29) call the same store push synchronously and stop on failure. The alternative was a flag on the boundary commit. It would not retry on its own and would bind the push to a commit.
- D5 **The PR's evidence links are made by `open-pr`, not by the agent (agreed).** The describe agent links evidence in `pr.md` by a path inside the story's record: `evidence/<unit>/<run_id>/<file>`, where `<unit>` is `_story` or `<nn>-<slug>`. Before it opens or updates the PR, `open-pr` pushes the story's record (synchronously; a failed push fails the git step, which is retried as git steps are). It then rewrites each such link to the file's URL at that record commit: `…/blob/<commit>/<path>?raw=true` on GitHub, `…/-/raw/<commit>/<path>` on GitLab, where `<path>` is the file's real path in the record (the story's current round for `_story`). A link to a file the record does not hold is left as written and named in the step's output. Since every record commit stays reachable from the ref (D2), an older body's links stay valid, and no boundary between `open-pr` and merge pushes the record for the PR's sake (S11, GR9 and B11, B28 amended).
  The describe step still needs to know where the QA reports and evidence sit, since its `{ file: runs/ }` input names a folder no longer in the worktree. A new input kind, `record`, lists each unit's receipts and evidence folders in the machine dir in the brief, and replaces that input in the shipped and repo-local `story` workflows. It changes the workflow schema, so `schema:emit` and the reference docs are regenerated. The norn-pr skill's linking rule changes to record paths. The alternative, a workflow-declared "PR step" that pushes before its session and at every boundary until merge, beat nothing once `open-pr` does it.
- D6 **Non-holders read other machines' records from local refs, fetched by the tick (agreed).** A tick fetches `refs/norn/runs/<story>` only for open stories this checkout shows and another heartbeat holds. `run list`, `run view`, `story reopen`, `story checkout` and `story answer|approve` fetch the one story they need. The view and status never touch the network: they read the local ref, unpacked once per record commit into a cache in the machine dir, the way the base branch's specs are cached today. A local-policy story with no ref falls back to the claim, the remote-tracking story branch and its last `Norn-Step` trailer (B18, B19).
- D7 **The snapshot reads run state from the machine dir for every story; spec and frontmatter still come from worktrees, the base and the main checkout (agreed).** A finished story's run state is read from its archive ref, fetched on demand, instead of the base branch's tree (B29). `UnitFacts.record` becomes the unit's path inside the story record (`_story/rounds/02-story`, `01-parser`). Golden cases change only in that path and in commit path lists, rewritten with `golden --update`.
- D8 **A boundary commit stages the agent's work and the unit's handoff, never run state (agreed).** It still uses `git add -A` over the worktree, which no longer holds run state. `commit_push`, session start and checkout stop passing record paths. The `uncommitted` fact covers the handoff and the agent's files only (B5, B6).
- D9 **Handoffs live at `<spec folder>/handoffs/<unit>.md` (agreed).** `_story.md` is on the story branch; `<nn>-<slug>.md` is on the slice branch and reaches the story branch with the slice's integration. The status block is rendered from `state.json` by `brief` and `story checkout` (`renderHandoffStatus`, kept). Nothing writes into the file but agents, people, and the one-time removal of an old header or heartbeat block (B6–B8, B39).
- D10 **Takeover (agreed).** Checkout fetches the ref.
  - **A ref exists.** Unpack it, then compare `Norn-Branch-Commit` with the story branch head:
    - an ancestor: continue (B23);
    - not an ancestor: keep the record and restart the cursor's step as a new attempt, with the reason in "Why this attempt" (B24);
    - no branch: skip the check (B33).
  - **No ref.** Start a new round from the frontmatter's workflow, pinned from the branch, at the step the last story-unit boundary commit (the newest with `Norn-Outcome`) led to, its `Norn-Next` (D17), when the workflow has it; else (`$done`, or another round's step) at the step that boundary ended, its `Norn-Step`, when the workflow has that; else, and on a branch with no such boundary (an older norn wrote no `Norn-Outcome`), at the workflow's first step (B25).
  The `take` receipt gains `record_lost: boolean`, a schema change (R10.1). A forced checkout on the holder's own clone after its machine dir was wiped goes the same way (B26).
- D11 **Superseded records replace `unpushed_runs` and `orphaned/` (agreed; narrowed by the person at the first slice gate).** Observe reports, per story held by another heartbeat, a local record under `runs/<story>/`. When the story was taken over without a release from this checkout, the tick moves it to `<machine dir>/superseded/<story>-<ulid>/` and never pushes it. When this checkout released the claim cleanly (`norn story handoff`, which pushed the record first, B15), the copy is already on the ref and is deleted quietly, with no Check item. One Check item `superseded:<story>:<ulid>` per copy shows until `tidy` deletes the copy older than `trace.retain` (B27). How a clean release is told (gh-195/14, from durable facts, not timing): the local copy's tree is the tree of a record commit this machine pushed (`Norn-Holder`) in the story's record ref history. **Flagged for the person at the ready gate:** under `remote`, a takeover without a release (expiry or `--force`) after every receipt had already been pushed reads the same way, so that copy is removed quietly with no Check item; nothing of the old holder's is missing from the record, but it differs from AC1's wording. The Check item's id is per copy, `superseded:<story>:<ulid>` (review#1 F6).
- D12 **A rejected mailbox receipt is kept machine-local with its reason and shown as a Check item (agreed).** Kept next to the notices; the trace keeps it too. It clears on its own when a later answer or approval for the story is accepted, or when the story finishes. There is no dismiss command (B21 and T9 amended).
- D17 **A boundary commit names the step it led to, and a step-only mailbox receipt is matched by step (person's decision during slice 13).** Every commit that ends a step (an outcome edge that moves the cursor to another step; never a person moving the cursor, an edge back into the same step, or `$stuck`) carries `Norn-Next: <to-step>` beside `Norn-Outcome`. A story unit's boundary commit is made even when nothing else changed, so the branch always holds the last boundary (slices' are not: no reader needs them); this clause is an implementation consequence of the person's choice, not part of the answer, and reverses slice 07's "no per-boundary norn commit" for the story unit, so the person confirms it at the ready gate. A `local` non-holder stamps its mailbox receipt with that step and no attempt (no run, no round); `attempt` becomes optional on the receipts the mailbox carries (answer, approve, reject, unstick), and the holder matches a receipt without one by step alone and keeps it with the attempt it matched (S6). Under `remote` the sender stamps step and attempt from the fetched ref. The alternatives were stamping the step the boundary ended, which the holder would turn away every time, and deriving the next step from the branch's workflow file, wrong once that file changed after the round was pinned. S4 gains `Norn-Outcome` and `Norn-Next` in slice 18.
- D13 **Open-story migration is decided, not hard-wired (agreed).** Observe reports `runs/` still on a held unit's branch. decide emits `move_record` per unit. Its act:
  1. copies the files into a temp folder in the machine dir, validates them and renames into place;
  2. moves the old `runs/<unit>/handoff.md` to `handoffs/<unit>.md` with the generated blocks stripped;
  3. removes `runs/` from the branch in one commit "norn: move gh-9 run state off the branch";
  4. pushes the branch, then the ref under `remote`.
  A machine dir that already holds the record with `runs/` still on the branch only finishes the removal (S5, B34). A flat record (RD7) is moved into `rounds/01-<wf>/` in the same step.
- D14 **`norn upgrade` packs each finished story from the base tree without unpacking (agreed).** The `runs/` subtree of each spec folder on the base is already a tree object, so its record commit is `commit-tree` of that subtree. The refs are pushed in one batch with a lease of "absent" each. A story whose push is rejected keeps its run state; for every other story the removal is staged, and the `.gitattributes` line removal too (B35–B37, LY3).
- D15 **GR6 and GR6b push the final record first and clean up only after it is on the remote (agreed).** A failed archive push leaves the cleanup owed and retried, as an owed base record is today (B29).
- D16 **No fallback reads run state from the base tree (person's decision at the first slice gate).** After the archive lands, a finished story's run state is read only from its archive ref; the reader of `runs/` in the base tree is deleted, not kept beside it. A repository whose base still holds run state from an older norn is pointed to `norn upgrade` by one `norn status` item and one failed `norn doctor` check, until the removal `upgrade` stages is committed (B29, B35).

### Testing decisions

- A test drives what a person or the tick does (`runCli`, `h.tick()`) and checks what anyone can see: the remote's refs and their trees, branch trees and commit trailers, command output, `norn status`, the machine dir's files. Never the store's functions or decide's actions directly.
- Faked: only the system boundaries the harness already fakes: the issue and PR provider, the runner and the clock. git, the bare remote and its refs, and the file system are real. A rejected ref push is a real `pre-receive` hook on the bare remote, not a fake.
- A second machine is a second clone with its own norn home, user and machine name, sharing the fake remote and clock (the team and recovery tests' `cloneOf`).
- The golden corpus is rewritten with `golden --update`, its diff reviewed as the behaviour change (record paths, commit paths, the new `push_record` and `move_record` actions); `bun run golden` harvests cases for the new rule ids (S11, S12, T5a, T5b, T7a, T7d).
- The three effect transcripts and the five observe snapshots are rewritten once, and the diff is reviewed: run state disappears from the branch, and the machine-dir writes and ref pushes appear.
- Older-layout fixtures (`runs/` on a branch, on the base, a flat record) are built with the harness's layout helpers, not by hand.

### Risks

- **B28 on GitHub is verified; on GitLab it is not.** Verified 2026-11-04 on this repository. A throwaway commit holding one PNG, reachable only through `refs/norn/spike/gh-195`, was served at `…/blob/<commit>/<path>?raw=true` (a 302 to raw.githubusercontent.com, `image/png`). GitHub's markdown renderer turned it into an inline `<img>` exactly as it does for a branch link. The ref was then deleted. GitLab (`/-/raw/<commit>/<path>`) is checked by a person in QA (S4); if it fails there, the fallback in Out of scope comes back for GitLab only.
- **Blast radius.** About 35 test files, 56 golden cases, 3 transcripts and 5 snapshots name `runs/` paths. The slicing should land the prefactors first, then a tracer slice that moves the location with the open-story migration (B2–B5, B34) and rewrites these once. Every later slice then adds behaviour on a green base.
- **Packing while a detached check-run writes a receipt.** Receipts are written atomically and state last, so a pack can only catch a receipt ahead of its state, which S6 re-applies on unpack. The tracer slice's test should pack in the middle of a check.
- **Record size under `remote`.** Every boundary pushes evidence again. Unchanged blobs dedupe, so only new evidence costs a push, and the chain of commits (D2) keeps that true.
- **This repository migrates itself.** Its open stories move at the first tick of the released norn that has this change. Run the migration on a copy of this repo's base before release.
