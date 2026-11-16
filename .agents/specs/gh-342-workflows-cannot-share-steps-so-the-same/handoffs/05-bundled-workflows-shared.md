### Goal
The shipped `quick` and `story` take sync, base update and shipping from bundled shared files (CI wait written once, `like:` instead of anchors) and load to exactly today's workflows; `norn init` copies the bundled `shared/` folder.

### Proof
- AC1 bundled quick/story load to the recorded meaning: `packages/cli/test/unit/assets.test.ts` › "workflow templates" › "%s keeps its pinned meaning" (unchanged hashes from slice 01, green after the rewrite), "quick has 29 routes and 8 counters, story 42 routes and 10 counters", and the new "the CI wait is written in exactly one bundled file, and copies are `like:` steps, never YAML anchors" (red on the old files: anchors found by the YAML node walk) and "quick and story take sync, base update and shipping from the shipped shared files".
- AC2 golden cases and transcripts unchanged: `packages/core/test/unit/golden.test.ts` green in `bun run test`; the corpus and transcripts embed their own workflows, and no pinned file changed.
- AC3 / AC4 `norn init`: `packages/cli/test/integration/init-shared.test.ts` (all 3 went red first: init threw on the `shared/` folder): copies every shared file reported as `shared/<file>` under created and every bundled workflow loads; a shared file already there is kept and reported under kept; a detected test command (`npm ci && npm test`) lands in `shared/base-update.yaml` and the loaded `test`, `test-merge`, `test-resolution` of quick and story run it.
- `bun run test` 1948 pass, `bun run typecheck` clean, `bun run docs:emit` no diff in docs/reference.md.

### Easy to miss
- A `use` step's name cannot equal an included step, so the sync is brought in by `sync-base: { use: sync }` (the step stays `sync`; `start: sync` names it directly).
- Ship's exits differ by counter: `ci-failed` (ci_loop), `rejected` (ready_loop), `stale` (stale_loop): one exit has one route.
- `describe` stays inline in each workflow (quick reads `handoff`, story `record`).

### Not proven yet
- The integration and e2e tiers run in CI. Locally I ran only the files I touched there: init-shared, ci-check, and slice-workflow's init tests. All green.

### Notes
- Shared files: `packages/cli/assets/workflows/shared/{sync,base-update,ship}.yaml`. base-update exits: `tested`, `broken`, `ship` (light path → open-pr), `redescribe`.
- Tests that parsed the bundled YAML directly now load it through the store's loader on a temp copy: `light-route.test.ts`, `test/repo/repo.test.ts` (shipped vs repo shape), `ci-check.test.ts`. `test/e2e/slice-workflow.test.ts`'s init expectations now include `shared/*` files, and `set_in` is `["slice.yaml", "shared/base-update.yaml"]`.
- The repo's own `.agents/workflows/` is not rewritten here (slice 06). The light-route "written once" check accepts either an anchor and its aliases or one step and its `like` copies, so it stays green until 06 lands.
- README, concepts and development docs mention `.agents/workflows/shared/`. The recipes are slice 08.
- Friction: `bun run golden` with no arguments is the harvest mode (it runs the slow tiers). I started it by mistake to check AC2 and stopped it; it had written nothing.

### Resume
Review the diff against slice 05's criteria.
