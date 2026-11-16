## Goal

A person meets a broken shared file wherever a broken workflow shows, with messages naming the shared file and step; a shared file never starts a round; a round pins the flattened workflow; a lost record restarts with the shared files read from its branch.

## Proof

Review #1: approve, no findings. Traceability (each test read and seen to assert its item):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | doctor names `shared/<name>.yaml` and the step for an included step routing back without a counter or naming an undeclared counter | test | `packages/cli/test/integration/shared-workflows.test.ts` › "AC1: doctor names the shared file and the step of an issue on an included step" |
| AC2 | a missing shared file shows broken in doctor and the listing; story create and story edit refuse it as a broken workflow | test | `packages/cli/test/integration/shared-workflows.test.ts` › "AC2: a missing shared file is broken in doctor and the listing, and refused by story create and story edit as a broken workflow is" |
| AC3 | `story edit --workflow ship` with only `shared/ship.yaml` refuses as an unknown workflow | test | `packages/cli/test/integration/shared-workflows.test.ts` › "AC3: story edit --workflow naming a shared file is refused as an unknown workflow" |
| AC4 | the round pins the flattened text (no `use`/`like`, hash over it); a shared edit after story edit refuses the start with `round.workflow_changed`; the next edit takes it; a running round keeps its pin | test | `packages/cli/test/integration/shared-workflows.test.ts` › "AC4: the round pins the flattened text; a shared edit after story edit refuses the start, the next edit takes it, a running round keeps its pin" |
| AC5 | a lost-record restart flattens the branch's shared file, not the work tree's; missing on the branch refuses `workflow_invalid` | test | `packages/cli/test/integration/takeover-record-lost.test.ts` › "the restart flattens the shared file on the branch, not the one in the work tree" and "a shared file missing on the branch: refused workflow_invalid naming it, nothing taken" |

Code: `inSharedFile` in `packages/cli/src/runtime/workflows.ts` prefixes an issue on an included step with `shared/<file>.yaml, step '<step>': ` from the loader's `included` map; `lostRecord` in `packages/cli/src/runtime/checkout.ts` reads each used shared file with `git show` on the branch head, as `loadFile` does from disk. `bun run test` and `bun run typecheck` green (test#1).

## Easy to miss

- The restart reads shared files with `git show` on the branch head (`.agents/workflows/shared/<name>.yaml`), never the work tree.
- Bun's `toMatchObject` mutates the received value: the tests compare fields after it, never read a value already matched.

## Not proven yet

- Nothing beyond the CI run of the integration tier.

## Notes

- "The workflow listing" in AC2 is read as the loader's listing that `story create` offers in `do_instead` (broken workflows are left out, as before) plus doctor's `workflows` list.

## Resume

Review approved; next is the slice's following step (QA / CI integration tier).
