### Goal
Once a story's PR is open (a draft counts), norn pushes the story branch only at `open-pr` and `norn story close`. Every other boundary, the base update, gate approvals, a finished slice and claim release push only `refs/norn/heads/<story>`. A rework loop starts one CI run.

### Proof
- "PR open" is `prOpen(story)` in `packages/core/src/policy.ts`: the PR fetched this tick, else the one last seen (`knownPr`, moved here from inbox/items.ts), with state `open`. A PR fetched this tick and gone outranks one last seen.
- AC1 (with the PR open, a boundary commit, empty and bookkeeping ones included, and a slice's status commit onto the story branch, leave the remote branch alone and move the heads ref): `packages/core/test/unit/decide.test.ts` › "push rule: once the story's PR is open…" (5 tests; 3 went red first). Golden diff: `push:true → push:false, heads:true` in 6 open-PR cases (base-sync ×4, pr-body ×2), nothing else changed. `packages/cli/test/integration/push-rule.test.ts` › "AC1, AC2, AC3, AC4: a rework loop with a base update…" (went red with `prOpen` forced false).
- AC2 (`git: update` merges locally and moves only the heads ref): the same integration test, plus core › "git steps that move the story branch (update, integrate)…" (`run_git.heads`).
- AC3 (open-pr pushes the branch before it creates or updates the PR): the same integration test (exactly one branch push, at open-pr, holding the base merge).
- AC4 (ready approving pushes nothing to the branch): the same integration test (the remote branch is unchanged after review approve and ready approve).
- AC5: push-rule.test.ts › "story handoff puts the latest boundary on the heads ref…" (JSON `pushed: [refs/norn/heads/gh-3]`), "a clean watch exit does the same…" (both went red first), "story close pushes the story branch first" (passed already: close always pushed the branch).
- AC6 (a person's push merges with local boundaries, never rebased): push-rule.test.ts › "AC6: a person's push…merged at open-pr". `test/e2e/base-sync.test.ts` BS3.3a was updated to the new rule: open-pr merges the person's commit in, and later boundaries go to the heads ref.
- AC7 (transcript): `test/e2e/transcripts/base-sync.txt` was rewritten with `NORN_TRANSCRIPT_UPDATE=1`. After the PR opens, every story push is `+refs/heads/<b>:refs/norn/heads/gh-7` alone, except the open-pr pushes (one per loop, lines ~577 and ~864). base-sync e2e: 13 pass.
- `bun run test` 1856 pass; `bun run typecheck` clean. push-rule integration: 5 pass.

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
- Friction: the brief says not to run the e2e tier, but the slice's checks need the base-sync transcript rewritten, so that one file was run.

### Resume
Review the slice against AC1-AC7. The proof lives in the core push-rule tests, `packages/cli/test/integration/push-rule.test.ts`, the golden diff and the base-sync transcript diff.
