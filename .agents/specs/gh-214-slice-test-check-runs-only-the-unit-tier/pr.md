## Summary

The slice workflow's `test` check no longer runs the integration tier. It now runs only the unit tier and the type check. The integration tier still runs in the story's `test` check (once every slice is integrated, before qa) and in CI. Slice rounds get shorter, and slices running in parallel put less load on the machine.

```diff
 slice.test.run:
-  bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck
+  bun install --frozen-lockfile && bun run test && bun run typecheck
 story.test.run:            (unchanged: unit → integration → typecheck)
 CI:                        (unchanged: every tier)
```

## Evidence

- **Slice `test.run` is unit + type check only**
  **Before:** `.agents/workflows/slice.yaml` ran `… && bun run test:integration && …`.
  **After:** `test/repo/repo.test.ts` › AC2 asserts `slice.test.run == "bun install --frozen-lockfile && bun run test && bun run typecheck"`, timeout `15m`. It was written first and failed against the old workflow; it passes now (`bun run test`: 1257 pass, `bun run typecheck` green).
- **Story `test` check keeps the integration tier**
  **Before:** unit → integration → typecheck.
  **After:** the same AC2 test asserts that `quick` and `story` still run `… && bun run test:integration && …`. Passes.
- **Slice implement instructions say where the integration tier runs**
  **Before:** "the integration tier runs in the `test` check".
  **After:** "this slice's `test` check runs only those two: the integration tier runs in the story's `test` check, once every slice is integrated". AC3 in `test/repo/repo.test.ts` asserts the slice wording `integration tier runs in the story's \`test\` check`. Passes.
- **AGENTS.md says the slice check skips integration**
  **After:** Commands now says "(a slice's runs only the unit tier and the type check: the integration tier waits for the story's `test` check, after every slice is integrated)". Not checked by a test. A person checks it by reading the diff.
- **Shipped `packages/cli/assets/workflows/slice.yaml`**
  Left unchanged on purpose: it already runs only `bun test` (the unit tier), so it already matches.

No QA run took place for this change. The evidence above is the unit tier and the review.

## Merge danger

**Door:** two-way: a revert puts the integration tier back into the slice check. Running units keep their pinned workflow (S7).

**Blast radius:** norn's own slices: an integration break caused by a slice now shows up only at the story's `test` check, and it goes to the story's implement step instead of the slice that caused it (the tradeoff the spec accepts). CI and the story check still catch it before merge.
