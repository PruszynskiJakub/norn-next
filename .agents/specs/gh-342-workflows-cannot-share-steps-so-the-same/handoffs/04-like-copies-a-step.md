## Goal

A step written `like: <step>` copies a step of the same file (workflow or shared file) and replaces only the top-level keys it writes; bad copies are refused at load with their reason.

## Proof

All in `packages/store/test/unit/shared-workflows.test.ts` (S1, the loader over a temp repo) unless named; each went red before the code:
- AC1 shallow copy, written keys replace whole, flattened key order = target's keys then the copy's new keys: "like: copies a step of its own file" › "a copy keeps the target's keys and replaces only those it writes, whole; its text lists the target's keys then its own".
- AC2 `like` inside a shared file resolved within it before its steps come in (and the copy is listed in `included`): › "a like in a shared file is resolved within the shared file before its steps come in".
- AC3 refusals: "like: refusals" › "a like naming a missing step, itself, a like step or a use step is refused with its reason", › "a like naming a step of another file is refused, from the workflow and from the shared file", › "a use step carrying like is refused". Errors are on the workflow file, path `/steps/<step>/like`, shared-file ones prefixed `shared/<name>.yaml:`.
- AC4 like without use: `source` is the flattened text (no `like:`), `hash` its sha256, no `included`: › "a workflow with like but no use loads as its flattened text, with no like left"; schemas accept `like` steps: `packages/schema/test/unit/workflow.test.ts` › "like steps in the workflow-source and workflow-shared schemas" plus the existing "json/<name>.schema.json is up to date" (re-emitted with `bun run schema:emit`; `workflow.schema.json` unchanged).
- `bun run test` (1945 pass, 0 fail) and `bun run typecheck` green.

## Easy to miss

- A workflow with neither `use` nor `like` must still load byte for byte (`flattenWorkflowText` returns null) or running pins' fingerprints change.
- `included` stays absent for a workflow with `like` but no `use` (`Flattened.included` is now optional; `config.ts` spreads it only when present).
- The strict `workflow` schema must stay byte-identical: `LikeStep` is added only to `workflow-source` and `workflow-shared`.

## Not proven yet

- Replacing YAML anchors with `like:` in the shipped and repo workflows is slices 05/06; cli surfacing is 07; recipes 08.

## Notes

- `packages/store/src/shared-workflow.ts`: `resolveLikes(steps, elsewhere)` runs per file — on the workflow's steps first (before `use` flattening), and inside `readShared` on the shared file's steps before its `workflow-shared` validation, so the strict check runs on the copies. `elsewhere` maps step names of the other file(s) to their label so a cross-file copy says where the step lives (workflow side: steps of the used shared files, read raw; shared side: the workflow's steps, "the workflow").
- `LikeStep` in `packages/schema/src/workflow.ts` (built by `likeStep(variants)`): `like: StepName`, optional `type` (any step type), every other known step key as `unknown` — "loosely" per Plan D3; unknown keys refused.

## Resume

Implementation done and committed; next is review of this slice.
