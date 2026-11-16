### Goal
Groundwork, no behaviour change: the loader reports which shared-file exit each flat edge left by (with that use route's counter and max), and tests pin today's pins and today's counting of every shipped workflow.

### Proof
- AC1 (today's pins kept): `packages/store/test/unit/shipped-workflow-counting.test.ts` › "workflows installed before derived counters keep their pin" — loads copies of today's bundled and repo workflows (`packages/store/test/fixtures/workflows-today/{bundled,repo}/`, release included) and compares each hash to a pinned literal.
- AC2 (shared-exit info): `packages/store/test/unit/shared-workflows.test.ts` › "each flat edge that left through a shared exit reports the use step's exit and that route's counter; the pinned text is unchanged" — went red before the loader change.
- AC3 (invariant table): same counting test file › "every shipped workflow keeps its counting" — loads the live `packages/cli/assets/workflows/` and `.agents/workflows/` and compares a name-free table (per counted edge: max, reset edges; groups sharing a counter). Checked that changing slice's `test_loop` max to 4 fails it.
- `bun run test` (2081 pass) and `bun run typecheck` green.

### Easy to miss
- The exit info lives on the loader's result: `WorkflowFile.exits` / `loadWorkflowText(...).value.exits`, next to `included`: flat edge `<step>.<outcome>` → `{ exit: "<use step>.<exit>", counter?, max? }`. Present only when the workflow uses a shared file; an unrouted exit is reported without counter.
- `max` is read from the use route if present, but the as-written schema (`UseStep`) still refuses `max:` there; slice 02 adds it, and only then can a test observe it.
- The AC1 fixtures are frozen copies on purpose: slice 05 edits the live files, the fixtures must not change. The AC3 table reads the live files: slice 05 must keep it passing.
- `ACCEPTED_RESETS` in the counting test already forgives `integrate.conflict` resetting on `integrate.done` in slice (the stated exception); a self-test checks it forgives nothing else.

### Not proven yet
- Nothing in this slice's criteria. Deriving counters is slices 02/03.

### Notes
- Bundled and repo tables are equal for quick, story, slice, refinement; release is repo only. This repo's quick names its CI fail edge `ci.fail` once loaded.

### Resume
Slice done; next is slice 02 (derive a counter per edge), building on `exits` from the loader.
