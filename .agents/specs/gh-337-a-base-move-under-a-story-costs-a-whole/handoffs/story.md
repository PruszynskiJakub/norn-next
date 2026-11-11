### Goal

Make a base move under a story cheap, automatic and reviewable, and make each rework loop cost one CI run: all nine changes from the issue, in this one story.

### Proof

- spec.md holds Problem Statement, Solution, 75 user stories grouped by change, Out of Scope, Further Notes; Open questions: none. Every decision was confirmed with the person in the refine interview.

### Easy to miss

- Light-path trigger is NOT "PR is open": only base merges + spec-folder-only boundary commits (excluding `spec.md`) since the latest review / resolution-review / ready approve. A ready reject or ci fail → implement → update must take the full path.
- A regenerated merge whose files are exactly what the mapped commands produce counts as clean (no resolution review, approval carried).
- A clean `norn watch` exit is never blocked: with a resolve parked at an ask mid-merge it keeps that story's claim; only `norn story handoff` is refused.
- Workflows without a merge step keep today's behaviour (ready.approve → $done, update-branch).
- `base.verify` + `base.stale: behind` is a validation error.

### Not proven yet

- Nothing built. The plan still has to choose: release.yaml gets the merge step (person leans yes); names of the merge step's outcomes, light-path update outcomes, resolution-review step, regenerate config key.
- Story 25 (`story edit` suggests `update-branch` in `do_instead`): whether `story edit` refuses or proceeds-with-hint on a finished story with a conflicting PR is for the plan; the person asked only that it suggests `update-branch`.

### Notes

- Scope: the person keeps all nine in one story; slicing handles size. Slice order: push rule, merge step, story-edit pointer, light path, base side first; then re-verify (after merge step), overlap, regenerate, ask-instead-of-abort. A decision nothing settles in 6–9 goes to Open questions, never dropped.
- PR must say "Closes #126" (spec-folder-only auto-resolve is built in here).
- Regenerate mapping lives in `.agents/norn.config.yaml`; this repo maps schema:emit and docs:emit outputs, never golden cases.
- Code anchors from the issue's "Where" (not in the spec on purpose): commitFor `packages/core/src/decide/receipts.ts:156`; gate stale `packages/core/src/decide/story.ts:498`; mergeItem/staleItem `packages/core/src/inbox/items.ts:439/:485`; pushUpdated/open-pr push `packages/cli/src/runtime/act/git-step.ts:55/:127`; syncRemoteBranch/update `packages/cli/src/runtime/integrate.ts:77/:114`; storyBase `packages/cli/src/runtime/observe/git-facts.ts:30`; resolver brief `packages/core/src/brief.ts:960`; StepInput `packages/schema/src/workflow.ts`.

### Resume

Plan the spec with the `norn-plan` skill.
