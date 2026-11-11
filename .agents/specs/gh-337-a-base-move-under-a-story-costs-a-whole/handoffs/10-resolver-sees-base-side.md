### Goal

A resolving agent's brief lists, for each conflicting path, the base commits since the merge base that touched it, the story that landed each (its `Norn-Story` trailer) and that story's `spec.md` / `pr.md` on the base, so it resolves by both sides' intent (the `base_side` step input).

### Proof

- AC1 brief lists the base side per conflicting path (sha, subject, story from the trailer incl. a squash commit's last trailer block, spec and PR body paths on the base), with or without the merge in progress: `packages/cli/test/integration/base-side.test.ts` › "the brief lists the base side per conflicting path, before and during the resolver's merge" (S3, real git; went red with the cli wiring disabled). Git op: `packages/adapters/test/contract/git.ts` › "log limited to paths lists only the commits that touched them; a squash commit's trailers are its last block" (S4).
- AC2 a trailer-less base commit is listed with its subject and no story: same integration test (`hand fix on main`), and `packages/core/test/unit/base-sync.test.ts` › "2b: a resolve step with the base_side input: …" (S2).
- AC3 the brief's Base update section shows the base side, before the resolve guidance; only when the step declares `base_side`: `base-sync.test.ts` › "2b …" (went red first).
- AC4 shipped story and quick (both copies) `resolve` takes `base_side` and validates: `packages/cli/test/unit/assets.test.ts` › "story's and quick's resolve take the base side of each conflict"; `test/repo/process.test.ts` › "story's and quick's resolve take the base side of each conflict, as the shipped copies do" (both red first); existing per-file validation tests cover validity.
- AC5 bundled `packages/cli/assets/skills/norn-merge/SKILL.md` › "Read the base side first" paragraph at the top of "Resolve each conflict by intent" (agent verifier: review).
- `bun run test` (1760 pass) and `bun run typecheck` green; `bun run schema:emit` regenerated `workflow.schema.json`; `bun run docs:emit` changed nothing.

### Easy to miss

- The base side is gathered in the cli (`packages/cli/src/runtime/base-side.ts`, called from `commands/brief.ts`) from the entering classify-conflict receipt's `base` (sha, conflicts); merge base is `HEAD` vs the base sha, and HEAD is still the story side while the resolver's merge is in progress, so the same list shows then.
- `renderBrief` shows it only when the step declares `base_side`, even if the caller passes it.
- Trailers come from git's own trailer parsing (`%(trailers:only)`), which reads the message's last trailer block: that is what makes a squash commit's story come out.
- Spec path falls back to `story.md` (older spec folders); each of spec / pr is null when the base lacks it.

### Not proven yet

- The new integration test and the contract test run in CI's integration tier; I ran only those two files locally (both pass), not the tier.
- AC5 is for review to judge.

### Notes

- `GitPort.log` gained an optional `paths` argument (`git log <range> -- <paths>`) rather than a new port method. Slice 07 (light path) also adds commits-per-path to the git port; whichever lands second should reuse one of them.
- Only `resolve` takes `base_side` in the shipped workflows, as the spec asks; `sync-resolve` (the first sync's resolver) was left as is — a candidate for later.
- No commit cap per path: every base commit since the merge base that touched the path is listed, as AC1 says.
- If git fails while gathering (e.g. base sha missing locally), `norn brief` fails rather than hiding it; the base sha is the fetched base tip, so this should not happen.

### Resume

Nothing left in this step: next is the slice's review.
