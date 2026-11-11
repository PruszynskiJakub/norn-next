### Goal
Every push of the story branch also puts the story's head on `refs/norn/heads/<story>` in the same push, under both record policies. The record names it, a takeover after a crash resumes from it, and it goes when the story ends. Before the PR is open nothing else changes.

### Proof
- AC1 (no PR yet: the branch is pushed as today and the heads ref goes with it, in one push): `packages/cli/test/integration/heads-ref.test.ts` › "AC1: no PR yet…" (a post-receive hook logs each push; every branch push holds the heads ref); git contract › "push: several refspecs go in one push, a ref outside refs/heads among them" (went red first). The push is atomic (`git push --atomic` whenever GitPort.push gets several refspecs): git contract › "push: several refspecs land together or not at all: a rejected branch leaves a forced ref unmoved" (went red first).
- AC2 (`record.policy: remote`: the record is pushed after the heads ref and names its commit in `Norn-Branch-Commit`): heads-ref.test.ts › "AC2…".
- AC3 (a takeover after a crash resumes from the heads ref, under both policies): heads-ref.test.ts › "AC3: record.policy local / remote…". The remote branch is put back behind the heads ref; B's worktree is at the heads ref commit and resumes at review. Review #1 finding (a non-atomic push let the heads ref move alone after a rejected push, so a takeover dropped the boundary): heads-ref.test.ts › "AC1/AC3: a person pushed a clashing commit, the take-in fails…" (went red without `--atomic`: the remote heads ref had moved to the boundary). Now neither ref moves, and B takes the person's commit with the heads ref inside it.
- AC4 (the heads ref is removed when the story ends, and no config key turns it off): `packages/core/test/unit/decide.test.ts` › "PR merged → cleanup, the story's heads ref removed with its claim" (went red first; golden diff is only that ref in 3 cases); heads-ref.test.ts › "AC4: story close…" and "AC4: norn tidy…"; `packages/schema/test/unit/ids-config.test.ts` › "no config key turns the heads ref push off…".
- AC5: `docs/limitations.md` (Gaps › cross-machine handoff), plus a paragraph in `docs/concepts.md` after the record policies.
- `bun run test` 1759 pass; `bun run typecheck` clean. Integration files run locally: heads-ref (7 pass), adapters contract (90 pass). The e2e transcripts (base-sync, slice-workflow, recovery-claim-lost) were rewritten with `NORN_TRANSCRIPT_UPDATE=1`; the rework's diff there is only `--atomic` on the story-branch push lines.

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
- A heads ref that diverged from the remote branch is **not** merged at takeover; it is taken from the remote branch as today. With the atomic push the two refs only diverge before a PR when the branch is rewritten (force-push), where taking the branch is intended. User story 12 asks for a merge, never a rebase, once a lagging branch makes divergence normal (slice 03). Slice 03 must decide how to tell a person's push from a rewrite. Candidate: merge when the record's `Norn-Branch-Commit` is the heads ref and the branch's old tip is in both.
- The full integration and e2e tiers run in CI.

### Notes
- `docs/limitations.md`: under `local` the step restarts at the boundary of the last record push, with the counters that record holds. Only a story with no record restarts with fresh counters. AC5 says "fresh counters" for both; the doc says what the code does.
- GitPort.push now takes one refspec or several (`string | readonly string[]`); several always go `--atomic` (all land or none) — no option, since no caller wants a partial push. There is one real adapter and no fake.
- `listRemoteRefs` is newly exported from `@norn/store` (checkout and tidy use it).
- `story reopen`'s journal commit (checkout.ts journalTake) still pushes the branch with a plain `git.push`, without the heads ref. It is not a boundary, so it was left alone.
- Friction: none.

### Resume
Review the rework: the atomic push (`packages/adapters/src/git/index.ts` push) and its two tests named under Proof.
