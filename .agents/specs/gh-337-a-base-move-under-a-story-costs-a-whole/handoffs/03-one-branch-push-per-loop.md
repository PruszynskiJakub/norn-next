### Goal
Once a story's PR is open (a draft counts), norn pushes the story branch only at `open-pr` and `norn story close`. Every other boundary, the base update, gate approvals, a finished slice and claim release push only `refs/norn/heads/<story>`. A rework loop starts one CI run.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | with the PR open (or draft), a boundary commit (bookkeeping, empty, a slice's status commit onto the story branch) leaves the remote branch alone and moves the heads ref | test | `packages/core/test/unit/decide.test.ts` › "push rule: once the story's PR is open…" (open, draft, last seen open, gone, slice boundary, mark_done); `packages/cli/test/integration/push-rule.test.ts` › "AC1, AC2, AC3, AC4: a rework loop…" |
| AC2 | `git: update` merges the base locally, on the heads ref only | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (two-parent merge, remote branch unchanged, heads ref = head); decide.test.ts › "git steps that move the story branch…" |
| AC3 | open-pr pushes the story branch before it creates or updates the PR, and the PR shows that head | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (one branch push at open-pr, holding the base merge) |
| AC4 | ready approving pushes nothing to the story branch, and raises no false head-changed item | test | push-rule.test.ts › "AC1, AC2, AC3, AC4…" (remote branch = atOpenPr after the ready approve; with the PR head at atOpenPr no `head:` item; a person's push after it raises one) |
| AC5 | story handoff and a clean watch exit put the latest boundary on the heads ref, not the branch; story close pushes the branch first | test | push-rule.test.ts › "AC5: story handoff…", "AC5: a clean watch exit…", "AC5: story close pushes the story branch first" |
| AC6 | a person's push while norn holds unpushed boundaries survives through a merge, never a rebase | test | push-rule.test.ts › "AC6: a person's push…merged at open-pr"; `test/e2e/base-sync.test.ts` › BS3.3a |
| AC7 | the recorded base-sync flow shows exactly one story-branch push per rework loop, at open-pr | test | `test/e2e/base-sync.test.ts` with `test/e2e/transcripts/base-sync.txt` (pinned) |

- "PR open" is `prOpen(story)` in `packages/core/src/policy.ts`: the PR fetched this tick, else the one last seen (`knownPr`), with state `open`.
- Review #1 F1 (false "PR head changed after ready approval" item) is fixed: `readyHead` (`packages/cli/src/runtime/observe/remote.ts`) and its copy in `packages/view/src/load.ts` accept a PR head apart from the approved head by this story's norn commits only, in either direction (PR head behind the approval by heads-only boundaries, or past it by the `$done` commit). Red first: push-rule.test.ts › "AC1, AC2, AC3, AC4…" failed with `head:gh-1:<atOpenPr>` before the fix.
- `bun run test` 1856 pass, `bun run typecheck` clean. Golden diff is `push:true → push:false, heads:true` in 6 open-PR cases, nothing else changed.

### Easy to miss
- The rule applies only to the story branch. Slice branches (names with `/`) still push at every boundary: they are not PR heads and carry no heads ref.
- `BoundaryCommit.heads`, `RunGitAction.heads` (integrate, update) and `MarkDoneAction.heads` (the slice status commit) are what decide sets. Act passes them to `pushBranch({ heads })` in runtime/push.ts. That pushes only the forced heads ref, never retries a rejection, and keeps the conflict-marker hold.
- Release (`runtime/release.ts`) uses `prOpen` directly. A clean watch exit observes with `sync: never`, so `pr_seen` decides there.
- An explicit `git: push` step still pushes the branch. It is the workflow author's own push, and no shipped workflow has one.
- H1/BS5 in base-sync e2e now asserts that the remote branch and the heads ref did not move when a norn commit was refused for conflict markers. Before, it compared the remote branch to the local HEAD, which only matched while every boundary pushed the branch.

### Not proven yet
- **Takeover with a diverged heads ref.** The heads ref is now routinely ahead of the PR branch. If a person pushes to the branch at the same time and the holder crashes, the heads ref and the branch diverge. Takeover (`checkout.ts`, `aheadOf`) then takes the remote branch and drops the heads ref's boundaries; it does not merge them (user story 12). Slice 02 left this open, and this slice's criteria do not cover it. It needs a way to tell a person's push from a deliberate rewrite.
- The rest of the integration tier and the e2e tier run in CI. Locally only push-rule.test.ts and base-sync e2e ran. Any other integration test that expects the remote branch to move at a boundary while the PR is open needs the same update as BS3.3a.

### Notes
- `docs/concepts.md`: a new paragraph after the heads-ref paragraph explains the push rule.
- Friction: the brief says not to run the slower tiers, but the slice's checks need the base-sync transcript rewritten and the F1 test is integration-only (store git helpers are banned in unit tests), so base-sync e2e and push-rule.test.ts were run alone.

### Resume
Review the F1 fix and the whole slice against AC1-AC7: `git diff 7e6ec8698` for the rework, `bun run test` and `bun run typecheck` for the fast checks.
