---
id: gh-337/12
title: norn status shows overlap between open stories
depends_on: [gh-337/03, gh-337/05, gh-337/06, gh-337/08, gh-337/09, gh-337/10]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
`norn status` shows a Check item when two open stories' heads conflict with each other outside their spec folders, so a person can choose a merge order before it bites.

## Scope
User stories: a Check item naming both stories and the paths; only stories with commits of their own, in flight or finished with an open PR; cached per pair of heads; clears itself, no dismiss, no order; spec-folder-only conflicts don't count. Seams: S1, S3. Out: suggesting a merge order.

## Acceptance
- AC1 Given two open stories whose heads conflict in a file outside their spec folders, then `norn status` shows one Check item naming both stories and the conflicting paths (for example "gh-326 and gh-327 both change ci-check.test.ts; whichever merges second needs a resolve"). — verifier: test
- AC2 Given a story with no commits of its own beyond its base, or with neither a unit in flight nor a finished round with an open PR, then it is never compared and raises nothing. — verifier: test
- AC3 Given neither story's head moved since the last tick, then the pair is not computed again. — verifier: test
- AC4 Given one of the stories lands, or the heads stop conflicting, then the item disappears on its own; the item offers no dismiss and suggests no merge order. — verifier: test
- AC5 Given the two stories conflict only inside their own spec folders, then no item is shown. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` (the overlap cache schema)

## Notes
D12. Starts after the last slices of changes 1–5 (03, 05, 06, 08, 09, 10), the order the person asked for. The cache is `overlap.json` in the machine dir beside `base.json`; the item id is `overlap:<a>:<b>`.
