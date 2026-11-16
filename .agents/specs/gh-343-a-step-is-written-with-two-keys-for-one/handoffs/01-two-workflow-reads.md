### Goal
Prefactor: every workflow read names whether it reads the main checkout's files (`checkout`) or a copy (`copy`: a pin, a past round's trace or record, a story branch's file at a lost-record restart), so the old-wording rule later changes in one place. Nothing a user sees changes.

### Proof
- Read kind is an explicit, required argument: `WorkflowRead = "checkout" | "copy"` in `packages/store/src/unit.ts`; `parseWorkflowText(text, path, read, root?)` and `loadWorkflowText(name, text, file, read, root?, readShared?)`. Type check enforces every caller names one.
- Callers: `loadFile` (behind `loadWorkflows` / `loadWorkflow`) → `checkout`; `readPinnedWorkflow`, `pinWorkflow`, the tick-trace reader (`tickReader` / `readTickInputs`), `readRecordObjects`' pinned `workflow.yaml` read, and the lost-record restart in `packages/cli/src/runtime/checkout.ts` (`lostRecord`) → `copy`. `snapshot.ts` and `recordErrors` read pins through `readPinnedWorkflow`.
- AC1 (same workflow loaded from every reader, existing tests green) and AC2 (each reader asks for its read kind): `packages/store/test/unit/workflow-reads.test.ts` (listing + single load = checkout; `loadWorkflowText` passes the caller's kind; pin write + pin read = copy; `recordErrors` = copy; trace reader = copy; each also checks the loaded workflow equals the main checkout's). Seen red: flipping the kind in `loadFile`, `readPinnedWorkflow` and the trace reader fails 4 of its 6 tests.
- Record reader's branch read: new case in `packages/store/test/integration/record-objects.test.ts` › "a unit's pinned workflow in the record is read as a copy and loads".
- Restart: `packages/cli/test/integration/takeover-record-lost.test.ts` › "the restart pins the branch's workflow with the fingerprint the listing gives it" now also asserts the branch file `.agents/workflows/rv.yaml` was read as `copy`.
- Observed through a test hook `setWorkflowReadObserver` (same shape as `setTraceReadObserver`), called in `parseWorkflowText`.
- `bun run test` (1955 pass) and `bun run typecheck` green.
- Review #1 traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | today's workflow loads the same from the main checkout, a pin, a past round's trace or record, and a story branch at a lost-record restart; existing tests stay green | test | `packages/store/test/unit/workflow-reads.test.ts` (each reader's loaded workflow equals the main checkout's); `packages/store/test/integration/record-objects.test.ts` › "a unit's pinned workflow in the record is read as a copy and loads"; `packages/cli/test/integration/takeover-record-lost.test.ts` › "the restart pins the branch's workflow with the fingerprint the listing gives it"; unit tier + typecheck green (test#1) |
| AC2 | each reader asks for its read kind: checkout for the listing and single load; copy for pin, trace reader, record reader's branch read and restart | test | `packages/store/test/unit/workflow-reads.test.ts` › "the listing and the single-workflow load read the main checkout", "pinning and reading a unit's pin are copy reads", "a past round's pin read for the record's errors is a copy read", "the trace reader reads a tick's workflows as copies", "a text loaded as a workflow file keeps the read its caller names"; record-objects and takeover-record-lost cases above assert `copy` |

### Easy to miss
- Shared files (`use:`) are flattened as text before `parseWorkflowText`; they carry no read kind of their own. The copy-read translator (later slice) must translate shared files read for a copy too (the restart reads them from the branch).
- `pinWorkflow` is a copy read: it validates the text it pins, which at a restart is the branch file verbatim (D4).

### Not proven yet
- Nothing open for this slice. Review #1 ran the two integration cases locally (record-objects: 3 pass; takeover-record-lost restart case: pass).

### Notes
- Chose a read observer over spying: the kind does not change behaviour yet, so the hook is the only way a test sees it.

### Resume
Review #1 approved with no findings; next is the slice's following step (QA or integration).
