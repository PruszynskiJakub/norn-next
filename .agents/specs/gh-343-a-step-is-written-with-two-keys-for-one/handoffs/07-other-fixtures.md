### Goal
Every workflow fixture the unit tier (core, store, view, cli) and the e2e tier write into a main checkout is in the new wording, so slice 09's old-wording refusal leaves both tiers green. Pinned outputs move only in wording-derived values, never in an effect or a decision.

### Proof
- AC1 (unit and e2e tiers pass; no test writes old wording into a main checkout unless it is about the old wording): `bun run test` 2033 pass, `bun run typecheck` clean. The changed e2e files were run once locally and pass: base-sync, recovery, slice-workflow, observe-snapshots (48 pass, transcripts rewritten) and team, light-path, merged-pr, auto-recovery (31 pass).
- AC2 (transcripts and snapshots change only in the fixtures' wording): each of `test/e2e/transcripts/{base-sync,e2e-slice-workflow,recovery-claim-lost}.txt` is identical to HEAD~1 once 64-hex hashes, the pin's `sha256 <12>` and `text N lines` are normalised. The four `test/e2e/observe-snapshots/*.json` diffs hold only `workflow_hash` and a loaded `"instructions": "Use the \`X\` skill."` per agent step.
- Migrated fixtures: `packages/store/test/helpers.ts` `WORKFLOW_YAML`; `packages/store/test/unit/shared-workflows.test.ts` (BASE_UPDATE, STORY, LIKE and the inline gate steps); `packages/store/test/unit/config-trace.test.ts` (the `bug.json` gate); `packages/cli/test/unit/light-route.test.ts` (anchor test, flow-map `check:`); the e2e constants MINI, SLICE, BASED, HELD, LIGHT, REL, SOLO.

### Easy to miss
- Fixtures went through the slice 03 translator (`translateWording`), so they keep its fallbacks: orientation ``Use the `X` skill.``, gate text `approve or reject <step>`, and meaning `step finished with outcome <o>`. That is why briefs, gate reasons and transcripts read as before. Inside TS template literals the orientation's backticks are escaped (`\``).
- A route with no meaning needs one in `means:` now. The shared-workflows `skip: $done` case gains `skip: step finished with outcome skip`.
- The translator drops a `means` on a check step's exit route (`pass: { exit: tested, means: … }` in BASE_UPDATE). Check routes carry no meaning, and no test read it.

### Not proven yet
- AC1's "no test writes old wording" is proven only once slice 09 refuses old wording in the main checkout. Nothing enforces it today.
- Left in the old wording on purpose: copies (pins via `pinWorkflow` in `ready-since.test.ts` and `markdown-unit.test.ts`, the `packages/core/test/fixtures/sandbox/*/workflow.yaml` pinned replays) and the translator/loader tests (`wording.test.ts`, `new-wording.test.ts`).
- Belonging to slice 05 (shipped files and schemas): `packages/schema/test/unit/workflow.test.ts` (the old file schema), `packages/cli/test/unit/detect.test.ts` and `withTestCommand`, which edits a template's `run: bun test`, the `slice-workflow.test.ts` assertion `run: "npm ci && npm test"` on the shipped shared file, and the tests that copy shipped or repo workflows (assets, light-route repo cases, test/repo).
- Core, view and the golden cases hold the loaded `type`-tagged model (D1), not file text, so they need no change.

### Notes
- The observe snapshots had not been re-recorded since slice 04 made `instructions` required in the model, so the e2e tier was already set to fail on them. The re-record here also takes in that model field. No effect or decision moved.
- The brief says not to run the e2e tier. The slice's own note asks for `bun run test:e2e <file>` to rewrite its pinned outputs, so only the changed e2e files were run, once.
- Friction: the worktree had no `node_modules`, and the first `bun run test` failed until `bun install`.

### Resume
Review the commit `test: write the unit and e2e workflow fixtures in the new wording` against AC1 and AC2. CI runs the full e2e tier once the PR is open.
