## Goal
`git: update` ends `clean` or `resolved` (where the workflow routes them) when, since the round's latest `approve`, the story has only base merges and spec-folder bookkeeping (never `spec.md`); otherwise `done` as today.

## Proof
Review #1 approved this slice. Every row below is a test the reviewer read and saw assert the item. `bun run test` (1773 pass) and `bun run typecheck` are green. The e2e file and the contract test also passed when the reviewer ran them alone.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | routed `clean` / `resolved`: only base merges and spec-folder bookkeeping since the latest approve; an empty remerge-diff on every merge → clean, any resolution → resolved | test | `packages/core/test/unit/update-outcome.test.ts` › "base merges with an empty remerge-diff … end clean", "a merge since the approval that needed a resolution ends resolved", "update.clean → test-merge" / "update.resolved → test-resolution"; `test/e2e/light-path.test.ts` › "a clean base merge since the approval ends clean…", "a merge the resolver resolved since the approval ends resolved…" |
| AC2 | code committed by implement after a ready reject or a ci fail → done (full path) | test | update-outcome.test.ts › "a commit touching code since the approval … ends done"; light-path.test.ts › "code committed since the approval (new implement work) takes the full path" |
| AC3 | `spec.md` changed since the last approval → done | test | update-outcome.test.ts › "a changed spec.md since the approval ends done"; light-path.test.ts › "a spec.md changed since the approval takes the full path" |
| AC4 | a workflow that does not route clean/resolved → done as today | test | update-outcome.test.ts › "a workflow that does not route clean or resolved ends done as today" (also when only one of the two is routed); goldens and transcripts unchanged |
| AC5 | same receipts and git → same outcome; agent done records its head; the update receipt records the git summary | test | pure `updateOutcome` / `lightAnchor` (update-outcome.test.ts › "the anchor is the head at the latest approve in the round"); light-path.test.ts asserts the resolver's done `head_sha` and the classify `history` (anchor = approve head_sha, parents, paths, from_base, remerge) |
| AC6 | the git port reports remerge-diff and per-commit paths (contract suite); a git too old → never clean | test | `packages/adapters/test/contract/git.ts` › "commitPaths: … remergeDiff names what a merge's author changed" (integration tier, run against createGit; the repo has no fake GitPort); `packages/adapters/test/unit/git/git.test.ts` › "a git too old to remerge … gives null"; update-outcome.test.ts › "a merge whose remerge-diff git cannot give (too old) ends resolved, never clean" |
| Light path as update outcomes in the YAML (validation) | `clean`/`resolved` only on `git: update` | test | `packages/core/test/unit/workflow.test.ts` › "the light-path outcomes clean and resolved are declared only on a git update step" |

## Easy to miss
- The anchor is the *latest* approve receipt (gate `approve` or agent `done` with outcome `approve`); if that one has no `head_sha`, there is no anchor → `done` (fail closed). An anchor that is not an ancestor of the head → `done`.
- Commits are the first-parent line `anchor..head-after-merge`, so base commits brought in by merges are not inspected one by one; a merge counts only if its other parents are ancestors of the base sha (`from_base`).
- An empty commit (no paths) counts as bookkeeping.

## Not proven yet
- Nothing UNTRACED. CI has not yet run the new e2e file or the contract test; both passed locally (the reviewer re-ran them).

## Notes
- Gathering history only happens when the update step routes `clean` or `resolved`, so existing workflows, goldens and transcripts do not change.
- For slice 08 (shipped route): counters with `reset_on: update.done` do not reset on `update.clean`/`update.resolved`; decide whether the shipped `base_conflict_loop` needs that.
- For slice 13 (regenerate): `updateOutcome` is where a `Norn-Regenerated` merge counts as clean; `UpdateCommit.trailers` already carries the trailer.
- For slice 10 (base side): `GitPort.commitPaths` gives commits with paths for a range; reuse it.
- Friction: the brief-enforcing hook refuses `git checkout` even in a throwaway repo under `$TMPDIR`, so git behaviour was explored through the contract test instead.

## Resume
Review #1 approved with no findings. Nothing is open in this slice; QA or the next step goes on from the table above.
