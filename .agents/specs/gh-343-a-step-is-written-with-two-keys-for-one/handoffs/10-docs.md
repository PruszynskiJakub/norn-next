### Goal
The docs teach only the new step wording (head keys, `skills:`, `by:`, `outcomes:` with sibling `means:`/`verdict:`), the shallow `like` rule for `means:`, and `norn upgrade` for old files.

### Proof
- AC1 docs show the new wording and the upgrade path (agent): docs/concepts.md (step kinds table, outcomes paragraph, Skills, glossary) and docs/recipes.md (Write your own workflow, shared-file and `like:` examples, new "Name your own skill in a step") rewritten. The old wording shows only where it explains the upgrade (concepts outcomes paragraph, recipes step 2). A grep for old keys in docs/ finds only those two places plus a GitHub Actions `run:` in the CI recipe, which is not a norn step.
- AC2 generated reference up to date, glossary lint passes (test): `bun run docs:emit` leaves the tree clean; `bun run test` green (2051 pass, 0 fail, lints included); `bun run typecheck` green.

### Easy to miss
`like` copies merge shallowly: writing `means:` replaces the whole map. Never edit CHANGELOG.md.

### Not proven yet
Nothing for this slice; integration and e2e tiers run in CI.

### Notes
implement#1 could not run the checks because the worktree had no `node_modules`; `bun install` fixed it. Friction: a fresh unit worktree has no installed dependencies, so the first check run fails at import.

### Resume
Nothing left in implement; the next step reviews the docs diff against AC1.
