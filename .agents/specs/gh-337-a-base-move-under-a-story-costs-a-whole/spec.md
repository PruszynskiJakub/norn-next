---
id: gh-337
slug: a-base-move-under-a-story-costs-a-whole
provider: gh
number: 337
url: https://github.com/PruszynskiJakub/norn-next/issues/337
title: A base move under a story costs a whole round and a CI run per boundary push
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: story
status: active
intake_at: 2026-11-11T08:57:13.816Z
body_hash: 1b55f889d5de53b6fa4f6dbe2428a8cb2c5656d55a45a93059f08ed6e5ef6e61
refined_body_hash: 1b55f889d5de53b6fa4f6dbe2428a8cb2c5656d55a45a93059f08ed6e5ef6e61
---

# A base move under a story costs a whole round and a CI run per boundary push

## Problem Statement

A person delivering stories with norn pays heavily whenever the base moves under a story, and on every rework loop once the story's PR is open.

- **Every boundary pushes.** Once a PR is open, each push starts a full CI run (CI, process, dependabot auto-merge) and cancels the one before. A story pushes at every step boundary, even boundaries that changed nothing or only the handoff. After `ci` passes, `ready` and its approval push again. So the run the `ci` step watched is never the run on the PR's head at merge. A rework loop on #324 pushed about 6 times in minutes and cancelled 5 CI runs.
- **An approved story with an open PR is outside its workflow.** `ready` approves to `$done` while the PR waits for a person to merge, which is the longest wait in a story's life and the likeliest time for the base to move. A conflict then shows only as a merge item whose command quietly becomes `norn story update-branch`. Someone has to notice it and know the command.
- **People reach for the wrong command.** `norn story edit gh-N --workflow quick` on a finished story with a conflicting PR starts a whole round, including an `implement` step with nothing to do. Nothing points at `update-branch`, and AGENTS.md steers people to `story edit`. On gh-327 (2026-11-11), a 2-line conflict in one test file cost 4 agent sessions and 10 pushed commits in 9 minutes (about 30 workflow runs, roughly 10 cancelled), plus a second approval. One commit held the resolution. Five changed only the handoff and six changed nothing.
- **After a resolve, the story reruns the whole tail.** That is test, review of the whole story, describe, open-pr, ci and ready. The review sees the story against its base, where a dropped base change looks like an ordinary story change. The diff that shows exactly what the resolver did is never reviewed, and describe rewrites a PR body whose change did not change.
- **The resolver sees only its own side.** It rebuilds the base's intent from `git log`, although norn knows which story landed the conflicting commits and where that story's spec and PR body are.
- **Semantic conflicts go unnoticed.** Conflict detection is textual only. A waiting story whose merge is textually clean but broken raises nothing, and GitHub reruns no CI when the base moves. A merge queue was rejected (#237).
- **Open stories overlap without warning.** gh-326 and gh-327 both edited the same test file, an hour apart. norn compares each story only with its base, so nobody saw it coming or chose a merge order.
- **Generated files cost an agent run.** Most past resolutions were emitted schemas, docs, snapshots and golden files: take a side, regenerate. Every one of them was an agent session. #126 is the spec-folder-only case of the same thing.
- **Escalating throws away the work.** The resolver's only way out is to abort the merge and report stuck, which discards a partial resolution.

What works today stays: norn merges and never rebases a published branch, detection is cached per (head, base sha), the tool aborts cleanly, counters reset on each base move, the integrate lock is per story, a person's push to the branch is adopted, the merge skill resolves by intent, and `ci` exits `stale` on a conflicting PR and routes to `update`.

## Solution

A base move under a story becomes cheap, automatic and reviewable, and each rework loop costs one CI run.

- **One push per loop.** Once the story's PR is open, norn pushes the story branch only at `open-pr` and when it hands the story over. A rework loop starts exactly one CI run, the one `ci` waits on, and the PR's head at merge is the commit CI ran on.
- **Approved stories wait for the merge inside the workflow.** A new `merge` step type follows `ready` in story and quick. It shows exactly today's merge item. The PR merging ends the story, and a conflicting base move sends it back through `update` on its own.
- **The right command is suggested.** `norn story edit` that would restart the same workflow (no `--at`) on a finished story with a conflicting open PR is refused and names `norn story update-branch`; a different workflow or `--at` still starts a round. The docs say so too.
- **A light path after a base update.** When nothing but base merges and spec-folder bookkeeping happened since the story was last approved, the update goes update → (resolve) → test → a review of the resolution only → open-pr (body kept) → ci → ready. The light path is spelled out in the workflow YAML. A clean merge skips the resolution review and carries the earlier approval over. A resolution needs a fresh approval of just what the resolver changed.
- **The resolver sees the base side.** For each conflicting path it gets the base commits that touched it, the story that landed them, and that story's spec and PR body.
- **Waiting stories are re-verified.** When the base moves under a story waiting at `ready` or the merge step without a textual conflict, norn runs the workflow's chosen check on the merged tree locally. Red sends the story back through `update`.
- **Overlaps are visible.** `norn status` shows a Check item when two open stories conflict with each other.
- **Generated files regenerate.** The team config maps path globs to regenerate commands. A merge whose conflicts are all generated files is completed without an agent. A branch holding only its spec folder takes the base's side without an agent (#126).
- **The resolver can ask.** It can put a question to a person and keep the merge in progress.

## User Stories

### Push rule

1. As a person delivering a story, I want norn to stop pushing the story branch at step boundaries once the story's PR is open (a draft PR counts), so that bookkeeping commits start no CI runs.
2. As a person delivering a story whose PR is open, I want the `git: update` step to merge the base locally without pushing, so that a base update starts no CI run before the story is ready to be checked.
3. As a person delivering a story, I want `open-pr` to push the story branch before it creates or updates the PR, as it does today, so that the PR always shows the branch the story reached.
4. As a person watching a rework loop (implement → … → open-pr → ci), I want it to start exactly one CI run, the one the `ci` step waits on, so that no run is started only to be cancelled.
5. As a person merging an approved PR, I want the PR's head at merge to be the commit the `ci` step saw pass, so that branch protection checks the run norn already watched, not a later one.
6. As a person, I want `ready` approving and the story entering the merge step to push nothing, so that approving starts no new CI run.
7. As a person handing a story to another machine with `norn story handoff`, I want norn to put the story's latest boundary on the remote before it releases the claim (the story branch, or `refs/norn/heads/<story>` while the PR is open, so the PR head stays the commit CI ran on), so that the next holder starts from the story's latest boundary.
8. As a person stopping `norn watch` cleanly, I want each story whose claim it releases to have its latest boundary on the remote first (the story branch, or `refs/norn/heads/<story>` while the PR is open), so that no local-only boundary is left behind when the claim goes.
9. As a person closing a story with `norn story close`, I want its branch pushed first, so that the closed story's last state is on the remote.
10. As a person using `record.policy: remote`, I want the record push to keep working as today, so that another machine can read the story's state even while boundaries are local.
11. As a person whose story has no PR yet, I want boundaries pushed exactly as today, so that nothing changes before CI could be triggered.
12. As a person taking over a story after the previous machine crashed, I want norn to resume from the story's real last boundary (`refs/norn/heads/<story>`, pushed at every boundary under both record policies, merged with the remote branch, never rebased), and `docs/limitations.md` to say that under `record.policy: local` a crash still loses the receipts and counters since the last record push (the step restarts at that boundary with fresh counters), so that I know exactly what a crash costs.
13. As a person who pushed to a story branch while norn held unpushed boundary commits, I want norn's next sync to merge my push with its local commits (never rebase, never drop either), so that both my change and norn's boundaries survive.
14. As a person, I want this push rule always on with no setting, so that there is one push behaviour to understand and rely on.

### Merge step

15. As a workflow author, I want a step type `merge` that waits for the story's PR to merge, so that an approved story stays in its workflow until it is merged.
16. As a person delivering with the shipped story and quick workflows, I want `ready` approving to go to the merge step instead of finishing the round, so that a base move while the PR waits is handled by the workflow.
17. As a person, I want a story at the merge step to show in the inbox as exactly one item, today's merge item ("Merge PR #N", the PR URL, a draft note, how far behind its base it is, the merge command), so that I see the same thing I see today and never a second gate item beside it.
18. As a person, I want the PR merging to end a story waiting at the merge step through today's merge path, so that the story finishes exactly as merged stories finish today.
19. As a person, I want a story at the merge step whose PR is closed without merging to behave as a story with a closed PR does today, so that closing a PR still means what it meant.
20. As a person, I want a story at the merge step to go back to `update` on its own when the base moves under it in a way its workflow counts as stale, through a counter like the gate's `stale` route, so that I never have to notice the conflict and a base that keeps conflicting cannot loop forever.
21. As a person, I want the merge step to offer nothing to approve or reject, so that it cannot be answered by mistake; I merge the PR, or move the story with the usual commands.
22. As a person whose repo uses a workflow without a merge step, I want `ready` to finish the round and a conflicting finished story to show today's merge item with `norn story update-branch`, so that existing workflows keep working unchanged.
23. As a person with a stuck story, I want `norn story update-branch` to keep working, so that I can still bring the base in by hand.
24. As a workflow author, I want the merge step type documented with the other step types in the workflow reference and in `docs/concepts.md`, so that I can use it in my own workflows.

### Pointing at the right command

25. As a person who runs `norn story edit gh-N --workflow <name>` with no `--at` on a finished story whose open PR conflicts with its base, where `<name>` is the workflow the finished round ran, I want it refused (exit code 3, `refused`) with a `do_instead` that names `norn story update-branch gh-N`, so that I bring the base in without a whole round.
26. As a person who runs `norn story edit gh-N` on a finished story with a conflicting open PR naming a different workflow, or with an explicit `--at <step>`, I want the round to start as today, so that deliberate new work is never blocked.
27. As a person reading AGENTS.md or the "The base moved under a story" recipe, I want them to say that a finished story with a conflicting PR is updated with `norn story update-branch`, and that starting a new round is for new work, so that I reach for the right command.

### Light path after a base update

28. As a person, I want a base update to take the light path only when everything between the head approved last (the latest story review approve, resolution-review approve or `ready` approve) and the head before this merge is merge commits of the base plus boundary commits that change only the story's spec folder, excluding `spec.md`, so that new implement work always gets the full review.
29. As a person whose story was rejected at `ready` or sent back by `ci` into implement, I want the following base update to take the full path, so that the new work is reviewed as a whole even though the PR is still open.
30. As a person whose story's spec body (`spec.md`) changed since the last approval, I want the base update to take the full path, so that a changed contract is never reviewed as a mere merge.
31. As a workflow author, I want the light path spelled out in the workflow YAML, through outcomes of the `git: update` step that norn takes only when the light-path condition holds (one for a clean merge, one for a merge with a resolution), routed to their own steps, so that the route is readable and editable like any other.
32. As a workflow author whose workflow does not route those outcomes, I want the update to take `done` (the full path), so that my workflow behaves as today.
33. As a person, I want norn to decide the light path from git and the receipts alone, never from prose, so that the route is the same on every machine.
34. As a person, I want the shipped story and quick workflows (both copies) to route the light path: update → (resolve) → test → resolution review → open-pr → ci → ready, so that a base update costs one test run, at most one short review and one CI run.
35. As a reviewing agent on the light path, I want a step input `resolution`, the remerge-diff of each merge commit since the last approval, so that I review exactly what the resolver did, including a base change it dropped.
36. As a person, I want a clean merge (an empty remerge-diff) on the light path to skip the resolution review, so that a merge git made by itself costs no agent session.
37. As a person, I want the resolution review's blocking findings to go back to `resolve`, not `implement`, so that a bad resolution is fixed by redoing the resolution.
38. As a person, I want `describe` to run again on the light path only when the resolution review says the merge danger in `pr.md` changed, and otherwise `open-pr` to push and keep the PR body, so that the PR description is rewritten only when what it describes changed.
39. As a person, I want a merge whose remerge-diff touches only paths covered by the regenerate mapping, with files exactly what the mapped commands produce, to count as a clean merge, so that a regenerated merge costs no review and no fresh approval.

### Re-approval

40. As a person who approved a story at `ready`, I want my approval carried over after a clean base merge (an empty remerge-diff, or a regenerated merge as above) once test and CI are green, so that I am not asked to approve again when nothing I would read changed.
41. As a person, I want a carried approval recorded in the receipts and shown in History (for example "approval carried: clean base merge"), so that I can see the story was not re-approved by a person.
42. As a person, I want any base merge that needed a resolution to ask me for a fresh approval at `ready`, so that a resolver's work is never merged without a person seeing it.
43. As a person asked to approve again after a resolution, I want the `ready` item, the brief and the PR evidence to show the remerge-diff (what the resolver changed), so that I review only that, not the whole story again.
44. As a person, I want a story whose test or CI is red after a base merge never to reach `ready` with a carried approval, so that a carried approval only ever covers green code.

### The resolver sees the base side

45. As a resolving agent, I want a step input `base_side` listing, for each conflicting path, the commits on the base between the merge base and the base sha that touched it, with the story key from their trailers and the paths of that story's `spec.md` and `pr.md` on the base, so that I resolve by both sides' intent.
46. As a resolving agent, I want the brief's base-update section to list that base side, and the `norn-merge` skill to read it first, so that I start from the other story's intent instead of rebuilding it from `git log`.
47. As a resolving agent, when a conflicting base commit carries no story trailer (a commit made outside norn), I want it listed with its subject and no story, so that I still see it.
48. As a workflow author, I want `resolve` in the shipped story and quick workflows (both copies) to take `base_side` in its inputs, so that the shipped resolver uses it.

### Re-verify waiting stories

49. As a workflow author, I want a workflow key `base.verify: <check step name>`, so that I choose which check re-verifies a waiting story when the base moves.
50. As a person delivering with the shipped story and quick workflows, I want `base.verify` set to their test step, so that re-verifying is on by default.
51. As a workflow author who sets `base.verify` together with `base.stale: behind`, or names a step that is not a check, I want the workflow refused as invalid with the reason, so that nobody believes a redundant or impossible verify is running.
52. As a person, I want a story waiting at `ready` or the merge step whose base moved without a textual conflict to have the verify check run on the merged tree in a temporary worktree, with no push, no CI and no approval, so that a merge broken by a rename on the base is caught before it lands.
53. As a person, I want the verify run cached per (story head, base sha), so that it runs once per base move and never every tick.
54. As a person, I want the verify run to run detached like other check steps and take a slot from the machine's slot limit, so that it never blocks the tick or overloads the machine.
55. As a person, I want a red verify run to send the story to `update` with the failure as `last_check`, through a counter, so that the story fixes the semantic conflict and a base that stays broken cannot loop forever.
56. As a person, I want a green verify run to leave the waiting story where it is, so that a harmless base move costs nothing more.
57. As a person, I want a workflow without `base.verify` to re-verify nothing, so that existing workflows behave as today.

### Overlap between open stories

58. As a person reading `norn status`, I want a Check item for each pair of open stories whose heads conflict with each other outside their own spec folders, naming both stories and the paths (for example "gh-326 and gh-327 both change ci-check.test.ts; whichever merges second needs a resolve"), so that I can choose a merge order before it bites.
59. As a person, I want overlap computed only for open stories whose branches have commits of their own beyond their base, those with a unit in flight or a finished round with an open PR, so that stories with nothing to compare raise nothing.
60. As a person, I want overlap detection cached per pair of heads, so that it costs nothing on ticks where neither head moved.
61. As a person, I want the overlap item to clear itself when either story lands or the heads stop conflicting, with no dismiss and no suggested merge order, so that it informs and I decide.
62. As a person, I want conflicts confined to the two stories' own spec folders not to count as overlap, so that the item names only real code overlap.

### Regenerate instead of resolving

63. As a team, I want a key in `.agents/norn.config.yaml` mapping path globs to regenerate commands, so that conflicts in generated files resolve themselves.
64. As a person, I want a base update whose conflicting paths all match the mapping to take the base's version of each, run the mapped commands, and commit the merge with no agent, so that a generated-file conflict costs no agent session.
65. As a person, I want a base update where any conflicting path matches no glob to go to `resolve` as today, so that hand-written code is always resolved by intent.
66. As a person, I want a failed regenerate command, or a path still conflicted after the commands ran, to send the merge to `resolve` with the command's output in its brief, so that the resolver knows what was tried.
67. As a person, I want a regenerated merge to go through test like any other merge, so that regenerating never skips verification.
68. As a contributor to this repo, I want the mapping in this repo to cover emitted schemas (`bun run schema:emit`) and `docs/reference.md` (`bun run docs:emit`) and never golden cases, so that changes in what decide decides are always reviewed.
69. As a person whose story branch holds nothing but its own spec folder, I want a base update with conflicts to take the base's version of every conflicted file outside the spec folder and commit the merge with no agent, still as a merge, so that a story waiting in triage or refinement updates in seconds (#126).
70. As a person, I want the team config's documentation and `docs/reference.md` to describe the regenerate key, so that teams can set it up.

### Ask instead of aborting

71. As a resolving agent, when keeping both intents needs a person's decision, I want to `norn ask` with the files, what each side wants and the decision needed, while the merge stays in progress in the worktree, so that the partial resolution is kept.
72. As a person, I want my answer to resume the same `resolve` step with the merge still in progress, so that the agent continues where it stopped.
73. As a person stopping `norn watch` cleanly while a resolve waits at an ask with a merge in progress, I want the exit never to be blocked and that story's claim kept (not released), so that the merge survives a restart on the same machine.
74. As a person running `norn story handoff` on a story whose resolve waits at an ask with a merge in progress, I want it refused with a `do_instead` to answer the question or unstick the step first, so that an unfinished merge is never handed over (it cannot be pushed).
75. As a resolving agent facing a merge it cannot understand, I want aborting and `norn stuck` to stay available, so that hopeless merges still escalate cleanly.
76. As a resolving agent, I want the `norn-merge` skill to say when to ask and when to abort, so that I choose the right way out.

## Out of Scope

- A merge queue — rejected in #237: it needs an org-owned repo and costs about N²/2 CI runs and approvals.
- Pushing only when files changed, `[skip ci]`/skip-checks on bookkeeping commits, `paths-ignore`, or skipping CI on commits with no file changes — each leaves pushes in place or leaves required checks pending or untested.
- A setting to keep pushing every boundary — the push rule is always on.
- Suggesting or enforcing a merge order between overlapping stories — the overlap item informs; the person decides.
- Regenerating golden cases automatically — their diff is a behaviour change that needs review.
- Rebasing a published story branch — norn keeps merging.

## Further Notes

- **Slice order.** All nine changes are delivered in this story, and slicing handles the size. Slices land the push rule, the merge step, the `story edit` pointer, the light path and the base side first. The re-verify, overlap, regenerate and ask-instead-of-abort changes build on them, with the re-verify after the merge step. If any of those four meets a decision nothing here settles, it goes to Open questions, not out of scope.
- **release.yaml.** Whether `.agents/workflows/release.yaml` gets the merge step (and how the push rule reaches it) is decided in the plan; the person leans yes.
- **Names.** The exact names of the merge step type's outcomes, the light-path update outcomes, the resolution-review step and its outcomes, and the regenerate config key are for the plan; this spec fixes their behaviour.
- **Closes #126.** The PR body says "Closes #126".
- Shipped workflows change in both copies (the bundled one and the repo's own); the merge skill changes in its bundled copy.

## Open questions

None.

## Plan

### Seams
- **S1 core decide, through `decide`, `applyReceipts`, `buildInbox` and `validateWorkflowDefinition`** (scripted Facts and receipts in, decisions and inbox out). Observes: which boundary commits push the branch and which push only the heads ref; the merge step (waits, one merge item, ends on merge or a closed PR, `stale` back to update behind `gate.stale.awaits_sync`); the update outcome choice (`done` / `clean` / `resolved` / `conflict`) from the update's git summary; the carried approval at `ready`; when a verify run is ordered and where red goes; the open-pr guard; the overlap Check item; workflow validation (merge type, `base.verify`, the open-pr path rule).
  Prior art: `base-sync.test.ts` (scripted `StoryBase`, BASE_WF, stale cases 4/4a/4b/5), `decide.test.ts`, `workflow.test.ts`, the golden corpus (`golden.test.ts`, `rule-cases.ts` for every new rule id).
- **S2 core brief, through `renderBrief`.** Observes the `resolution` and `base_side` inputs, the base-update section's ask-or-abort guidance, and a failed regenerate's output in Rework.
  Prior art: `brief.test.ts` and its snapshot (base section).
- **S3 cli harness, through `createHarness` (`h.norn`, `h.tick`) on real git with `FakeRemote`.** Observes the push rule end to end (no branch push after open-pr, the heads ref at every boundary, the PR head at merge equals the commit `ci` watched: no branch push after `ci.pass` or `ready.approve`), claim release (handoff, watch exit, close; a person's push merged, never rebased), takeover from the heads ref, the record push, the `story edit` refusal, regenerate and the spec-folder-only auto-resolve, the git summary the update step gathers (remerge-diff, paths per commit, trailers), the base side gathered at `norn brief`, the verify run in a temp worktree, the overlap cache, the regenerate config key, ask-with-a-merge-in-progress (watch keeps the claim, handoff refused), workflow parsing (YAML anchors).
  Prior art: `human.test.ts` (story edit, `refused`), `release-record.test.ts` (handoff / watch exit / close push order), `takeover-record*.test.ts`, `integrate.test.ts` (update, `syncRemoteBranch`, H1 merge in progress), `check-run.test.ts`, `ci-check.test.ts`, `config.test.ts`, `pr-evidence.test.ts`, `test/e2e/merged-pr.test.ts`; store's workflow parsing tests for `parseWorkflowText`.
- **S4 GitPort contract, through `gitContract`.** Observes the new git operations: remerge-diff of a merge commit, a merge that keeps its conflicts in the worktree (for regenerate), the paths each commit in a range touches, pushing to a non-branch ref.
  Prior art: `packages/adapters/test/contract/git.ts` ("merge: clean merges commit, conflicts abort…", inProgress), run by the git integration test and, for the fakes, `contract-fakes.test.ts`.
- **S5 e2e base-sync transcript, through the recorded flow in `test/e2e/base-sync.test.ts`.** Observes that one rework loop with an open PR pushes the story branch exactly once, at open-pr: the transcript pins every push argv. Rewritten with `NORN_TRANSCRIPT_UPDATE=1` as an intended change and reviewed.
  Prior art: the base-sync transcript itself and `test/support/transcript.ts`.

Docs, skill text and shipped YAML are observed by the docs lint (`test/repo/docs.test.ts`), the reference staleness test (`reference.test.ts`), validation of the shipped workflows at S1, and review.

### Coverage
| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1 no branch push at boundaries once the PR is open (draft too) | S1 | unit | `commit.push` false, heads ref instead |
| 2 `git: update` merges without pushing while the PR is open | S3 | integration | |
| 3 open-pr pushes the branch before creating/updating the PR | S3 | integration | |
| 4 a rework loop starts exactly one CI run | S5 | e2e | pinned push list |
| 5 PR head at merge is the commit `ci` saw pass | S3 | integration | no branch push after ci.pass / ready.approve |
| 6 ready approve and entering merge push nothing to the branch | S1 | unit | |
| 7 handoff puts the latest boundary on the remote (heads ref while PR open) | S3 | integration | |
| 8 clean watch exit does the same per released claim | S3 | integration | |
| 9 story close pushes the branch first | S3 | integration | heads ref deleted after |
| 10 `record.policy: remote` record push keeps working | S3 | integration | waits on the heads ref, not the branch |
| 11 no PR yet: boundaries push as today | S1 | unit | plus the heads ref |
| 12 takeover resumes from the heads ref; limitations note | S3 | integration | note: docs lint + review |
| 13 a person's push merges with local boundaries, never rebased | S3 | integration | |
| 14 push rule always on, no setting | S1 | unit | no config key exists to read |
| 15 step type `merge` | S1 | unit | schema + validation |
| 16 shipped story/quick route ready.approve → merge | S1 | unit | shipped workflows validated |
| 17 one merge item at the merge step, no gate item | S1 | unit | `buildInbox` |
| 18 PR merging ends the story through today's merge path | S1 | unit | |
| 19 PR closed unmerged behaves as today | S1 | unit | |
| 20 conflicting base move at merge → update via `stale_loop` (after awaits_sync) | S1 | unit | squash-merged PR never read as a base move |
| 21 nothing to approve or reject at merge | S1 | unit | approve/reject refused |
| 22 workflows without a merge step unchanged | S1 | unit | existing golden cases stay |
| 23 `story update-branch` keeps working (also at merge) | S3 | integration | |
| 24 merge step documented | — | docs lint + review | concepts.md, reference, recipes |
| 25 `story edit` same workflow, no `--at`, conflicting PR → refused | S3 | integration | code `update_branch_instead` |
| 26 other workflow or `--at` still starts the round | S3 | integration | |
| 27 AGENTS.md and the base recipe point at update-branch | — | docs lint + review | |
| 28 light path only for base merges + spec-folder-only commits (not spec.md) since the anchor | S1 | unit | pure outcome choice |
| 29 ready reject / ci fail → implement → update takes the full path | S1 | unit | |
| 30 spec.md changed since approval → full path | S1 | unit | |
| 31 light path as update outcomes `clean` / `resolved` in YAML | S1 | unit | |
| 32 unrouted outcomes fall back to `done` | S1 | unit | |
| 33 decided from git and receipts alone | S1 | unit | facts in, outcome out |
| 34 shipped story/quick route the light path | S1 | unit | shipped workflows validated |
| 35 `resolution` input: remerge-diff per merge since the anchor | S2 | unit | gathering at S3 via update summary |
| 36 clean merge skips the resolution review | S1 | unit | |
| 37 resolution review blocking → resolve | S1 | unit | |
| 38 describe again only on `redescribe`; else open-pr keeps the body | S1 | unit | |
| 39 regenerated merge counts as clean only if remerge-diff ⊆ mapped paths | S1 | unit | trailer and paths both required |
| 40 approval carried after a clean merge with green test and CI | S1 | unit | |
| 41 carried approval in receipts and History | S1 | unit | |
| 42 resolved merge asks for a fresh approval | S1 | unit | |
| 43 ready item, brief and PR evidence show the remerge-diff | S3 | integration | item text at S1 too |
| 44 red test/CI never reaches ready carried | S1 | unit | |
| 45 `base_side` input per conflicting path | S3 | integration | gathered at `norn brief` |
| 46 brief lists the base side; norn-merge reads it first | S2 | unit | skill: review |
| 47 trailer-less base commits listed without a story | S2 | unit | |
| 48 shipped resolve takes `base_side` | S1 | unit | shipped workflows validated |
| 49 workflow key `base.verify` | S1 | unit | |
| 50 shipped story/quick set `base.verify: test` | S1 | unit | |
| 51 `base.verify` + `stale: behind`, or a non-check step → invalid | S1 | unit | |
| 52 verify on the merged tree in a temp worktree, no push/CI/approval | S3 | integration | |
| 53 verify cached per (head, base sha) | S1 | unit | receipt `verify: {head, base}` |
| 54 verify runs detached and takes a slot | S1 | unit | `checksFree` |
| 55 red verify → `stale` edge, `stale_loop`, `last_check` | S1 | unit | |
| 56 green verify leaves the story waiting | S1 | unit | |
| 57 no `base.verify` → no verify | S1 | unit | |
| 58 overlap Check item naming both stories and paths | S1 | unit | |
| 59 only stories with commits of their own, in flight or finished with an open PR | S1 | unit | eligibility from Facts |
| 60 overlap cached per pair of heads | S3 | integration | `overlap.json` |
| 61 item clears itself, no dismiss, no order | S1 | unit | |
| 62 spec-folder-only conflicts don't count | S1 | unit | |
| 63 regenerate key in the team config | S3 | integration | |
| 64 all conflicts mapped → base side, commands, merge committed, no agent | S3 | integration | |
| 65 any unmapped conflict → resolve | S3 | integration | |
| 66 failed command or still conflicted → resolve with output in brief | S3 | integration | brief text at S2 |
| 67 regenerated merge goes through test | S1 | unit | |
| 68 this repo maps schema:emit and docs:emit, never golden cases | — | review | `.agents/norn.config.yaml` |
| 69 spec-folder-only branch takes the base side with no agent, as a merge | S3 | integration | Closes #126 |
| 70 regenerate key documented | — | reference staleness test + review | |
| 71 resolver can ask with the merge in progress | S2 | unit | brief text; no abort required |
| 72 answer resumes resolve with the merge still in progress | S3 | integration | |
| 73 clean watch exit keeps that story's claim, never blocked | S3 | integration | |
| 74 handoff refused (`merge_in_progress`) | S3 | integration | |
| 75 abort and `norn stuck` stay available | S2 | unit | |
| 76 norn-merge says when to ask and when to abort | — | review | bundled skill copy |

### Prefactoring
1. One push path for claim release — `releaseStory` (handoff, watch exit) and `closeStory` push through `ActEnv.pushBranch` (adopt-and-merge on a rejected push) instead of a plain push behind a fast-forward check. No behaviour change today; it is what keeps a person's push merged once boundaries stay local (7, 8, 9, 13). The person wants both prefactorings in a slice of their own, first.
2. The update step's outcome choice moves into a pure core function — act passes the merge result (and later the commits since the anchor) and gets `done` / `conflict` back, instead of picking it in the git step. Makes the light-path outcomes (28–33, 36, 39) testable at S1.

### Implementation decisions
- D1 **"PR open"** for the push rule is `pr ?? pr_seen` with state `open`; a draft counts. Slice finishing (act's hard-coded push of the slice status commit onto the story branch) follows the same rule.
- D2 **Heads ref.** `refs/norn/heads/<story>` (named in `ids.ts` beside the other prefixes) is pushed at every boundary under both record policies: with the branch in one `git push` before the PR is open, in place of the branch push while it is open. It is neither branch nor tag, so it starts no CI. Fetched per story like the record ref, never `refs/norn/*`. Removed when the story ends (merge cleanup, close) and by `norn tidy`. Takeover resumes from it, merged with the remote branch, never rebased. The record push waits on it, not on the branch, and `Norn-Branch-Commit` names it.
- D3 **Claim release while the PR is open** (handoff, watch exit) puts the latest boundary on the heads ref, not the branch, so the PR head stays the commit CI ran on. `norn story close` pushes the branch first (the heads ref goes away at close). `update` never pushes while the PR is open; open-pr is the one branch push per loop.
- D4 **Open-pr guard.** Static: `validateWorkflowDefinition` refuses a workflow where a path from an `open-pr` step reaches a gate or a `merge` step through an agent step or `git: update` without passing `open-pr` again. Runtime: observe reports the paths changed between the PR head and the local head; at a gate or merge step, any path outside the story's spec folder makes decide move the cursor to the workflow's `open-pr` step (receipt: changes since open-pr not on the PR). Spec-folder-only changes are bookkeeping and stay local.
- D5 **Merge step.** `type: merge`; one fixed outcome, `stale`. Waits on entry like a gate; approve/reject there refused. The inbox shows today's `mergeItem` when the cursor is at a merge step (and on a finished round, as today), never a gate item. Merged and closed PRs go through today's `storyLifecycle`. `stale` is taken only after `gate.stale.awaits_sync` (a PR not fetched this tick waits for a sync), so a squash-merged PR is never read as a base move. `story update-branch` accepts a story waiting at a merge step. Added after `ready` in story, quick (both copies) and `release.yaml` (`stale: behind` → update → prepare rewrites the changelog; no `base.verify`, which `behind` forbids).
- D6 **`story edit` refusal.** Code `update_branch_instead`, exit 3, `do_instead: norn story update-branch gh-N`, only for a finished round, no `--at`, the same workflow the round ran, and a known open PR (`pr ?? pr_seen`) whose base conflicts.
- D7 **Light-path outcomes.** `git: update` gains outcomes `clean` and `resolved`, taken only when routed and the light condition holds; otherwise `done`. Anchor: the head at the latest receipt in the round whose outcome is `approve`, at any step (review, resolution review, `ready`); an agent `done` receipt gains `head_sha` (schema change) as gate approvals have. Light condition: every commit from the anchor to the pre-merge head is a merge of the base or touches only the story's spec folder, not `spec.md`. `clean`: every merge since the anchor has an empty remerge-diff, or carries `Norn-Regenerated` **and** its remerge-diff touches only paths the regenerate mapping matches. Otherwise `resolved`. Act gathers the git summary (per commit: parents, paths, trailers, remerge-diff paths) into the classify receipt; the core function from prefactor 2 chooses.
- D8 **Shipped light route** (story and quick, both copies): `update: { done: test, clean: test-merge, resolved: test-resolution, conflict: resolve }`; `test-merge` pass → open-pr, `test-resolution` pass → `resolution-review`, both fail → implement (`test_loop`; a semantic break is implement's work and then takes the full path). The test command is written once with a YAML anchor (`run: &test-run …` / `run: *test-run`); the loader (`yaml` `parse`) resolves aliases, pinned by a test. `resolution-review`: agent, `norn-review`, inputs `[spec, resolution]`, outcomes `approve` → open-pr (body kept), `redescribe` → describe, `changes_requested` → resolve (counter `resolution_loop`).
- D9 **Carried approval.** At `ready`, decide approves on its own (approve receipt with `carried: "clean base merge"`, shown in History) when, since the last `ready` approve, the only update outcomes were `clean` and test and CI passed. Any `resolved` update means a fresh approval; the `ready` item, the brief and the PR evidence then list the remerge-diff commands.
- D10 **Inputs as pointers.** `resolution`: one `git show --remerge-diff <sha>` per merge since the anchor. `base_side`: per conflicted path, the base commits between merge base and base sha (sha, subject, `Norn-Story` trailer or none — squash commits on main keep it in their last trailer block — and that story's `spec.md` / `pr.md` paths on the base), computed by the cli at `norn brief`. Both added to `InputKind`; shipped `resolve` takes `base_side`.
- D11 **Re-verify.** At `ready` or a merge step, base moved, no conflict, `base.verify` set: decide orders a `run_check` of that step marked verify (needs a free check slot). Act builds the merged tree (`merge-tree --write-tree`), runs the check detached in a temp worktree on it (the `record.ts` pattern), no push. The check receipt records `verify: {head, base}`; decide orders none for a pair that has one (the cache is the receipts). Red takes the waiting step's `stale` edge with `stale_loop`, the receipt becoming `last_check`; no edge → today's Check item. Green: nothing. Validation: `base.verify` must name a check step and is invalid with `base.stale: behind`.
- D12 **Overlap.** Observe runs `git merge-tree --write-tree --name-only` per eligible pair of heads (own commits beyond the base; unit in flight or finished round with an open PR), cached per pair of heads in the machine dir (`overlap.json`, schema in `local.ts`, beside `base.json`), into Facts `overlaps`. `buildInbox` adds one Check item per pair, id `overlap:<a>:<b>`, paths inside either spec folder dropped; it clears with the facts.
- D13 **Regenerate.** Team key `regenerate: [{ paths: [glob…], run: cmd, timeout?: duration }]`, timeout default 2m per entry (it holds the tick). In act's update: when every conflicted path matches, keep the merge's conflicts, take the base side of each, run the matched commands bounded, check nothing is still conflicted, commit with `Norn-Regenerated: <paths>`; a failure or timeout aborts the merge and goes `conflict` → resolve with the output in the brief. Spec-folder-only branch: built in, no config, base side of every conflicted file outside the folder, still a merge. Docs say commands must be fast and deterministic. This repo maps `schema:emit` and `docs:emit` outputs, never golden cases.
- D14 **Ask instead of abort.** A clean watch exit keeps the claim of a story whose unit waits at an ask with `in_progress` merge in its worktree, never blocks. `story handoff` refuses `merge_in_progress` (do_instead: answer or unstick first). Brief's base section and `norn-merge` (bundled copy) say: ask when both intents are valid and a person must choose; abort and `norn stuck` when the merge cannot be understood.

### Testing decisions
A good test drives a seam with what a user or the tick would produce and checks what the user sees: decisions, inbox items, refusals and exit codes, refs on the remote, the brief's text. Never internals of act or observe. Core is tested with scripted Facts (S1/S2); cli behaviour with the harness on real git (S3); new git operations once in the contract suite (S4) so S3 fakes nothing of git. Only system boundaries are faked: the remote host (`FakeRemote`: PR state, mergeable, CI), the clock, the agent runner. Golden cases change only through `bun run golden -- --update` for the push flag and the merge step, reviewed as the behaviour change; each new rule id gets a golden or hand-built case. The base-sync transcript and observe snapshots are rewritten only as the intended change.

### Risks
- **Push rule breadth.** Every boundary's `commit.push` changes, as do record push, takeover and release; the golden and transcript diffs will be large. Land the heads ref and push rule early, behind prefactor 1, and read the diffs as the proof.
- **Anchor accuracy.** A wrong anchor sends new work down the light path without a full review. Cover the reject / ci-fail / spec.md cases (29, 30) at S1 before routing the shipped workflows.
- **Remerge-diff** needs git ≥ 2.36 (this machine has 2.54); the git contract pins it, and an older git must fail closed to `resolved`/`done`, never `clean`.
- **Regenerate holds the tick** up to its timeout; bounded at 2m per entry by default.
- **Verify slot pressure** competes with real checks; it only runs when `checksFree` allows and once per (head, base).
- **Merge step and story phase.** Code that keys on a finished round (`roundFinished`, `storyPhase`, the inbox, update-branch's `waitsForBaseUpdate`) must treat a merge-step wait as waiting for the merge; S1 covers each.
