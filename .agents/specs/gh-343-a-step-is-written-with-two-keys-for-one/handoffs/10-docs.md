### Goal
The docs teach only the new step wording (head keys, `skills:`, `by:`, `outcomes:` with sibling `means:`/`verdict:`), the shallow `like` rule for `means:`, and `norn upgrade` for old files.

### Proof
- AC1 (agent): docs/concepts.md (step kinds table, outcomes paragraph, Skills, glossary) and docs/recipes.md (Write your own workflow, shared-file and `like:` examples, new "Name your own skill in a step") rewritten. The old wording shows only where it explains the upgrade (concepts outcomes paragraph, recipes step 2).
- AC2 (test): `bun run docs:emit` changed nothing in reference.md (no step keys in the generated block). `bun run test` has not passed yet, see below.

### Easy to miss
`like` copies merge shallowly: writing `means:` replaces the whole map. Never edit CHANGELOG.md.

### Not proven yet
`bun run test` and `bun run typecheck` have not run cleanly: dependencies look uninstalled in this worktree (`tsc: command not found`, 86 failing files at import).

### Notes
The session's usage limit hit right after the edits.

### Resume
Run `bun install`, then `bun run test` and `bun run typecheck`; fix any glossary-lint hits in docs/concepts.md and docs/recipes.md; reread both against AC1; then `norn done done`.
