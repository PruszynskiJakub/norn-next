### Goal
The shipped `quick` and `story` take sync, base update and shipping from bundled shared files (CI wait written once, `like:` instead of anchors) and load to exactly today's workflows; `norn init` copies the bundled `shared/` folder.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | bundled quick/story with `shared/` load to slice 01's recorded `workflowHash` (29/8, 42/10); the CI wait is in exactly one bundled file; anchors gone for `like:` | test | `packages/cli/test/unit/assets.test.ts` › "workflow templates" › "%s keeps its pinned meaning", "quick has 29 routes and 8 counters, story 42 routes and 10 counters", "the CI wait is written in exactly one bundled file, and copies are `like:` steps, never YAML anchors", "quick and story take sync, base update and shipping from the shipped shared files" |
| AC2 | golden cases and transcripts do not change | test | `packages/core/test/unit/golden.test.ts` (green in `bun run test`); the diff touches no file under `packages/core/test/golden/` or `test/e2e/transcripts/` |
| AC3 | `norn init` copies every `shared/` file, reported as `shared/<file>` under created, keeps an existing one under kept, and every bundled workflow loads | test | `packages/cli/test/integration/init-shared.test.ts` › "a new repo gets every shared file, reported under created, and every bundled workflow loads", "a shared file the repo already has is kept as it is, reported under kept" |
| AC4 | a detected test command is written into the shared file holding the test check and the loaded test checks run it | test | `packages/cli/test/integration/init-shared.test.ts` › "the detected test command is written into the shared file with the test check, and the loaded test steps run it"; `test/e2e/slice-workflow.test.ts` › init with `npm ci && npm test` |
| (story) bundled quick/story rewritten with shared files load to today's workflows | — | test | as AC1 |
| (story) `norn init` copies `shared/`, keeping existing shared files | — | test | as AC3 |

Review #1: `bun run test` 1954 pass, `bun run typecheck` clean, `bun run docs:emit` no diff. Implement's evidence for these lines is in its receipt.

### Easy to miss
- A `use` step's name cannot equal an included step, so the sync is brought in by `sync-base: { use: sync }` (the step stays `sync`; `start: sync` names it directly).
- Ship's exits differ by counter: `ci-failed` (ci_loop), `rejected` (ready_loop), `stale` (stale_loop): one exit has one route.
- `describe` stays inline in each workflow (quick reads `handoff`, story `record`).

### Not proven yet
- The integration and e2e tiers (init-shared, ci-check, slice-workflow) run in CI. The reviewer read them and did not run them locally: the integration tier is never a local check.

### Notes
- Shared files: `packages/cli/assets/workflows/shared/{sync,base-update,ship}.yaml`. base-update exits: `tested`, `broken`, `ship` (light path → open-pr), `redescribe`.
- Tests that parsed the bundled YAML directly now load it through the store's loader on a temp copy: `light-route.test.ts`, `test/repo/repo.test.ts` (shipped vs repo shape), `ci-check.test.ts`. `test/e2e/slice-workflow.test.ts`'s init expectations now include `shared/*` files, and `set_in` is `["slice.yaml", "shared/base-update.yaml"]`.
- Merged the story branch in (slices 06 and 08 had landed). Both sides had moved the same tests to load workflows through the store's loader; the merge keeps the story branch's folder-based helpers (`ciStep(dir, wf)`, light-route `load(dir, name)` + `writtenText`) and points this slice's shipped-template uses at `packages/cli/assets/workflows`. With 06's repo workflows on `like:`, the light-route "written once" check is the strict one-occurrence form again. development.md keeps both sentences: the shipped `shared/` folder and the repo's `.agents/workflows/shared/`.
- README, concepts and development docs mention `.agents/workflows/shared/`. The recipes are slice 08.
- Friction: `bun run golden` with no arguments is the harvest mode (it runs the slow tiers). I started it by mistake to check AC2 and stopped it; it had written nothing.

### Resume
Merge #1 resolved the integrate conflicts; `bun run test` 1949 pass, typecheck clean, docs:emit no diff. Next: integrate again, per the workflow.
