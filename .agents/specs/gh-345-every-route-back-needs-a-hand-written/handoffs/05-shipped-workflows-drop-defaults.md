### Goal
The shipped workflows (bundled `packages/cli/assets/workflows/` and this repo's `.agents/workflows/`, release included) write only the counters and maxima that differ from the defaults, and once loaded bound every edge exactly as before.

### Proof
Review #1 traceability (approve, no findings):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | the edited shipped files, loaded, keep slice 01's invariant table; `integrate.conflict` resetting on `integrate.done` is the one difference | test | `packages/store/test/unit/shipped-workflow-counting.test.ts` (unchanged on this branch, green on the edited files) |
| AC2 | no `counters:` entry matches the defaults; only the listed overrides and shared names remain; the workflow templates test asserts the counter counts | test | `packages/cli/test/unit/assets.test.ts` › "the shipped files, bundled and this repo's, write a counter only to share it and a max only where it differs from the default" and › "quick has 29 routes and 8 counters, none written; story 42 routes and 10 counters, 2 written" |
| AC3 | the golden tier passes after `bun run golden -- --update` | test | `packages/core/test/unit/golden.test.ts`; the reviewer re-ran `--update`: 0 of 139 cases changed, no diff |
| AC4 | the golden diff changes counter names only, no decision, target or outcome | agent | QA (agent); the reviewer saw an empty golden diff |
| user story | the shipped files hold only what differs from the defaults | test | as AC2 |
| user story | every shipped workflow keeps its counting, `integrate.conflict` the exception | test | as AC1 |

- AC1, the invariant table still holds (`integrate.conflict` resetting on `integrate.done` the one listed difference): `packages/store/test/unit/shipped-workflow-counting.test.ts` › "each bundled/repo workflow bounds the same edges by the same max, resets and sharing". Unchanged and green against the edited files.
- AC2, no `counters:` entry left that matches the defaults: `packages/cli/test/unit/assets.test.ts` › "the shipped files, bundled and this repo's, write a counter only to share it and a max only where it differs from the default" (went red first). It pins what is still written: `qa_loop`/`stale_loop` declared, plus the overrides `ship.ci-failed`/`ship.failed` set to 3, `resolution-review.changes_requested` set to 2 and `approve-slices.reject` set to 3. It also checks that every name still declared is shared by more than one edge. The counter-count test now also asserts what is written: quick 8 loaded / 0 written, story 10 loaded / 2 written.
- AC3, golden cases: `bun run golden -- --update` reported "0 of 139 golden case(s) decide differently now" and left no diff.
- AC4, golden diff names only: the diff is empty. The golden cases carry their own pinned workflows, so no decision, target or outcome changed.
- `bun run docs:emit` left `docs/reference.md` unchanged. `bun run test` passed (2109 tests) and `bun run typecheck` passed.

### Easy to miss
- Derived names follow the exit names, and the copies name their exits differently: bundled `base-update.broken` / `ship.ci-failed` vs repo `base-update.failed` / `ship.failed` / `land.rejected`. The intake test "the repo's copies of the shipped workflows have the same steps and edges" now compares each counter's bound instead of its name.
- In shipped quick, the stale edge derives `ship.stale`. Story, release, and this repo's quick and story keep `stale_loop`, because it spans more than one use route or step.

### Not proven yet
- The integration and e2e tiers were not run here; CI runs them. `packages/cli/test/integration/ci-check.test.ts` › "story runs the same script as quick" was updated to expect `ship.stale` for shipped quick but has not been run. The other integration and e2e tests that name `*_loop` counters use inline fixtures, judging by grep.

### Notes
- Tests changed in names or hashes only, as AC29/US28 intend: the pinned meaning hashes for bundled quick/story (`assets.test.ts`) and for repo quick/story/release (`test/repo/process.test.ts`); `light-route.test.ts` now uses the derived names; `test/repo/repo.test.ts` CI and release tests now expect `ship.failed` / `ready.reject`.
- Comments in the bundled shared files that said "the workflow declares X_loop" were removed, since nothing is declared any more.

### Resume
Nothing left in this slice. Next is review, then slice 06 (docs).
