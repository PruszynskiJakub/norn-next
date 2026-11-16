### Goal
Every workflow the cli integration tests write into a test repo is in the new wording (head key, `skills:`, `by:`, sibling `means:`/`verdict:`), so slice 09's old-wording refusal leaves the suite green. No behaviour change.

### Proof
- AC1 (suite passes in CI; no old-wording file written into a main checkout unless the test is about the old wording): no integration test is about the old wording (none existed before this story). A grep for `type: agent|check|gate|git|merge|slices`, `skill:`, `action:` and `"type": "..."` across `packages/cli/test/integration/` now finds only `human.test.ts:524`, a `run view` JSON field (`type: "gate"`), which is not a fixture. The integration tier itself runs only in CI, once the PR is open.
- AC2 (same behaviour, only the fixture's wording changed): `equivalence.txt` in the evidence pairs each changed string literal before and after, with interpolations replaced by tokens. Each pair loads to a deep-equal workflow (`parseWorkflowText`, old as a copy, new from the checkout), or, for fragments and shared files, to an equal translated value: 107 checked, 107 equal, 0 different. No command or expected output changed. The only non-fixture edits are `.replace(...)` calls that edit a fixture by its text, retargeted to the new keys (`skills: [x]`, `by:`, `done: "built"`).
- `bun run test` (2033 pass) and `bun run typecheck` pass.

### Easy to miss
- The translator writes the fallback orientation ``Use the `X` skill.`` with backticks. Inside a JS template literal they must be `\``; the script's raw output broke the literals until they were escaped.
- Tests that edit a fixture with `.replace("skill: …")` or `.replace('means: "built"')` silently became no-ops after the rewrite. They were retargeted in config-runtime, housekeeping, shared-workflows and takeover-record-lost.
- The translator refuses flow-map steps, so `housekeeping.test.ts` LOOP, `pre-013-repo.test.ts` (a double-quoted string) and `run-state-machine-dir.test.ts:307` (a one-line literal) were rewritten by hand.

### Not proven yet
- The integration tier was not run locally, as the brief says. CI proves AC1.

### Notes
- Done with the slice 03 translator over each template literal (`mig.ts` in the evidence), then fixed by hand as listed above. Added fallbacks (`step finished with outcome <o>`, `approve or reject <step>`) are the translator's own and load to the same model as the old text did.
- Pins in these tests (`workflow.yaml` equal to the written text, a flat round pin in `human.test.ts`) are now new-wording text. Pins load in either wording, and none of these tests is about the old wording.
- Friction: none.

### Resume
Review the diff against AC1/AC2. CI's integration tier is the final proof of AC1.
