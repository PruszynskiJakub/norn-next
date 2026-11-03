---
id: gh-176
slug: agents-md-state-the-commit-rule-add
provider: gh
number: 176
url: https://github.com/PruszynskiJakub/norn-next/issues/176
title: "AGENTS.md: state the commit rule, add gotchas, point at the test helpers"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-03T10:52:49.621Z
body_hash: 26e60af887b82e05ad489fdc027ce5b98fe71de8fcd8e18e39c228033502eea8
---

## Observed

AGENTS.md leaves out several things that cost agents retries in this repo:

- **The commit rule is implicit.** The lints (path spelling, glossary, printed commands) run inside the unit tier (`test/repo/repo.test.ts`, `packages/core/test/unit/printed-commands.test.ts`). There is no `bun run lint`. Agents committed twice with the path-spelling lint red.
- **No gotchas section.**
  - zsh does not word-split unquoted variables (bulk branch deletion failed).
  - Bun's `toMatchObject` can mutate the value it matches.
  - Run `norn done` from a path that will still exist.
  - Wait patterns must match a full status token, not a bare "done".
- **No pointer to the test helpers.** `test/support/` and the harness fakes (ref prefixes, state shapes) aren't named as the first thing to read before writing a test.

## Wanted

AGENTS.md says:

- Commit only when `bun run test` and `bun run typecheck` are green, and the lints run inside `bun run test`.
- A short Gotchas section with the items above.
- A pointer to `test/support/` and the harness fakes for anyone writing a test.

If #133's AGENTS.md restructure lands first, these go into its detail documents.

## Where

- `AGENTS.md`

Related: #133.
