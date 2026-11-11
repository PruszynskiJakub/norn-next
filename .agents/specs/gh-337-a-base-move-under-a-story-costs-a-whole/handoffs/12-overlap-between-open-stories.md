### Goal
`norn status` shows one Check item (`overlap:<a>:<b>`) when two open stories' heads conflict with each other outside their spec folders, naming both stories and the paths; it clears on its own and suggests no merge order (D12).

### Proof
Review #1 traceability (changes requested: F1 blocking, F2 minor; findings in this run's review receipt):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | two open stories conflicting outside their spec folders: one Check item naming both and the paths | test | `packages/core/test/unit/overlap.test.ts` › "two stories whose heads conflict outside their spec folders: one Check item naming both and the paths" (S1, the seam the Plan agreed) |
| AC2 | a story with no own commits, or neither in flight nor finished with an open PR, is never compared | test | `overlap.test.ts` › the `overlapEligible` tests and "an ineligible story raises nothing even when an overlap names it"; `packages/cli/test/unit/overlap-cache.test.ts` › "stories without commits of their own … are never compared" |
| AC3 | neither head moved since the last tick: the pair is not computed again | test | partial: `overlap-cache.test.ts` › "neither head moved since the last tick: the pair is not merged again" uses a fake `mergeTree` below the S3 seam the Plan agreed; observe and view wiring untested (F1) |
| AC4 | the item clears when a story lands or the heads stop conflicting; no dismiss, no merge order | test | `overlap.test.ts` › "the item clears itself when a story lands or the heads stop conflicting" and "the item offers no dismiss and suggests no merge order" |
| AC5 | conflicts only inside the two stories' spec folders show no item | test | `overlap.test.ts` › "conflicts only inside the two stories' own spec folders: no item" |

- `overlap.json` schema round trip: `packages/store/test/unit/local-json.test.ts` › "overlap.json: the pairs written read back; a wrong shape reads as empty".
- `bun run test` (1879 pass) and `bun run typecheck` green at review.

### Easy to miss
- Eligibility (`overlapEligible` in `packages/core/src/overlap.ts`) is checked twice: observe uses it to pick the pairs it merges, and `buildInbox` uses it again, so a cached pair whose story has since landed or lost its open PR raises nothing even before the next tick rewrites the cache.
- The cache keeps clean pairs too (paths `[]`), so a clean pair is not merged again either. Spec-folder paths are dropped in the inbox, not in the cache.
- Facts `overlaps` is set only when non-empty, so single-story golden cases and observe snapshots don't change.

### Not proven yet
- F1 (blocking), the cache per pair of heads (AC3, user story 60): no S3 test on real git with `createHarness`, the seam spec.md:336 agreed. It would prove that observe reads `overlap.json` into `storyOverlaps` and writes it back (`packages/cli/src/runtime/observe/index.ts:111-112`), and that `norn status` shows the item through the view (`packages/view/src/load.ts:626`).
- F2 (minor, a note only): the item's `since` is `facts.now`, so its age resets every tick (`packages/core/src/overlap.ts:322`).

### Notes
- Seams: S1 (`buildInbox` with scripted Facts) for AC1, AC2, AC4, AC5; for AC3, `storyOverlaps` (`packages/cli/src/runtime/observe/git-facts.ts`) was the highest seam that could be checked without the integration tier.
- Wiring: `StoryOverlap` + `Facts.overlaps` (core facts.ts); `LocalOverlapFile` id `local-overlap` (schema local.ts, validate.ts); `readOverlapFacts`/`writeOverlapFacts` + `overlapFactsPath` (store); `loadLocalFacts().overlap`; observe computes after `writeBaseFacts`; the view feeds `overlap.json` into its Facts, so `norn status` shows the item without running git.
- The item's command is `norn story view <second story>`: nothing resolves it, since it only informs.
- Friction: an accidental `git checkout -p` without input did nothing; worth noting that interactive git commands silently no-op here.

### Resume
Rework F1: add an integration test under `packages/cli/test/integration/` (`createHarness`, real git). Two stories in flight change the same file outside their spec folders. A tick, then `norn status --json` shows one `overlap:<a>:<b>` Check item with the path. A tick with neither head moved does not merge the pair again, and moving a head recomputes it. Run it with `bun run test:integration <file>`, then `bun run test` and `bun run typecheck`.
