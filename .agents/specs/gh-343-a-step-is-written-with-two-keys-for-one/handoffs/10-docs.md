### Goal
The docs teach only the new step wording (head keys, `skills:`, `by:`, `outcomes:` with sibling `means:`/`verdict:`), the shallow `like` rule for `means:`, and `norn upgrade` for old files.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | concepts, recipes and reference show steps by head key, `skills:`, `by:`, `outcomes:` with sibling `means:`/`verdict:`, the shallow `like` rule for `means:`, and `norn upgrade` for old files; old wording only where the upgrade is explained | agent | QA (agent); review read docs/concepts.md and docs/recipes.md against packages/schema/src/workflow.ts (verbs, `by:`), packages/store/src/step-wording.ts (load refusals), packages/core/src/workflow.ts (`unknown_skill` per agent) and packages/core/src/brief.ts (skills line): all match |
| AC2 | generated reference up to date, glossary lint passes | test | `packages/cli/test/unit/reference.test.ts` › "docs/reference.md is up to date (bun run docs:emit)"; `test/repo/repo.test.ts` › "no banned synonyms in sources, assets, plugin, JSON schemas and every doc" (test#1 pass) |
| the docs show the new wording (user story) | covered by AC1 and AC2 | agent/test | as above |

### Easy to miss
`like` copies merge shallowly: writing `means:` replaces the whole map. Never edit CHANGELOG.md.

### Not proven yet
Nothing for this slice; integration and e2e tiers run in CI.

### Notes
implement#1 could not run the checks because the worktree had no `node_modules`; `bun install` fixed it. Friction: a fresh unit worktree has no installed dependencies, so the first check run fails at import.

### Resume
Review approved with no findings; next is QA of AC1 (agent) against the docs.
