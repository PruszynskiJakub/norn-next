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
workflow: refinement
status: active
intake_at: 2026-11-11T08:57:13.816Z
body_hash: 1b55f889d5de53b6fa4f6dbe2428a8cb2c5656d55a45a93059f08ed6e5ef6e61
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
7. As a person handing a story to another machine with `norn story handoff`, I want norn to push the story branch with every local boundary commit before it releases the claim, so that the next holder starts from the story's latest boundary.
8. As a person stopping `norn watch` cleanly, I want each story whose claim it releases to be pushed first, so that no local-only boundary is left behind when the claim goes.
9. As a person closing a story with `norn story close`, I want its branch pushed first, so that the closed story's last state is on the remote.
10. As a person using `record.policy: remote`, I want the record push to keep working as today, so that another machine can read the story's state even while boundaries are local.
11. As a person whose story has no PR yet, I want boundaries pushed exactly as today, so that nothing changes before CI could be triggered.
12. As a person taking over a story under `record.policy: local` after the previous machine crashed, I want norn to resume from the last pushed boundary, and `docs/limitations.md` to say so, so that I know a crash can cost the steps since the last push (their commits are still in the crashed machine's worktree).
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
