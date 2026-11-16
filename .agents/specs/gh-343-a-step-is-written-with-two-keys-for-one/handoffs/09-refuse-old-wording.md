### Goal
A workflow file in the main checkout (`.agents/workflows/`, shared files included) written in the old or a mixed wording is refused (`old_wording`, `do_instead` names `norn upgrade`) and treated as an invalid workflow. Copies (pins, past rounds, branch file at a lost-record restart) keep loading through the translator. New units pin the new wording.

### Proof
Nothing built yet. Baseline: `bun run test` 2051 pass, 0 fail (after `bun install`).

### Easy to miss
- Today both reads translate: `parseWorkflowText` (`packages/store/src/unit.ts:78`) calls `translateWordingValue` for every read, and `loadWorkflowText` (`packages/store/src/config.ts:355`) runs `inNewWording` on the workflow and on each shared file before flattening. The checkout read must skip both and refuse instead. The copy read stays as it is.
- Old-wording detection (D5) already exists as `isOldStep` in `packages/store/src/wording.ts:95` (`OLD_STEP_KEYS` plus `means`/`verdict` inside an edge). Export a detector from there that names the steps and keys, so the translator and the refusal agree.
- One error per file (D5), so doctor reports one issue per file. A shared file in the old wording refuses every checkout workflow that uses it: name the shared file in the message.
- Existing tests that write old wording into a main checkout will start failing. Fixtures were moved to the new wording in slices 06 and 07, so check each failure before changing it.

### Not proven yet
AC1–AC8: all open.

### Notes
- Planned seam (S1): in `loadWorkflowText`, when `read === "checkout"`, check the own text and every shared text for old steps and return one `fileError` (code `old_wording`, message naming the steps and keys). In `parseWorkflowText`, translate only when `read === "copy"`. Then find where cli turns an invalid-workflow refusal into a `CliError` (story edit `--workflow`, story start, sync, doctor) and put `norn upgrade` in `do_instead` for `old_wording`.
- AC7 already holds once the refusal exists: a checkout file with no `use`/`like` pins as written, and the flattened text is new wording.
- The previous session stopped after reading the code because its usage limit was reached.
- Friction: the worktree had no `node_modules`, and the first `bun run test` failed until `bun install`.

### Resume
Build the refusal above test-first in `packages/store/test/unit/` (refused in the checkout, loads from a copy, mixed wording counts as old). Then the cli `do_instead` and the doctor, sync and story edit tests (integration tier).
