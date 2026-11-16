## Goal

A person meets a broken shared file wherever a broken workflow shows, with messages naming the shared file and step; a shared file never starts a round; a round pins the flattened workflow; a lost record restarts with the shared files read from its branch.

## Proof

- AC1 (doctor names `shared/<name>.yaml` and the step for an included step routing back without a counter, or naming an undeclared counter): `packages/cli/test/integration/shared-workflows.test.ts` › "AC1: doctor names the shared file and the step of an issue on an included step". Code: `inSharedFile` in `packages/cli/src/runtime/workflows.ts` (the shared validator observe and doctor use) prefixes `shared/<file>.yaml, step '<step>': ` using the loader's `included` map; an uncounted cycle takes the first included step of its cycle when its path step is not included.
- AC2 (a missing shared file shows broken in doctor and the listing, story create and story edit refuse it as a broken workflow): same file › "AC2: a missing shared file is broken…", compared side by side with a schema-broken `bad.yaml`. No code change needed: the loader reports it as a listing error.
- AC3 (`story edit --workflow ship` with only `shared/ship.yaml` → `unknown_workflow`): same file › "AC3: story edit --workflow naming a shared file is refused as an unknown workflow". No code change needed (listing reads only the workflows folder's own files).
- AC4 (round pins flattened text, no `use`/`like`, hash = sha256 of it; shared edit after `story edit` → `round.workflow_changed`; next edit takes the new text; running round keeps its pin): same file › "AC4: the round pins the flattened text…". No code change needed (pin reads `source`).
- AC5 (lost-record restart flattens the branch's shared file, not the work tree's; missing on the branch → `workflow_invalid`): `packages/cli/test/integration/takeover-record-lost.test.ts` › "the restart flattens the shared file on the branch, not the one in the work tree" (red before the change in `lostRecord`, `packages/cli/src/runtime/checkout.ts`) and "a shared file missing on the branch: refused workflow_invalid naming it, nothing taken".
- `bun run test` (1938 pass) and `bun run typecheck` green. The new integration tests were run once locally by file and name filter (all pass); the full integration tier runs in CI.

## Easy to miss

- The restart reads shared files with `git show` on the branch head (`.agents/workflows/shared/<name>.yaml`), never the work tree.
- Bun's `toMatchObject` mutates the received value: the tests compare fields after it, never read a value already matched.

## Not proven yet

- Nothing beyond the CI run of the integration tier.

## Notes

- "The workflow listing" in AC2 is read as the loader's listing that `story create` offers in `do_instead` (broken workflows are left out, as before) plus doctor's `workflows` list.

## Resume

Implementation done; next is review of this slice.
