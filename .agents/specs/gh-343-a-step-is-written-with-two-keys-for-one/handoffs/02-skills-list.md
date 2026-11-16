## Goal
Prefactor: the loaded agent step holds an optional `skills: string[]` in place of `skill: string`; a file's `skill: X` loads as `[X]`; the brief's Your work line names zero, one or several skills; decide decides exactly as before.

## Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | one skill: Your work reads "Use the `X` skill." then the instructions | test | `packages/core/test/unit/brief.test.ts` › "Your work names the step's skills %j, in the order listed, then the instructions" (one-skill row); existing Your work snapshot unchanged |
| AC2 | two skills "`X` and `Y`", three "`X`, `Y` and `Z`", in list order, then the instructions | test | same `test.each` (two- and three-skill rows) |
| AC3 | no skills: only the instructions | test | same `test.each` (`[]` and missing `skills` rows) |
| AC4 | `unknown_skill` for each skill in the list that is not installed or not visible to the step's agent | test | `packages/core/test/unit/workflow.test.ts` › "each skill in a step's list is checked: one unknown_skill per skill not installed, or not visible to the agent that runs it" |
| AC5 | the refine step is recognised by its skills including the refine skill | test | `packages/core/test/unit/decide.test.ts` › "GR8: a refine step is the one whose skills include the refine skill, wherever it sits in the list" |
| AC6 | golden decisions byte-identical after the rewrite to a list; brief finish lines unchanged | test | `packages/core/test/golden/` (only `skill` lines changed; `golden.test.ts` passes); brief snapshots not in the diff |
| (story) a file's `skill: X` loads as `[X]`; a file still names exactly one `skill` | loader keeps old pins and branch files loading | test | `packages/store/test/unit/markdown-unit.test.ts` › "a file's one `skill` on an agent step loads as a one-item `skills` list, in the key's place" and "a file's agent step still names exactly one `skill` …" |

Review #1: approve. `bun run test` (1965 pass) and `bun run typecheck` are green. One minor note, not rework: a malformed `skill` in a file is reported against the model's wording (`packages/store/src/unit.ts:73`), e.g. `/steps/a/skills/0` or "unknown property 'skill'". Slice 04 can fold it in.

## Easy to miss
- Two schemas now: the model (`workflow`, `skills?`) and the file wording (`workflow-source` / `workflow-shared`, still one `skill`, built by `fileStepTypes` in `packages/schema/src/workflow.ts`). Only `workflow.schema.json` changed when emitted.
- A flat file (no `use`/`like`) is validated only against the model, and the model's `skills` is optional. So `parseWorkflowText` (`packages/store/src/unit.ts`) also checks the file wording: it refuses an agent step with no `skill`, or one that has `skills`, with today's messages.
- Golden case names are the stable keys of their inputs, so all 133 changed cases were renamed (`git mv`) to their new keys. Decisions did not change.
- The pinned-meaning hashes (`test/repo/process.test.ts`, `packages/cli/test/unit/assets.test.ts`) hash the model, so they were re-pinned. Mapping `skills` back to `skill` reproduced every old hash exactly before the re-pin, so the meaning is unchanged.
- The brief's real-run replay fixtures (`packages/core/test/fixtures/sandbox/*/workflow.yaml`) are pinned files in the file wording. They are left as they were; the test maps them through a local `loaded()` helper.

## Not proven yet
- e2e observe snapshots (`test/e2e/observe-snapshots/*.json`) were edited by hand (`skill` → `skills` list, keys sorted) and are not run locally: the e2e tier runs in CI.
- `packages/cli/test/integration/housekeeping.test.ts` now expects the `/steps/implement/skills/0` path. It is not run locally: the integration tier runs in CI.

## Notes
- The `unknown_skill` path moved from `/steps/<s>/skill` to `/steps/<s>/skills/<i>`. Until slice 04 changes the file wording to `skills: [X]`, doctor shows a path whose key the file does not yet have. Accepted, because it is the path in the new wording.
- `brief --json`'s `work.skill` became `work.skills: string[]`. No doc or consumer read it.
- Out of scope, left for slice 04: the file wording `skills:` / `by:`, and making the orientation required.

## Resume
Review approved; next is QA of the six criteria against the Proof table.
