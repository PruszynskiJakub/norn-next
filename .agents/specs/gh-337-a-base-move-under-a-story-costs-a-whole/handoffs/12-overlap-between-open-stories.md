## Goal
`norn status` shows one Check item (`overlap:<a>:<b>`) when two open stories' heads conflict with each other outside their spec folders, naming both stories and the paths; it clears on its own and suggests no merge order (D12).

## Proof
- AC1, two open stories conflicting outside their spec folders show one Check item naming both and the paths: `packages/core/test/unit/overlap.test.ts` › "two stories whose heads conflict outside their spec folders: one Check item naming both and the paths" (S1); on real git through observe and the view: `packages/cli/test/integration/overlap.test.ts` › "one Check item names both stories and the path; the pair is cached per pair of heads" (S3).
- AC2, a story with no own commits, or neither in flight nor finished with an open PR, is never compared: `overlap.test.ts` (core) › the `overlapEligible` tests and "an ineligible story raises nothing even when an overlap names it"; `packages/cli/test/unit/overlap-cache.test.ts` › "stories without commits of their own … are never compared"; the S3 test also shows no item for two parked stories with no commits.
- AC3, neither head moved since the last tick so the pair is not computed again: the S3 integration test (`packages/cli/test/integration/overlap.test.ts`). It seeds `overlap.json` with a marker path for the current heads, ticks, and the marker survives and shows in `norn status`. When one head moves, the pair is merged again. A mutation check (observe passing `[]` instead of `local.overlap`) makes it fail. Also `overlap-cache.test.ts` › "neither head moved since the last tick: the pair is not merged again".
- AC4, the item clears when a story lands or the heads stop conflicting, with no dismiss and no merge order: `overlap.test.ts` (core) › "the item clears itself …" and "the item offers no dismiss and suggests no merge order"; the S3 test shows the item gone once the moved head stops conflicting.
- AC5, conflicts only inside the two stories' spec folders show no item: `overlap.test.ts` (core) › "conflicts only inside the two stories' own spec folders: no item".
- `overlap.json` schema round trip: `packages/store/test/unit/local-json.test.ts` › "overlap.json: the pairs written read back; a wrong shape reads as empty".
- `bun run test` (1879 pass) and `bun run typecheck` green; `bun run test:integration packages/cli/test/integration/overlap.test.ts` passes locally.

## Easy to miss
- Eligibility (`overlapEligible` in `packages/core/src/overlap.ts`) is checked twice: observe uses it to pick the pairs it merges, and `buildInbox` uses it again, so a cached pair whose story has since landed or lost its open PR raises nothing even before the next tick rewrites the cache.
- The cache keeps clean pairs too (paths `[]`), so a clean pair is not merged again either. Spec-folder paths are dropped in the inbox, not in the cache.
- Facts `overlaps` is set only when non-empty, so single-story golden cases and observe snapshots don't change.

## Not proven yet
- Review finding F2 (minor, a note only, not fixed by direction): the item's `since` is `facts.now`, so its age resets every tick (`packages/core/src/overlap.ts`). A first-seen time in the cache entry would fix it.

## Notes
- Seams: S1 (`buildInbox` with scripted Facts) for AC1, AC2, AC4, AC5; S3 (`createHarness` on real git, `norn status --json` plus `overlap.json`) for AC3 and the observe/view wiring.
- Wiring: `StoryOverlap` + `Facts.overlaps` (core facts.ts); `LocalOverlapFile` id `local-overlap` (schema local.ts, validate.ts); `readOverlapFacts`/`writeOverlapFacts` + `overlapFactsPath` (store); `loadLocalFacts().overlap`; observe computes after `writeBaseFacts`; the view feeds `overlap.json` into its Facts, so `norn status` shows the item without running git.
- The S3 test uses a one-gate `held` workflow so both stories park in flight; it commits `shared.txt` in each story worktree. `norn status --json` returns `{ groups: { <group>: Item[] } }`.
- The item's command is `norn story view <second story>`: nothing resolves it, since it only informs.
- Friction: an accidental `git checkout -p` without input did nothing; interactive git commands silently no-op here.

## Resume
Rework done; next is the review step. If review asks for F2, add a first-seen time to the `overlap.json` pair entry and use it as the item's `since`.
