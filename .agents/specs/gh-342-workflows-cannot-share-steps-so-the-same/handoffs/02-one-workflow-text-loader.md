# gh-342/02 — one workflow text loader

### Goal
One store function turns a workflow file's text into the workflow a unit pins (parse, the name check, `source`, `hash`), used by both the workflow listing and the lost-record restart in `norn story checkout`, so later flattening lands in one place.

### Proof
- `loadWorkflowText(name, text, file, root?)` in `packages/store/src/config.ts`; `loadFile` (listing, `loadWorkflow`) and `lostRecord` in `packages/cli/src/runtime/checkout.ts` both call it.
- AC1 (a workflow whose `name` differs from its file name is listed broken with "must equal the file name"): `packages/store/test/unit/config-trace.test.ts` › "a workflow whose name is not its file name is listed broken, the name pointed at"; also "a loaded workflow pins its file's text byte for byte, fingerprinted by its sha256". Both green, unit tier.
- AC2 (lost-record restart refuses a bad name or failing validation with `workflow_invalid`; a valid workflow is pinned with the listing's fingerprint): `packages/cli/test/integration/takeover-record-lost.test.ts` › "a workflow on the branch whose name is not its file name: refused workflow_invalid as the listing reports it, nothing taken" and "the restart pins the branch's workflow with the fingerprint the listing gives it"; the existing "S5: an invalid workflow on the branch" test covers failing validation. Integration tier: runs in CI, not run locally per the brief.
- `bun run test` (1914 pass) and `bun run typecheck` green (test#1 check pass).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a workflow whose `name` differs from its file name is listed broken with "must equal the file name", as today | test | `packages/store/test/unit/config-trace.test.ts` › "a workflow whose name is not its file name is listed broken, the name pointed at" |
| AC2 | a lost-record restart refuses a misnamed or invalid branch workflow with `workflow_invalid`; a valid one is pinned with the listing's fingerprint | test | `packages/cli/test/integration/takeover-record-lost.test.ts` › "a workflow on the branch whose name is not its file name: refused workflow_invalid…", the existing invalid-workflow test (`start: nowhere`), and "the restart pins the branch's workflow with the fingerprint the listing gives it" |
| Groundwork: listing and restart pin the same thing (prefactor 2) | one store function for parse, name check, `source`, `hash` | test | both tests above; `loadFile` and `lostRecord` both call `loadWorkflowText` |

### Easy to miss
- The function stays synchronous (plan D1): the `git show` reads of the branch stay in the restart, which passes the text in.
- The restart's refusal for a misnamed workflow now says "must equal the file name 'rv'" (the listing's wording) instead of "its name is not 'rv'"; code `workflow_invalid` unchanged.

### Not proven yet
- The two new integration tests have not run locally (integration tier is CI-only); they first run in CI.

### Notes
- Behaviour-preserving prefactor: no existing test changed. The AC1 unit tests pass on the old code too (nothing new to go red); the misnamed-restart integration test would fail on the old code on its message assertion.

### Resume
Review #1 approved with no findings; nothing left for this slice. The AC2 integration tests first run in CI.
