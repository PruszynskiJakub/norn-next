## Goal

Fix gap 2 of gh-73: GR8's "issue body changed since refine" item never fired because `refineFinished` matched only `skill === "refine"`, while shipped workflows use `norn-refine`.

## Progress

- Red test first: `packages/core/test/unit/decide.test.ts` "GR8 (gh-73): a refine step on the bundled skill `norn-refine` …" — failed with `slices.wait` instead of `remote.mirror.refined`.
- Fix: `packages/core/src/decide/story.ts` `refineFinished` accepts `refine` or `norn-refine` (`REFINE_SKILLS`).
- Later rounds: once recorded, `refined_body_hash` stays in spec.md's frontmatter (only written when unset), so a round on a workflow without a refine step still surfaces a body change; the same test covers that.
- Left the core fixture (`skill: "refine"`) as is so the golden corpus stays unchanged; the new test uses the real name.
- Gap 1 (edits before refine finishes) is out of scope, to be filed separately.
- `bun run test` and `bun run typecheck` green.
- implement#1 done: refineFinished now matches skill norn-refine as well as refine (story.ts), so GR8's refined_body_hash is recorded with shipped workflows and the body-changed inbox item appears; test in decide.test.ts covers the real skill name and a later round without refine. Unit tier and typecheck green.

- implement#2 (test.fail rework): the one failing integration test (takeover-record.test.ts AC4) failed in `git clone` of the harness's temp remote (`fatal: failed to copy file to …/.git/objects/…: No such file or directory`): an environment/filesystem flake under parallel load, not this change (core decide only). Rerun of that file alone: 12/12 pass. No code change. Unit tier and typecheck green.
- implement#2 done: test.fail was an environment flake: takeover-record AC4 died in the harness's git clone (failed to copy object file in temp dir), unrelated to the core decide change; that file reruns 12/12 green alone. No code change; unit tier and typecheck green.

## Resume

Nothing left in implement; the `test` check runs next. If AC4 fails again in the same `git clone` way, file it as a flaky-harness friction issue.
