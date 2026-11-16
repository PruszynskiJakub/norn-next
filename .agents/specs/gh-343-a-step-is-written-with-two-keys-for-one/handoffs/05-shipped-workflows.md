### Goal
`norn init` writes the workflows and shared files in the new wording, each agent step with a hand-written orientation. This repo's copies (with `release.yaml`) match. The emitted JSON Schemas describe only the new wording, and the model schema is no longer published.

### Proof
`bun run test` (2051 pass) and `bun run typecheck` are green. Each test below failed before its change (checked against HEAD's workflow files or HEAD's `workflow.ts`).

| Criterion | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | init writes every workflow and shared file in the new wording: no old key, no meaning or verdict inside a route, each agent step has an orientation | test | `packages/cli/test/unit/assets.test.ts` › "the new wording" › "norn init writes every workflow and shared file in the new wording, each agent step with a hand-written orientation" (it also validates each file against `workflow-source`/`workflow-shared` and rejects the translator's fallback texts) |
| AC2 | this repo's `.agents/workflows/` (with `shared/` and `release.yaml`) is in the new wording and loads; its shared copies match the shipped ones | test | same describe › "this repo's workflows, with release.yaml and shared/, are in the new wording and load", "this repo's shared copies have the shipped ones' steps, each with the same head key" |
| AC3 | the source and shared schemas have one step shape per head key and accept no old key; the model is not published as `workflow.schema.json`; any `$schema` a file names is the new-wording one | test | `packages/schema/test/unit/workflow.test.ts` › "each schema has one step shape per head key…", "neither schema accepts the old key `%s` on any step" ×6, "neither schema accepts a meaning or verdict inside a route…"; `packages/schema/test/unit/ids-config.test.ts` › "the loaded workflow model is checked against but not published…"; the `$schema` check is in `wordingProblems` in assets.test.ts (no shipped or repo file names one today) |
| AC4 | the hand-written orientations steer the agent; the moved hashes were reviewed | person | Orientations to read: shipped `story.yaml` implement and review, `slice.yaml` implement, review and merge, `quick.yaml` review, `refinement.yaml` clarify, and the same steps in `.agents/workflows/`. Repo `slice.yaml` implement got the purpose sentence in front of its check-command text. Hash review: putting the fallback `Use the \`X\` skill.` back into those steps gives exactly the old pinned hashes (shipped quick/story `54f3e6…`/`d8e493…`, repo quick/story `a66c12…`/`4b6714…`). So the orientations are the only change in meaning. `release` is unchanged. |

### Easy to miss
- The translator's tests used to read the shipped files as their old-wording input. Those inputs are now fixtures: `packages/store/test/fixtures/wording/old/` (HEAD's shipped files) and `…/wording/new/` (their expected translations, which used to sit directly under `wording/`). Both `wording.test.ts` and `new-wording.test.ts` point there.
- `norn init`'s test-command rewrite (`withTestCommand` in `packages/cli/src/runtime/detect.ts`) now matches `check: bun test` lines, and init's next-step text says "change `check:`". The e2e `test/e2e/slice-workflow.test.ts` assertion was updated to match, but it has not been run locally.
- `workflow` stays in `SCHEMAS` for `validate("workflow", …)`. `PUBLISHED_SCHEMAS` (validate.ts) is what `schema:emit` writes and what the up-to-date test iterates.
- The file schemas are a plain union, with no type tag. The loader never validates against them: it does its own wording checks in `step-wording.ts`. Editors and tools are the readers.

### Not proven yet
- Integration and e2e tiers (CI). The tests that read workflows go through the loader (`ci-check.test.ts`), apart from the e2e init assertion noted above.
- AC4 is the person's call on the prose.

### Notes
- Only orientations where the translator fell back to ``Use the `X` skill.`` were hand-written, as the slice says. Every other agent step already had instructions, which became its orientation word for word. No gate or meaning fallback was needed in any file.
- "Shared copies match the shipped ones" is read as: the repo's same-named shared files have the shipped files' steps with the same head keys. The repo's `ci.yaml` + `land.yaml` together hold `ship.yaml`'s steps. Their contents (commands, outcome names) are repo-specific and differ on purpose.
- The header comments in shipped `slice.yaml` and `shared/base-update.yaml` now say "Change the `test` step's `check:`".
- `bun run docs:emit` produced no change.
- Friction: none.

### Resume
Implementation is done and committed. Next is review against AC1–AC4.
