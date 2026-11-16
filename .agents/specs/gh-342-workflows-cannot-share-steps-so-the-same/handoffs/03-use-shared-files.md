## Goal

A workflow step `use: <name>` brings in `.agents/workflows/shared/<name>.yaml`; the store's loader flattens it into today's flat workflow before validation, so core, decide and receipts never see a shared file.

## Proof

Review #1 traceability (tests read and seen to assert each item):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | included steps stand in place of the `use` step under their own names; no step named after the use step | test | `packages/store/test/unit/shared-workflows.test.ts` › "the included steps stand in place of the use step under their own names" |
| AC2 | start, routes, base.step naming the use step enter at the shared start; included steps named directly; reset_on/base.verify naming the use step refused | test | `packages/store/test/unit/shared-workflows.test.ts` › "routes, start and base.step naming the use step enter at the shared start…" and "reset_on or base.verify naming the use step is refused…" |
| AC3 | exits take to/counter from the use step and means/verdict from the shared side; an unrouted exit goes to $stuck | test | `packages/store/test/unit/shared-workflows.test.ts` › "an exit takes its target and counter from the use step…" |
| AC4 | shared routes to $done/$stuck and a workflow counter stay as written and validate; a route out of the file is refused | test | `packages/store/test/unit/shared-workflows.test.ts` › "shared routes to $done and $stuck and to a workflow counter stay as written…" and "a shared route naming a step outside the shared file is refused" |
| AC5 | the workflow's defaults cover included steps, which carry no limits of their own | test | `packages/store/test/unit/shared-workflows.test.ts` › "the workflow's defaults cover included steps…" |
| AC6 | a missing shared file names `shared/nope.yaml` and `.agents/workflows/shared/` | test | `packages/store/test/unit/shared-workflows.test.ts` › "a missing shared file names the file and the folder" |
| AC7 | a clashing included step or double use is refused naming the step and both places | test | `packages/store/test/unit/shared-workflows.test.ts` › "an included step named like a workflow step, a use step or another shared file's step, or a shared file used twice, names both places" |
| AC8 | an unknown exit, `use:` in a shared file, or a workflow key in a shared file is refused with its message | test | `packages/store/test/unit/shared-workflows.test.ts` › "an exit the shared file lacks, a use step in a shared file, and a workflow key in a shared file are refused" |
| AC9 | shared files never listed; a no-use workflow loads byte for byte with hash its sha256; with use, source is the flattened text | test | `packages/store/test/unit/shared-workflows.test.ts` › "files in shared/ are never listed as workflows" and "a workflow with no use loads byte for byte…" |
| AC10 | workflow-source and workflow-shared schemas emitted; strict workflow schema unchanged | test | `packages/schema/test/unit/workflow.test.ts` › "workflow-source and workflow-shared schemas" + existing "json/<name>.schema.json is up to date"; `git diff` of `workflow.schema.json` empty |

`bun run test` (1929 pass, 0 fail) and `bun run typecheck` green at review.

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

- Module: `packages/store/src/shared-workflow.ts` — `flattenWorkflowText(text, reader)` (null when no `use` step), `sharedFilesUsed(text)` (names the shared files a text uses, for the lost-record restart reading from a branch), `SHARED_DIR`, `sharedFile`. Merged with slice 02: flattening runs inside `loadWorkflowText(name, text, file, root?, readShared?)` in `packages/store/src/config.ts` (the one text loader); `loadFile` passes a reader that pre-reads the used files from the work tree. The branch restart in `packages/cli/src/runtime/checkout.ts` passes no reader yet, so a workflow using a shared file is refused there as a missing shared file until slice 07 passes a branch reader.
- `WorkflowFile.included` (step → shared name) is present only when the workflow uses a shared file; slice 07 uses it for D7's message prefix.
- Errors are reported on the workflow file; paths are step pointers, messages prefixed `shared/<name>.yaml:` when the problem is inside the shared file. Refusals come in phases (use-step shape/missing/shared-file problems, then clashes, then exits and reset_on/verify) so one mistake does not cascade.
- Flattened text is `yaml` stringify with `lineWidth: 0`; an exit route collapsing to only `to` is written as a bare target.
- Review #1 minor: `loadFile` reads `shared/${n}.yaml` for every raw `use:` string before `UseStep` checks the name pattern, so `use: ../x` reads a file outside `shared/` (never surfaced; the shape check refuses it). Not rework.
- Shared files are read only as `.yaml` (the spec names `shared/<name>.yaml`).

## Resume

Review #1 approved (no blocking findings; one minor note on unvalidated `use` names being read before the shape check, in the review findings). Next: QA of this slice.
