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

## Observed

Seen with norn 0.31.0; checked against `main` at 0.32.0. Two problems compound: what norn does when the base moves under a story, and how often it pushes once the story's PR is open.

**gh-327, 2026-11-11.** gh-327 was approved at `ready` (`$done`) and its PR was open. Then #333 merged and gh-327 conflicted with `main` in `packages/cli/test/integration/ci-check.test.ts`, a 2-line conflict. norn did nothing on its own: the tick never moves a done unit, and the gate's `stale` route only applies while the story waits at the gate. The person started a new round with `norn story edit gh-327 --workflow quick`, since `norn story update-branch` only shows up as the merge item's command. That round ran sync → sync-resolve → implement (an agent with nothing to do) → update → test → review (of the whole story) → describe → open-pr → ci → ready, then a second approval. The resolution was right: `git show --remerge-diff c80b03bbf` keeps both sides. But it cost 4 agent sessions and pushed **10 commits in 9 minutes**. Each push starts 3 workflow runs (CI, process, dependabot auto-merge), so about 30 runs, roughly 10 of them cancelled. Only one of the 10 commits held the resolution. Five changed only the handoff (`story.md`) and six changed nothing.

**#324.** A rework loop (implement → update → test → review → describe → open-pr) pushed about 6 times within minutes, and 5 CI runs were cancelled between 12:01 and 12:04.

### The problems

1. **Every boundary pushes, so each push after the PR opens starts a full CI run.** `commitFor` commits a story unit's boundary even when no file changed (`allow_empty`) and always pushes. `ci.yml` runs on every `pull_request` push and cancels the run before it. After `ci` passes, `ci.pass → ready` and `ready.approve → $done` push two more commits. Each starts runs that finish, and branch protection checks the PR's head at merge, which is the `$done` commit. So the run the `ci` step watched is never the run that allows the merge.
2. **An approved story whose PR is still open is outside its workflow.** `ready.approve → $done` ends the round while the PR waits for a person. That is the longest wait in a story's life, and so the most likely time for the base to move. A conflict then shows only as a merge item whose command switches to `norn story update-branch`. A person has to notice it and know the command.
3. **The command people reach for is the wrong one.** `norn story edit gh-N --workflow quick` on a finished story with a conflicting open PR starts a whole round from `sync`, including an `implement` step with nothing to do. Nothing points to `update-branch`. AGENTS.md's "Only a person starts the next round (`norn story edit …`)" steers people towards `story edit`.
4. **After a resolve, the story reruns the whole tail of the workflow.** It goes update → test → review → describe → open-pr → ci → ready. Review gets `diff`, the story against its base. A resolution that dropped a change from the base shows up there as an ordinary story change, so it is easy to miss. The one diff that shows exactly what the resolver did, `git show --remerge-diff <merge>`, is never reviewed. Describe rewrites `pr.md` when the change it describes did not change.
5. **The resolve agent sees only its own side.** `resolve` gets `inputs: [spec, handoff]`, its own story's. It rebuilds the base side's intent from `git log`, although norn knows which story landed the conflicting commits (`norn: gh-326 done` on `main`, its spec folder and `pr.md`).
6. **Semantic conflicts go unnoticed.** `storyBase` detects conflicts with `git merge-tree`, which is textual only. A waiting story whose merge is textually clean but broken (it calls something the base renamed) raises nothing, and GitHub reruns no CI when the base moves. #237 (merge queue) was closed as not planned: the queue needs an org-owned repo, and `base.stale: behind` means about N²/2 CI runs and approvals.
7. **No warning when open stories overlap.** gh-326 and gh-327, both about CI and started an hour apart, both edited `ci-check.test.ts`. norn compares each story only with its base, never with the other stories in flight, so nobody saw it coming or chose a merge order.
8. **Generated files cost an agent run.** Past resolutions were mostly golden JSON, snapshots, transcripts and emitted docs (`git log --merges` with `--remerge-diff`). The skill already says to "take either side, then regenerate", but every time an agent session does it. #126 is the spec-folder-only case of the same idea.
9. **Escalation discards the work.** The resolver's only way out is `git merge --abort` plus `norn stuck`, which throws away a partial resolution, and the person then has to restart the step. In practice all 10 resolves so far ended `resolve.done`, so this is the lowest priority.

### What works and stays

It merges and never rebases a published branch. Detection is cached per (head, base sha). The tool aborts cleanly. Counters reset on each base move. The integrate lock is held per story. A person's push to the branch is adopted. The `norn-merge` skill resolves by intent and never takes a side wholesale. Since 0.32.0, the `ci` check exits `3: stale` on a conflicting PR, and that routes to `update` (#327).

## Wanted

One change that makes a base move under a story cheap, automatic and reviewable, and makes each rework loop cost one CI run.

1. **Push rule.** Once the story's PR is open, only `open-pr` pushes the story branch (it already does, before it creates or updates the PR), plus hand-over: claim release (`norn story handoff`, a clean `norn watch` exit), `norn story close`, and the record push. Boundary commits and the push inside `git: update` stay local until then. Before a PR exists nothing changes, since pushes start no `pull_request` CI.
   - Each rework loop starts exactly one CI run, the one `ci` waits on, and the PR's head at merge is the commit CI ran on. The `ci` script reads `headRefOid`, so it needs no change.
   - Rejected: pushing only when files changed. The handoff changes at every agent step, so gh-327 would still have pushed 5 of its 10 commits. `[skip ci]` / `skip-checks` on bookkeeping commits: the PR's head is always one, so its required checks would stay pending. `paths-ignore`: for `pull_request` it reads the whole PR's diff, so it never matches. Skipping CI on commits with no file changes: green would show on code a cancelled run never tested.
