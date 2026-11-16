---
id: gh-342/03
title: Workflows bring in steps from shared files with `use:` and named exits
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
---

## Goal
A workflow step written `use: <name>` brings in `.agents/workflows/shared/<name>.yaml`; the store's loader flattens it into today's flat workflow, so validation, decide and receipts see no shared files.

## Scope
User stories: `use:` brings in a shared file's steps; included steps keep their names; routes, `base.step`, `base.verify` name included steps; a route to the `use` step enters at the shared `start`; named exits routed by the `use` step, with counters; an unrouted exit goes to `$stuck`; shared routes to `$done`/`$stuck`; shared routes naming workflow counters; workflow `defaults:` covering included steps; refusals for a missing shared file, a name clash or double use, an unknown exit, `use:` inside a shared file, a shared file key that belongs in the workflow; shared files never listed; a workflow without `use` loaded byte for byte; the shared-file JSON Schema emitted. Seams: S1, S4. Out: `like:` (04), cli surfacing and pins (07), rewriting the workflow sets (05, 06).

## Acceptance
- AC1 Given a workflow with a step `use: base-update` and a shared file holding `start`, steps `update`, `resolve`, `test`, when the loader loads the workflow, then the loaded workflow holds those steps under their own names in place of the `use` step, and no step named after the `use` step. — verifier: test
- AC2 Given routes, `start:` and `base.step` naming the `use` step, and a route, `base.step` or `base.verify` naming an included step directly, when loaded, then the first go to the shared file's `start` and the second to the named included step; `reset_on` or `base.verify` naming the `use` step is refused with a message to name the included step. — verifier: test
- AC3 Given a shared route `pass: { exit: tested, means: …, verdict: … }` and the `use` step routing `tested: qa` and `broken: { to: implement, counter: test_loop }`, when loaded, then the flattened routes go to `qa` and to `implement` with counter `test_loop`, keeping the shared side's `means`/`verdict`; an exit the `use` step does not route goes to `$stuck`. — verifier: test
- AC4 Given shared routes to `$done` and `$stuck` and a shared route naming a counter the workflow declares, when loaded, then they stay as written and the loaded workflow validates with the workflow's counters; a route naming a step outside the shared file is refused with "a shared file leaves through an exit". — verifier: test
- AC5 Given a workflow with `defaults:` and a `use` step, when loaded, then the included steps are plain steps of the loaded workflow, carrying no limits of their own, so the workflow's defaults cover them as they cover its own steps. — verifier: test
- AC6 Given `use: nope` with no `shared/nope.yaml`, when loaded, then the workflow is reported broken, naming `shared/nope.yaml` and the folder `.agents/workflows/shared/`. — verifier: test
- AC7 Given an included step named like a workflow step, like the `use` step, or like a step from another shared file, or the same shared file used twice, when loaded, then the workflow is refused naming the clashing step and both places it comes from. — verifier: test
- AC8 Given a `use` step routing an exit the shared file lacks, a shared file containing a `use:` step, or a shared file holding `name`, `counters`, `defaults`, `mode` or `base`, when loaded, then the workflow is refused naming the exit and file, saying a shared file cannot use another shared file, or saying "`<key>` belongs in the workflow", respectively. — verifier: test
- AC9 Given files in `.agents/workflows/shared/`, when the workflows are listed, then none of them is listed as a workflow; and a workflow with no `use` loads with `source` equal to its file text byte for byte and `hash` its sha256, while one with `use` loads with `source` the flattened text (no `use` left) and `hash` that text's sha256. — verifier: test
- AC10 Given `bun run schema:emit`, when it runs, then a `workflow-source` schema (a workflow as written, steps may be `use` steps) and a `workflow-shared` schema (`start`, `steps`, optional `description`, routes may be exits) are emitted next to the strict `workflow` schema, which is unchanged. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit`

## Notes
Plan D1 (flattening module in the store, synchronous over a reader of shared texts by name, plus a helper naming the shared files a text uses), D2 (serialization order), D3 (schemas), D4, D5, D7 (errors on the workflow file's FileError; the loader returns which steps came from which shared file, for slice 07), D8, D9. Lands in `loadFile`; slice 02 moves it into the shared text loader, whichever merges second wires the call through the other. The `workflow-source` schema here allows `use` steps only; slice 04 adds `like` steps.
