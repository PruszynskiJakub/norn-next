### Goal
Every push of the story branch also puts the story's head on `refs/norn/heads/<story>` in the same push, under both record policies. The record names it, a takeover after a crash resumes from it, and it goes when the story ends. Before the PR is open nothing else changes.

### Proof
- AC1 (no PR yet: the branch is pushed as today and the heads ref goes with it, in one push): `packages/cli/test/integration/heads-ref.test.ts` › "AC1: no PR yet…" (a post-receive hook logs each push; every branch push holds the heads ref); git contract › "push: several refspecs go in one push, a ref outside refs/heads among them" (went red first).
- AC2 (`record.policy: remote`: the record is pushed after the heads ref and names its commit in `Norn-Branch-Commit`): heads-ref.test.ts › "AC2…".
- AC3 (a takeover after a crash resumes from the heads ref, under both policies): heads-ref.test.ts › "AC3: record.policy local / remote…". The remote branch is put back behind the heads ref; B's worktree is at the heads ref commit and resumes at review.
- AC4 (the heads ref is removed when the story ends, and no config key turns it off): `packages/core/test/unit/decide.test.ts` › "PR merged → cleanup, the story's heads ref removed with its claim" (went red first; golden diff is only that ref in 3 cases); heads-ref.test.ts › "AC4: story close…" and "AC4: norn tidy…"; `packages/schema/test/unit/ids-config.test.ts` › "no config key turns the heads ref push off…".
- AC5: `docs/limitations.md` (Gaps › cross-machine handoff), plus a paragraph in `docs/concepts.md` after the record policies.
- `bun run test` 1759 pass; `bun run typecheck` clean. Integration files run locally: heads-ref, release-record, takeover-record, takeover-record-lost, housekeeping, story-reopen, adapters contract: all pass. The e2e transcripts (base-sync, slice-workflow, recovery-claim-lost) were rewritten with `NORN_TRANSCRIPT_UPDATE=1`. The diff is the extra refspec, the local heads-ref update and sha renumbering.

Review #1 traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | no PR yet: the branch is pushed as today and the heads ref goes with it at the same commit, in one push | test | `packages/cli/test/integration/heads-ref.test.ts` › "AC1: no PR yet…"; git contract › "push: several refspecs go in one push…" (the push is not atomic: see review finding F1) |
| AC2 | `record.policy: remote`: the record is pushed after the heads ref and names its commit (`Norn-Branch-Commit`) | test | heads-ref.test.ts › "AC2: record.policy remote…" |
| AC3 | a takeover after a crash resumes from the heads ref merged with the remote branch (never rebased), under both policies | test | heads-ref.test.ts › "AC3: record.policy local / remote…" proves only a heads ref ahead of the branch; a diverged heads ref is not merged (finding F1) |
| AC4 | the heads ref goes at merged-PR cleanup, `story close` and `norn tidy`; no config key turns the push off | test | `packages/core/test/unit/decide.test.ts` › "PR merged → cleanup, the story's heads ref removed with its claim"; heads-ref.test.ts › "AC4: story close…", "AC4: norn tidy…"; `packages/schema/test/unit/ids-config.test.ts` › "no config key turns the heads ref push off…" |
| AC5 | `docs/limitations.md`: under `local` a crash still loses the receipts and counters since the last record push; the step restarts at that boundary | agent | QA (agent) |

### Easy to miss
- The heads ref lives in `runtime/push.ts` `pushBranch` (the one push path), not in decide. Every story-branch push carries it: boundaries, the git steps, release and close. Slice branches (names with `/`) do not. The heads ref is force-pushed. After a successful push the local `refs/norn/heads/<story>` is set to the pushed sha, because git keeps no tracking ref outside refs/heads. The record push (`act/lifecycle.ts` pushRecord, `close.ts` pushHeldRecord) waits on that local copy.
- A takeover resumes from the heads ref only when it is strictly ahead of the remote branch (`aheadOf` in checkout.ts). When the branch moved past it, or away from it (a person's push or a rewrite), the take works as before. Otherwise the existing "rewritten branch restarts the step" and "bad spec on the branch is refused" tests break, because the heads ref would undo a deliberate rewrite.
- pushHeldRecord uses the heads ref only while the local story branch exists. A story whose branch is gone records no `Norn-Branch-Commit` (B33).
- tidy removes a heads ref (here and on the remote) when the story ended: as observe sees it (landed, merged or dropped), else when spec.md at the ref's own commit says done or dropped.

### Not proven yet
- Review #1, blocking finding F1 (the AC3 merge case): `pushBranch` (runtime/push.ts:394-395) pushes the branch and the forced heads ref without `--atomic`. When a person pushed to the branch and the take-in conflicts, the heads ref moves to the boundary while the branch stays at the person's commit. A takeover then takes the branch (aheadOf is false) and the boundary goes missing. Fix: atomic push (a GitPort option plus a contract test), or a merge at takeover, plus an integration test for a rejected push followed by a crash.
- A heads ref that diverged from the remote branch (a person pushed on top of a lagging branch while the PR is open) is **not** merged at takeover. It is taken from the remote branch as today. User story 12 asks for a merge, never a rebase. Before the PR opens (this slice) the two refs move together, so divergence means a rewrite. Slice 03 makes divergence normal and must decide how to tell a person's push from a rewrite. Candidate: merge when the record's `Norn-Branch-Commit` is the heads ref and the branch's old tip is in both.
- The full integration and e2e tiers run in CI.

### Notes
- `docs/limitations.md`: under `local` the step restarts at the boundary of the last record push, with the counters that record holds. Only a story with no record restarts with fresh counters. AC5 says "fresh counters" for both; the doc says what the code does.
- GitPort.push now takes one refspec or several (`string | readonly string[]`). There is one real adapter and no fake.
- `listRemoteRefs` is newly exported from `@norn/store` (checkout and tidy use it).
- `story reopen`'s journal commit (checkout.ts journalTake) still pushes the branch with a plain `git.push`, without the heads ref. It is not a boundary, so it was left alone.
- Friction: none.

### Resume
Rework the blocking finding F1 (non-atomic push and AC3 merge). Findings file: review#1 evidence `findings.json`.
