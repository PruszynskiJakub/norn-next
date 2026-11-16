## Goal
Prefactor: the loaded agent step holds an optional `skills: string[]` in place of `skill: string`; a file's `skill: X` loads as `[X]`; the brief's Your work line names zero, one or several skills; decide decides exactly as before.

## Proof
- AC1 brief names one skill: "Use the `X` skill." then the instructions: `packages/core/test/unit/brief.test.ts` › "Your work names the step's skills …" (one-skill row), plus the existing "the step's description and instructions follow the skill under Your work" and its snapshots, which did not move.
- AC2 two skills read "`X` and `Y`", three read "`X`, `Y` and `Z`", in the order listed: same `test.each` (two- and three-skill rows).
- AC3 no skill gives only the instructions: same `test.each` (`[]` and missing `skills` rows).
- AC4 `unknown_skill` for each skill in the list, whether not installed or not visible to the step's agent: `packages/core/test/unit/workflow.test.ts` › "each skill in a step's list is checked …"; the path is now `/steps/<step>/skills/<i>`.
- AC5 the refine step is the one whose skills include the refine skill: `packages/core/test/unit/decide.test.ts` › "GR8: a refine step is the one whose skills include the refine skill, wherever it sits in the list".
- AC6 golden decisions byte-identical: all 139 cases in `packages/core/test/golden/` had their embedded workflows rewritten from `skill` to `skills` (decisions untouched: the rewrite script asserted it) and `golden.test.ts` passes. Brief snapshots unchanged.
- Loader: `packages/store/test/unit/markdown-unit.test.ts` › "a file's one `skill` … loads as a one-item `skills` list, in the key's place" and "a file's agent step still names exactly one `skill` …".
- Model schema: `packages/schema/test/unit/workflow.test.ts` › "a loaded agent step holds a list of skills, maybe none …".
- `bun run test` (1959 pass) and `bun run typecheck` green.

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
Nothing left in this slice; next is its review.
