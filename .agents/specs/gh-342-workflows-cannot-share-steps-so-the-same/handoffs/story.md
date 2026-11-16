## Goal

Workflows bring in steps from shared files (`use:` with named exits) and copy steps within a file (`like:`), flattened at load, so one behaviour change is made in one place; units run exactly as before.

## Proof

- Spec written and confirmed with the person: `spec.md` (29 user stories, no open questions). Proof per story comes from planning.

## Easy to miss

- Included steps keep their own names (no prefix): receipts, goldens, `--at` and `reset_on` must not change. Hence one use per file per workflow.
- A workflow with neither `use` nor `like` must pin byte for byte as today (same fingerprint), or running units and receipts drift.
- Shared files live in `.agents/workflows/shared/`: never listed, labelled or startable.
- Errors in included steps must name the shared file and the step, not only the flattened path.
- Bundled copies: both `packages/cli/assets/workflows/` and `.agents/workflows/` get rewritten (this repo's `release` too); `norn init` must copy `shared/`.

## Not proven yet

- That the rewritten `quick`/`story` flatten to today's 29/8 and 42/10 routes/counters (only the earlier prototype showed it).

## Notes

- Decisions (person, refine round): users include repo owners; `shared/` subfolder; names kept; named exits, unrouted exit → `$stuck`; `like:` same file only, no chains, not of a `use` step; pin the flattened workflow; both workflow sets rewritten, repo difference lives in each set's shared files; no nesting (`use` in a shared file refused); shared file holds `start`, `steps`, `description` only; JSON Schema for shared files emitted.
- Triage: flattening reads files, so it belongs in store before core validation; `roundStart` compares the hash of the loaded source, which must become the flattened text.

## Resume

Plan the spec (`norn-plan`).
