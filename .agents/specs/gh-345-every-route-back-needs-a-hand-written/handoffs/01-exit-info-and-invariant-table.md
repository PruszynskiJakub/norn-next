### Goal
Groundwork, no behaviour change: the loader reports which shared-file exit each flat edge left by (with that use route's counter and max), and tests pin today's pins and today's counting of every shipped workflow.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | every bundled and repo workflow (release included) loads to today's pinned source and hash | test | `packages/store/test/unit/shipped-workflow-counting.test.ts` › "workflows installed before derived counters keep their pin" (frozen copies in `packages/store/test/fixtures/workflows-today/`, byte-identical to the base's live files; hash literals) |
| AC2 | each flat edge that left through a shared exit reports `<use step>.<exit>` with that route's counter and max; pinned text unchanged | test | `packages/store/test/unit/shared-workflows.test.ts` › "each flat edge that left through a shared exit reports the use step's exit and that route's counter; the pinned text is unchanged" (counter observed; max not yet observable, schema refuses `max:` on a use route until slice 02) |
| AC3 | a name-free invariant table of every shipped workflow's counting (max, resets, shared groups) holds for the live files | test | `packages/store/test/unit/shipped-workflow-counting.test.ts` › "every shipped workflow keeps its counting" |

- `bun run test` and `bun run typecheck` green (test#1 pass); review re-ran the two test files: 26 pass.

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
Review approved; slice integrates. Next is slice 02 (derive a counter per edge), building on `exits` from the loader.
