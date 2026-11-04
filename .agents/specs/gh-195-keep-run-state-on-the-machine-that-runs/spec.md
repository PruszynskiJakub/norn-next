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
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-04T08:34:16.652Z
body_hash: daab49a1f6e19f9adece43a08de2e7ee1559163b2e979cbaa5e838e337c7bb9f
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

- **local** (the default): the record leaves the machine only when the claim is released (`story handoff`, a clean `watch` exit, `story close`), from the PR step until merge (so the PR can link evidence), and once at the end as the archive.
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

- B9 As a team, I want to choose the record policy, `local` or `remote`, in the team config, with `local` as the default, so that each team decides whether takeover without a handoff keeps the full record.
  Example: a team config without the key behaves as `local`; `norn config set <key> remote --repo` (the team file) makes every machine of the team push the record at each boundary; `norn config get` shows which file the value came from; `norn doctor` reports an unknown value as a failed check.

- B10 As a team under `remote`, I want the record pushed to `refs/norn/runs/<story>` at every step boundary right after the branch push, so that any machine can see and take over the current state.
  Example: gh-9 under `remote` finishes implement; the branch and then the ref are pushed; on another machine `story view gh-9` shows "Step: review (attempt 1)".

- B11 As a team under `local`, I want the record pushed only on a claim release, from the PR step until merge (B28) and at the end (B29), so that a normal step costs no extra push.
  Example: gh-9 under `local` runs implement, review and qa; `git ls-remote origin 'refs/norn/runs/*'` lists no ref for gh-9 until a claim release or the PR step.

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

- B20 As a person answering or approving a `local` story from a machine that does not hold it, I want my mailbox receipt stamped with the step from the last boundary commit and to be told that the step check happens on the holder, so that I know it may still be turned away.
  Example: `norn story answer gh-9 "use option b"` on a non-holder posts to the mailbox and replies "sent to kuba@laptop; the holder checks it against the step it is at (last boundary: refine)". Under `remote` the sender stamps step and attempt from the ref, as it does from the branch today.

- B21 As the holder, I want a mailbox receipt whose step or attempt no longer matches to show as a Check item in my inbox, besides the trace, so that a stale answer never vanishes silently.
  Example: an answer stamped for refine arrives after gh-9 moved to plan; the holder's tick rejects it, and `norn status` on the holder shows a Check item "answer from ana@desk for gh-9 was rejected: gh-9 is at plan now". The item clears when the person dismisses it or the story finishes.

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

- B27 As the person on the old holder's machine after someone else took the story over, I want my local copy of its record set aside as superseded, never pushed, with one Check item, so that I know work of mine may not be in the new record.
  Example: the laptop wakes after the desktop took gh-9; its next tick sees the claim is the desktop's, moves its record of gh-9 aside and shows "your record of gh-9 was superseded when ana@desk took it over (last local receipt 0035-done)"; nothing is merged into the new holder's record; `norn tidy` deletes the superseded copy once it is older than `trace.retain`.

### PR evidence

- B28 As a reviewer of a PR, I want the QA evidence the PR body cites to render inline, so that I see the screenshots without the evidence being on the branch.
  Example: the PR step pushes gh-9's record to its ref before it writes `pr.md`; the body links each evidence file by the ref's commit, and on GitHub `![B2 after](…)` shows the image in the PR. Under `local`, each boundary from the PR step until merge pushes the ref again so the links stay valid.

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
Written by the `norn-plan` skill.
