## Goal
`git: update` ends `clean` or `resolved` (where the workflow routes them) when, since the round's latest `approve`, the story has only base merges and spec-folder bookkeeping (never `spec.md`); otherwise `done` as today.

## Proof
- AC1 light outcomes (clean / resolved): `packages/core/test/unit/update-outcome.test.ts` › "light path: …" (clean, resolved, routing via `applyReceipts`); end to end on real git: `test/e2e/light-path.test.ts` › "a clean base merge since the approval ends clean…" and "a merge the resolver resolved … ends resolved".
- AC2 code since the approval (implement after a ready reject or a ci fail) → done: update-outcome.test.ts › "a commit touching code since the approval…"; light-path.test.ts › "code committed since the approval…".
- AC3 changed spec.md → done: update-outcome.test.ts › "a changed spec.md…"; light-path.test.ts › "a spec.md changed since the approval…".
- AC4 workflow that does not route them → done: update-outcome.test.ts › "a workflow that does not route clean or resolved ends done as today"; act gathers no history when the step routes neither (existing goldens and transcripts unchanged).
- AC5 deterministic, from receipts and git only: pure `updateOutcome(summary, routed)` and `lightAnchor(receipts)` in `packages/core/src/update-outcome.ts`; done receipts gain `head_sha` (light-path.test.ts checks the resolver's `norn done`); the update's classify receipt gains `history` {anchor, spec_dir, commits[sha, parents, paths, trailers, from_base, remerge]} (checked in light-path.test.ts).
- AC6 git port: `commitPaths` and `remergeDiff` in `packages/core/src/ports.ts` + adapter; contract `packages/adapters/test/contract/git.ts` › "commitPaths: … remergeDiff …" (passes locally); git too old → `null` → `resolved`, never `clean`: `packages/adapters/test/unit/git/git.test.ts` › "a git too old to remerge…" and update-outcome.test.ts › "remerge-diff git cannot give…".
- Validation: `clean`/`resolved` refused on a git step other than `action: update` (workflow.test.ts).
- `bun run test` (1773 pass) and `bun run typecheck` are green; `schema:emit` run.

## Easy to miss
- The anchor is the *latest* approve receipt (gate `approve` or agent `done` with outcome `approve`); if that one has no `head_sha`, there is no anchor → `done` (fail closed). An anchor that is not an ancestor of the head → `done`.
- Commits are the first-parent line `anchor..head-after-merge`, so base commits brought in by merges are not inspected one by one; a merge counts only if its other parents are ancestors of the base sha (`from_base`).
- An empty commit (no paths) counts as bookkeeping.

## Not proven yet
- The new e2e file and the contract test run in CI (they passed locally, run as single files).

## Notes
- Gathering history only happens when the update step routes `clean` or `resolved`, so existing workflows, goldens and transcripts do not change.
- For slice 08 (shipped route): counters with `reset_on: update.done` do not reset on `update.clean`/`update.resolved`; decide whether the shipped `base_conflict_loop` needs that.
- For slice 13 (regenerate): `updateOutcome` is where a `Norn-Regenerated` merge counts as clean; `UpdateCommit.trailers` already carries the trailer.
- For slice 10 (base side): `GitPort.commitPaths` gives commits with paths for a range; reuse it.
- Friction: the brief-enforcing hook refuses `git checkout` even in a throwaway repo under `$TMPDIR`, so git behaviour was explored through the contract test instead.

## Resume
Nothing open in this slice; next is review.
