# AC1–AC5 (verifier: test) — packages/cli/test/story-reopen.test.ts, run in this worktree
Full suite: `bun test` 1302 pass / 0 fail; `bun run typecheck` clean. Slice file: 8 pass / 0 fail (story-reopen-tests.txt).
- AC1: "restores worktrees and the claim, marks story.md active in one commit" + "next tick resumes the units at their steps" (01 at review gate, approve moves it on).
- AC2: stuck receipt {kind: stuck, by: human, reason: reopened, step: implement}; next ticks launch nothing; Unblock group; `run rerun` relaunches in the slice worktree.
- AC3: not_closed / issue_closed ("reopen the issue first") / branch_missing naming gh-7/02-list, each exit 3 with ls-remote unchanged and no worktree.
- AC4: "reopen after the base moved" + QA's own run in AC4.md (with tick --sync and a git:update step the base is merged after reopen, no failed decisions).
- AC5: left-behind slice worktree marker → acts on gh-7; no target interactive → pick-list offers [gh-7] only; non-interactive → target_required with `norn story reopen gh-7`.
Also through the real CLI (`bun packages/cli/src/main.ts`) in an empty throwaway repo: `story reopen gh-1 --json` → unknown_story, exit 3; `help` lists reopen under story.
