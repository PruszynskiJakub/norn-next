### Goal
Once a story's PR is open (a draft counts), norn pushes the story branch only at `open-pr` and `norn story close`. Every other boundary, the base update, gate approvals, a finished slice and claim release push only `refs/norn/heads/<story>`. A rework loop starts one CI run.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | with the PR open (or draft), a boundary commit (bookkeeping, empty, a slice's status commit onto the story branch) leaves the remote branch alone and moves the heads ref | test | `packages/core/test/unit/decide.test.ts` › "push rule: once the story's PR is open…" (open, draft, last seen open, gone, slice boundary, mark_done); `packages/cli/test/integration/push-rule.test.ts` › "AC1, AC2, AC3, AC4: a rework loop…" |
| AC2 | `git: update` merges the base locally, on the heads ref only | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (two-parent merge, remote branch unchanged, heads ref = head); decide.test.ts › "git steps that move the story branch…" |
| AC3 | open-pr pushes the story branch before it creates or updates the PR, and the PR shows that head | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (one branch push at open-pr, holding the base merge) |
| AC4 | ready approving pushes nothing to the story branch | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (remote branch = atOpenPr after the ready approve); see finding F1 for a side effect |
| AC5 | story handoff and a clean watch exit put the latest boundary on the heads ref, not the branch; story close pushes the branch first | test | push-rule.test.ts › "AC5: story handoff…", "AC5: a clean watch exit…", "AC5: story close pushes the story branch first" |
| AC6 | a person's push while norn holds unpushed boundaries survives through a merge, never a rebase | test | push-rule.test.ts › "AC6: a person's push…merged at open-pr"; `test/e2e/base-sync.test.ts` › BS3.3a |
| AC7 | the recorded base-sync flow shows exactly one story-branch push per rework loop, at open-pr | test | `test/e2e/base-sync.test.ts` with `test/e2e/transcripts/base-sync.txt` (pinned) |

- "PR open" is `prOpen(story)` in `packages/core/src/policy.ts`: the PR fetched this tick, else the one last seen (`knownPr`), with state `open`.
- Review #1: `bun run test` 1856 pass, `bun run typecheck` clean. Golden diff is `push:true → push:false, heads:true` in 6 open-PR cases, nothing else changed.

### Easy to miss
- The rule applies only to the story branch. Slice branches (names with `/`) still push at every boundary: they are not PR heads and carry no heads ref.
- `BoundaryCommit.heads`, `RunGitAction.heads` (integrate, update) and `MarkDoneAction.heads` (the slice status commit) are what decide sets. Act passes them to `pushBranch({ heads })` in runtime/push.ts. That pushes only the forced heads ref, never retries a rejection, and keeps the conflict-marker hold.
- Release (`runtime/release.ts`) uses `prOpen` directly. A clean watch exit observes with `sync: never`, so `pr_seen` decides there.
- An explicit `git: push` step still pushes the branch. It is the workflow author's own push, and no shipped workflow has one.
- H1/BS5 in base-sync e2e now asserts that the remote branch and the heads ref did not move when a norn commit was refused for conflict markers. Before, it compared the remote branch to the local HEAD, which only matched while every boundary pushed the branch.

### Not proven yet
- **Review #1, blocking (F1): a false "PR head changed after ready approval" Check item.** The ready approval records the local head Z. That is now past the PR head X, because the open-pr and ci boundaries are heads-only. `readyHead` (`packages/cli/src/runtime/observe/remote.ts:33`, and the same code in `packages/view/src/load.ts:356`) only accepts a PR head that is a descendant of the approved one, so `headChangedItem` (`packages/core/src/inbox/items.ts:771`) fires on every approval while the PR is open. Treat X as an ancestor of Z, with only this story's norn commits between them, as unchanged, and test it. A person's push after the approval must still raise the item.
- **Takeover with a diverged heads ref.** The heads ref is now routinely ahead of the PR branch. If a person pushes to the branch at the same time and the holder crashes, the heads ref and the branch diverge. Takeover (`checkout.ts`, `aheadOf`) then takes the remote branch and drops the heads ref's boundaries; it does not merge them (user story 12). Slice 02 left this open, and this slice's criteria do not cover it. It needs a way to tell a person's push from a deliberate rewrite.
- The rest of the integration tier and the e2e tier run in CI. Locally only push-rule.test.ts and base-sync e2e ran. Any other integration test that expects the remote branch to move at a boundary while the PR is open needs the same update as BS3.3a.

### Notes
- `docs/concepts.md`: a new paragraph after the heads-ref paragraph explains the push rule.
- Friction: the brief says not to run the e2e tier, but the slice's checks need the base-sync transcript rewritten, so that one file was run.

### Resume
Rework F1 (findings in the review receipt): in `readyHead` (observe and view), treat a PR head that is an ancestor of the approved head, with only this story's norn commits between them, as unchanged. Add a test showing that an approval with the PR open and heads-only boundaries leaves no head-changed item, and that a person's push after the approval still raises one.
