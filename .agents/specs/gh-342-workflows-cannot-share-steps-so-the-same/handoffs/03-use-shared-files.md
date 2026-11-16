## Goal

A workflow step `use: <name>` brings in `.agents/workflows/shared/<name>.yaml`; the store's loader flattens it into today's flat workflow before validation, so core, decide and receipts never see a shared file.

## Proof

All in `packages/store/test/unit/shared-workflows.test.ts` (S1, the loader over a temp repo) unless named:
- AC1 included steps replace the `use` step under their own names, plus `included` (which step came from which file): "the included steps stand in place of the use step under their own names".
- AC2 `start`, routes and `base.step` naming the use step enter at the shared `start`; included steps named directly: "routes, start and base.step naming the use step…"; `reset_on` / `base.verify` naming the use step refused: "reset_on or base.verify naming the use step is refused…".
- AC3 exits take `to`/`counter` from the use step, `means`/`verdict` from the shared side; an unrouted exit goes to `$stuck`: "an exit takes its target and counter…".
- AC4 `$done`/`$stuck` and a workflow counter in a shared route stay as written and `validateWorkflowDefinition` passes: "shared routes to $done and $stuck…"; a route to a step outside the file refused: "a shared route naming a step outside the shared file is refused".
- AC5 included steps carry no limits of their own (defaults cover them): "the workflow's defaults cover included steps…".
- AC6 missing shared file names `shared/nope.yaml` and `.agents/workflows/shared/`: "a missing shared file names the file and the folder".
- AC7 clashes (workflow step, the use step itself, another shared file's step, double use): "an included step named like a workflow step…".
- AC8 unknown exit, `use:` in a shared file, `name`/`counters`/`defaults`/`mode`/`base` in a shared file: "an exit the shared file lacks, a use step in a shared file…".
- AC9 shared files never listed; no-`use` workflow loads byte for byte with `hash` its sha256; with `use`, `source` is the flattened text: the "shared files and the loaded text" block.
- AC10 `workflow-source` and `workflow-shared` emitted in `packages/schema/json/`; `workflow.schema.json` unchanged (git diff empty): `packages/schema/test/unit/workflow.test.ts` › "workflow-source and workflow-shared schemas", plus the existing "json/<name>.schema.json is up to date" test.
- `bun run test` (1929 pass) and `bun run typecheck` green.

## Easy to miss

- The strict `workflow` schema must stay byte-identical: the step types are now built by `stepTypes(outcome)` in `packages/schema/src/workflow.ts`, once with `OutcomeSpec` (exported as before) and once with exits for shared files.
- A workflow without `use` must take the old path untouched (`source = raw`), or every running pin's fingerprint changes.
- Schema titles must not contain the words "norn workflow" (the removed-commands lint in `test/repo/repo.test.ts` flags it).

## Not proven yet

- cli surfacing (doctor naming the shared file and step for a core validation issue on an included step, never-startable shared files, pins/lost-record) is slice 07; `like:` is slice 04.

## Notes

- Module: `packages/store/src/shared-workflow.ts` — `flattenWorkflowText(text, reader)` (null when no `use` step), `sharedFilesUsed(text)` (names the shared files a text uses, for the lost-record restart reading from a branch), `SHARED_DIR`, `sharedFile`. Wired into `loadFile` in `packages/store/src/config.ts`, which pre-reads the used files from the work tree. Slice 02 moves `loadFile` into one text loader; whichever merges second wires this call through the other.
- `WorkflowFile.included` (step → shared name) is present only when the workflow uses a shared file; slice 07 uses it for D7's message prefix.
- Errors are reported on the workflow file; paths are step pointers, messages prefixed `shared/<name>.yaml:` when the problem is inside the shared file. Refusals come in phases (use-step shape/missing/shared-file problems, then clashes, then exits and reset_on/verify) so one mistake does not cascade.
- Flattened text is `yaml` stringify with `lineWidth: 0`; an exit route collapsing to only `to` is written as a bare target.
- Shared files are read only as `.yaml` (the spec names `shared/<name>.yaml`).

## Resume

Done; next is review of this slice.
