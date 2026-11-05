## Goal

Fix gap 2 of gh-73: GR8's "issue body changed since refine" item never fired because `refineFinished` matched only `skill === "refine"`, while shipped workflows use `norn-refine`.

## Progress

- Red test first: `packages/core/test/unit/decide.test.ts` "GR8 (gh-73): a refine step on the bundled skill `norn-refine` …" — failed with `slices.wait` instead of `remote.mirror.refined`.
- Fix: `packages/core/src/decide/story.ts` `refineFinished` accepts `refine` or `norn-refine` (`REFINE_SKILLS`).
- Later rounds: once recorded, `refined_body_hash` stays in spec.md's frontmatter (only written when unset), so a round on a workflow without a refine step still surfaces a body change; the same test covers that.
- Left the core fixture (`skill: "refine"`) as is so the golden corpus stays unchanged; the new test uses the real name.
- Gap 1 (edits before refine finishes) is out of scope, to be filed separately.
- `bun run test` and `bun run typecheck` green.

## Resume

Nothing left in implement; the `test` check runs next.
