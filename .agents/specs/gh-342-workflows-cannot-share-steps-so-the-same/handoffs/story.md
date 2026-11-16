## Goal

Workflows bring in steps from shared files (`use:` with named exits) and copy steps within a file (`like:`), flattened at load, so one behaviour change is made in one place; units run exactly as before.

## Proof

- Spec and Plan in `spec.md`: 29 user stories, each mapped to a seam (S1 store loader, S2 cli harness, S3 shipped/repo workflow sets + init, S4 schema emit, S5 recipes doc). Proof per story is the coverage table.
- Eight slices in `slices/` (30 criteria, mirrored as `01.AC1`… in spec.md's `criteria`): 01 pin today's `workflowHash`; 02 one workflow-text loader (listing + lost-record restart); 03 `use:` + exits + refusals + schemas; 04 `like:`; 05 bundled set rewrite + `norn init` copying `shared/`; 06 repo set rewrite; 07 cli surfacing, pins, lost-record restart from the branch; 08 recipes.

## Easy to miss

- Included steps keep their own names (no prefix): receipts, goldens, `--at`, `reset_on` unchanged. Hence one use per file per workflow, and the `use` step's name must not clash with an included step.
- A workflow with neither `use` nor `like` keeps `source` = file text byte for byte (same fingerprint).
- `source`/`hash` of a loaded workflow become the flattened text; every downstream reader (pin, round start hash compare, story edit) already uses `source`.
- Flatten errors go on the workflow file's FileError (the listing derives the name from the file); messages name `shared/<name>.yaml` and the step.
- Lost-record `norn story checkout` reads the workflow via `git show`: it must read the shared files from the same branch (Plan D1, prefactor 2).
- `norn init` copies `shared/` (today it would `readFileSync` a directory) and its test command rewrite must reach the shared file holding the test check.
- Both workflow sets are rewritten; `bun run docs:emit` after.

## Not proven yet

- Everything: no code yet. That the rewritten workflows flatten to today's is proven by slice 01's recorded `workflowHash`.

## Notes

- Slicing: 03 (`use:`) does not wait for 02; it lands in today's `loadFile`, and whichever of 02/03 merges second wires the call through the other. 07 needs both. 05/06 need 04 (anchors give way to `like:`) and 01 (hashes). S2/init criteria are integration tests, which CI runs; slice checks name only `bun run test` / `typecheck`.
- Plan decisions agreed with the person: strict `workflow` schema kept + new `workflow-source` and `workflow-shared` (both emitted); shared routes name own steps, `$done`/`$stuck` or `{ exit, means?, verdict? }`, never a workflow step; `like:` is shallow (a written top-level key replaces the copied value whole).
- Prefactors first: (1) tests load workflows through the store and pin today's `workflowHash` per rewritten workflow; (2) one store function turns workflow text into a loaded workflow, shared by the listing and the lost-record restart.

## Resume

Next step: the person approves the slices; then 01, 02 and 03 start in parallel (critical path 03 → 04 → 05/06).
