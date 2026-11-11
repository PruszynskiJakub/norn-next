### Goal
`norn status` shows one Check item (`overlap:<a>:<b>`) when two open stories' heads conflict with each other outside their spec folders, naming both stories and the paths; it clears on its own and suggests no merge order (D12).

### Proof
- AC1 one Check item naming both stories and the conflicting paths — `packages/core/test/unit/overlap.test.ts` › "two stories whose heads conflict outside their spec folders: one Check item naming both and the paths" (red first: module missing).
- AC2 stories without own commits, or neither in flight nor finished with an open PR, never compared — `overlap.test.ts` › the `overlapEligible` tests and "an ineligible story raises nothing even when an overlap names it"; `packages/cli/test/unit/overlap-cache.test.ts` › "stories without commits of their own … are never compared".
- AC3 pair not merged again when neither head moved — `overlap-cache.test.ts` › "neither head moved since the last tick: the pair is not merged again" (seen red with the cache hit disabled).
- AC4 item clears when a story lands or heads stop conflicting; no dismiss, no order — `overlap.test.ts` › "the item clears itself …" and "the item offers no dismiss and suggests no merge order"; cache drop-out in `overlap-cache.test.ts`.
- AC5 spec-folder-only conflicts show nothing — `overlap.test.ts` › "conflicts only inside the two stories' own spec folders: no item".
- `overlap.json` schema round trip — `packages/store/test/unit/local-json.test.ts` › "overlap.json: the pairs written read back; a wrong shape reads as empty".
- `bun run test` (1879 pass), `bun run typecheck` green; `bun run schema:emit` wrote `packages/schema/json/local-overlap.schema.json`.

### Easy to miss
- Eligibility (`overlapEligible` in `packages/core/src/overlap.ts`) is checked twice: observe uses it to pick the pairs it merges, and `buildInbox` uses it again, so a cached pair whose story has since landed or lost its open PR raises nothing even before the next tick rewrites the cache.
- The cache keeps clean pairs too (paths `[]`), so a clean pair is not merged again either. Spec-folder paths are dropped in the inbox, not in the cache.
- Facts `overlaps` is set only when non-empty, so single-story golden cases and observe snapshots don't change.

### Not proven yet
- No S3 harness test on real git for the cache (the plan put row 60 at S3). The cache is tested at the lower `storyOverlaps` seam with a counting fake `mergeTree`; `git merge-tree --name-only` itself is already covered by the git contract (`mergeTree`). The integration and e2e tiers were not run here (they run in CI).

### Notes
- Seams: S1 (`buildInbox` with scripted Facts) for AC1, AC2, AC4, AC5; for AC3, `storyOverlaps` (`packages/cli/src/runtime/observe/git-facts.ts`) was the highest seam that could be checked without the integration tier.
- Wiring: `StoryOverlap` + `Facts.overlaps` (core facts.ts); `LocalOverlapFile` id `local-overlap` (schema local.ts, validate.ts); `readOverlapFacts`/`writeOverlapFacts` + `overlapFactsPath` (store); `loadLocalFacts().overlap`; observe computes after `writeBaseFacts`; the view feeds `overlap.json` into its Facts, so `norn status` shows the item without running git.
- The item's command is `norn story view <second story>`: nothing resolves it, since it only informs.
- Friction: an accidental `git checkout -p` without input did nothing; worth noting that interactive git commands silently no-op here.

### Resume
Implementation done and committed (`d793f9ede`). Next: the slice's test check (`bun run test`, `bun run typecheck`), then review.