2. **Approved stories stay in the workflow until merged.** `ready.approve` goes to a step that waits for the merge, not to `$done`. The PR merging ends the story through the existing merge path. A base move that conflicts goes `stale → update` by itself, as it does at the gate today. The person's merge item comes from this step, so there is one item, not a merge item and a gate item. The rule that the tick never moves a done unit stays, because this unit is not done. `update-branch` stays for a stuck story and for workflows without the step.
3. **`story edit` on a finished story with a conflicting open PR** suggests `norn story update-branch gh-N` in `do_instead`. Fix the AGENTS.md line and the "The base moved under a story" recipe so people find it.
4. **A lighter path after a base update.** When a base update re-enters a story that had already passed review: update → (resolve) → test → a review of the resolution only → open-pr (push, keep the body) → ci → ready. The resolution review gets a new step input `resolution`, the `git show --remerge-diff` of each merge commit since the last review. Its blocking findings go to `resolve`, not `implement`. Describe runs again only if that review says the merge danger in `pr.md` changed. A clean merge has an empty remerge-diff and skips that review.
5. **The resolver gets the base side.** A step input `base_side`: for each conflicting path, the commits on the base between the merge base and the base sha that touched it, with the story key from their trailers and the paths of that story's `spec.md` and `pr.md` on the base. The brief's "Base update (merge skill, base mode)" section lists them, and the `norn-merge` skill reads them first.
6. **Re-verify waiting stories when the base moves.** When the base moves under a story waiting at `ready` or the merge step and `merge-tree` reports no conflict, a local check runs the workflow's test command on the merged tree in a temporary worktree. That means no push, no CI, no approval. Red goes to `update` with the failure as `last_check`. That costs one local test run per waiting story per base move, not CI runs and approvals.
7. **Overlap between open stories in `norn status`.** A Check item when two open stories' heads conflict with each other (`git merge-tree` between story heads, cached like `storyBase`), for example: `gh-326 and gh-327 both change ci-check.test.ts; whichever merges second needs a resolve`.
8. **Regenerate instead of resolving.** A config key mapping path globs to a regenerate command. When every conflicting path matches, `git: update` takes the base's version, runs the commands, and commits the merge with no agent; otherwise it goes to `resolve` as today. This repo maps emitted schemas and `docs/reference.md` (`bun run schema:emit`, `bun run docs:emit`), never golden cases, whose diff needs review. #126's spec-folder-only case is decided in this same step.
9. **Ask instead of aborting.** When keeping both intents needs a decision, the resolver uses `norn ask` with the files, what each side wants and the decision needed, and keeps the merge in progress. `norn stuck` with an abort stays for a merge it cannot understand.

## Costs to cover

- **Takeover.** Under the push rule the remote branch can be several boundaries behind. Another machine reads the story's last boundary from the branch's trailers (`docs/concepts.md:92`). Under `record.policy: remote` the record ref covers that. Under `local`, a takeover after a crash resumes from the last pushed boundary. Say so in `docs/limitations.md` and cover it in the takeover tests.
- **Diverged branches.** If a person pushes to the story branch while norn holds commits it has not pushed, the branches diverge. `syncRemoteBranch` then makes a merge commit where it fast-forwards today. Cover it in tests.
- **Re-approval.** After a base update the head changes, so `ready` needs approving again (the approval must be newer than the re-entry). Decide whether an empty remerge-diff plus a green test and CI may carry the earlier approval.

## Open questions

- Is the merge-waiting step a new step type, or a `gate` the person never answers (merge ends it, `stale` re-enters)? Settle it by how the inbox shows it.
- Should the local re-verify check (6) be per-workflow (`base.verify`) or always on when the workflow has a `git: update` step?
- Should 7 and 8 stay in this story or go out as follow-ups once 1–5 land?

## Where

- Push at a boundary: `packages/core/src/decide/receipts.ts:156` (`commitFor`, `push: true`, `allow_empty`), `packages/cli/src/runtime/act/env.ts:146`. Push in `git: update`: `packages/cli/src/runtime/act/git-step.ts:55` (`pushUpdated`). The `open-pr` push: `git-step.ts:127`.
- Base update and remote sync: `packages/cli/src/runtime/integrate.ts:77` (`syncRemoteBranch`), `:114` (`update`). Detection: `packages/cli/src/runtime/observe/git-facts.ts:30` (`storyBase`).
- Gate `stale`: `packages/core/src/decide/story.ts:498`. Inbox: `packages/core/src/inbox/items.ts:439` (`mergeItem`), `:485` (`staleItem`).
- `packages/cli/src/commands/story-update-branch.ts`, `packages/cli/src/commands/story-edit.ts`.
- Resolver brief: `packages/core/src/brief.ts:960`. Step inputs: `packages/schema/src/workflow.ts` (`StepInput`).
- Workflows: `quick.yaml` and `story.yaml` in both `packages/cli/assets/workflows/` and `.agents/workflows/`, plus `.agents/workflows/release.yaml` for the push rule. Skill: `packages/cli/assets/skills/norn-merge/SKILL.md`.
- Docs: `docs/concepts.md:92`, `docs/recipes.md` ("The base moved under a story"), `docs/limitations.md`, `AGENTS.md` (Process).
- Related: #126 (spec-folder-only auto-resolve), #237 (merge queue, not planned), #327 (ci `stale` exit, merged).
