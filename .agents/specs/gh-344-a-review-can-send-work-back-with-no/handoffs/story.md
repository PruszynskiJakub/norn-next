# gh-344 — hand_back: an outcome that sends work back must carry findings

### Goal

An agent step can declare `hand_back: { <outcome>: findings | evidence }`; `norn done <outcome>` without that flag is refused (`hand_back_required`), the brief's finish line shows the flag, load refuses a bad key (`unknown_outcome`), and the shipped workflows require findings on `review.changes_requested`, `resolution-review.changes_requested` and `qa.fail`.

### Proof

Review #1: approve, no blocking findings. `bun run test` (2075 pass) and `bun run typecheck` green at review.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted 1 | an agent step may declare `hand_back`, outcome → `findings` or `evidence` | test | `packages/core/test/unit/hand-back.test.ts` › "a map naming outcomes the step reports loads"; schema `packages/schema/src/workflow.ts` (`HandBack`, `AgentStep.hand_back`); loader `toModelStep` copies unknown keys through |
| Wanted 2 | `norn done <outcome>` without the required flag is refused, `hand_back_required`, `do_instead` names flag and file format | test | `hand-back.test.ts` › "an outcome that must hand back findings is refused without them, naming the flag and the file format", "an empty findings file hands back nothing, so it is refused too", "an outcome that must hand back evidence is refused without an evidence folder"; CLI: `packages/cli/test/integration/criteria.test.ts` › "refusals: … a fail without findings" (integration tier, CI) |
| Wanted 3 | the brief's finish line shows the flag, as it does for `--criteria` | test | `hand-back.test.ts` › "the finish line of an outcome that must hand back shows its flag, beside --criteria"; `criteria.test.ts` (integration) asserts the brief markdown |
| Wanted 4 | load refuses `hand_back` naming an undeclared outcome or an overridable route (`unknown_outcome`) | test | `hand-back.test.ts` › "an outcome the step does not declare is unknown_outcome", "an overridable route is unknown_outcome, even when the step declares it" |
| Wanted 5 | `criteria: required` stays as it is | test | `packages/core/test/unit/criteria.test.ts` unchanged and green |
| Wanted 6 | shipped workflows declare it on `review.changes_requested`, `resolution-review.changes_requested`, `qa.fail` | test | pinned hashes in `packages/cli/test/unit/assets.test.ts` › "%s keeps its pinned meaning" and `test/repo/process.test.ts` (quick, story) moved for exactly these lines; `slice.yaml` review is checked only by the diff and load validation (minor note) |


- Agent step may declare `hand_back` (wanted 1): `packages/schema/src/workflow.ts` (`HandBack`, `AgentStep.hand_back`); the YAML loader passes it through unchanged (`toModelStep`). Schema JSON re-emitted.
- `norn done` without the required flag refused, `hand_back_required`, `do_instead` names flag + file format (wanted 2): `packages/core/test/unit/hand-back.test.ts` › "an outcome that must hand back findings is refused without them…", "…evidence…", "an empty findings file hands back nothing…"; through the CLI: `packages/cli/test/integration/criteria.test.ts` › "refusals: … a fail without findings" (integration tier, runs in CI; not run locally).
- Brief finish line shows the flag beside `--criteria` (wanted 3): `hand-back.test.ts` › "the finish line of an outcome that must hand back shows its flag, beside --criteria"; integration test asserts the brief markdown too.
- Load refuses an undeclared outcome or an overridable route (wanted 4): `hand-back.test.ts` › "an outcome the step does not declare is unknown_outcome", "an overridable route is unknown_outcome, even when the step declares it".
- `criteria: required` unchanged (wanted 5): existing `packages/core/test/unit/criteria.test.ts` green.
- Shipped workflows (wanted 6): `hand_back` added in both `packages/cli/assets/workflows/` and `.agents/workflows/` (quick, slice, story review + qa, shared/base-update resolution-review); pinned hashes in `packages/cli/test/unit/assets.test.ts` and `test/repo/process.test.ts` updated for this intended change.
- `bun run test` (2075 pass) and `bun run typecheck` green. The e2e pinned outputs (slice-workflow, base-sync, observe-snapshots) re-run with `NORN_TRANSCRIPT_UPDATE=1`: no change.

### Easy to miss

- An empty findings file (`[]`) is refused too: it would send work back with nothing to rework, the very bug.
- The `hand_back` check runs in `done` before the criteria check, so the refusal's `do_instead` includes `--criteria <file>` when the step requires it (or the outcome is verdict-gated).
- Shipped workflows change in both copies; the pinned hashes move only for these lines.

### Not proven yet

- The integration test in `criteria.test.ts` was written but not run locally (integration tier is CI-only per the brief).

### Notes

- Pure check lives in `packages/core/src/hand-back.ts` (`checkHandBack`), mirroring `checkReport`; `done.ts` only wires it.
- Docs: one paragraph in `docs/recipes.md` (Write your own workflow). `docs:emit` produced no change.

### Resume

Review the branch against the issue's Wanted list.
