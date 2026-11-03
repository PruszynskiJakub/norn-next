## Summary

AGENTS.md now states the commit rule, points test writers at `test/support/`, and gains a Gotchas section, so agents stop committing with a red lint and stop repeating known mistakes. Docs only.

```text
AGENTS.md
  ## Commands
    + **Commit only when `bun run test` and `bun run typecheck` are green.**  # no `bun run lint`; names where each lint lives
    + **Before writing a test, read `test/support/`.**                        # harness fakes, ref-name helpers, schema shapes
  + ## Gotchas                                                               # zsh word-splitting, toMatchObject, norn done path, wait patterns
```

## Evidence

- **Commit rule** — commit only when `bun run test` and `bun run typecheck` are green; the lints run inside `bun run test`
  **Before:** implicit; agents committed twice with the path-spelling lint red.
  **After:** stated at the end of Commands, naming each lint's file (`test/repo/repo.test.ts`, `test/repo/docs.test.ts`, `packages/core/test/unit/printed-commands.test.ts`). Review checked every cited path exists.
- **Gotchas section** — the four items from the issue
  **Before:** did not exist.
  **After:** `## Gotchas` at the end of AGENTS.md with zsh word-splitting, Bun's `toMatchObject` mutation, running `norn done` from a path that will still exist, and anchoring wait patterns to a full status token.
- **Test-helper pointer** — `test/support/` and the harness fakes
  **Before:** not named as the first thing to read.
  **After:** names `test/support/harness.ts` (`createHarness`, `FakeRemote`, `FakeRunner`, `FakeNotifier`, `FakeInteraction`), the other helpers, `claimRef`/`mailboxPrefix`/`mailboxRef` in `packages/schema/src/ids.ts`, and `@norn/schema` shapes via `assertValid`. Review verified each named export exists.

`bun run test` (1103 pass, including the docs and glossary lints over AGENTS.md) and `bun run typecheck` are green on the branch. #133's restructure has not landed, so the text goes into AGENTS.md itself, as the issue allows.

## Merge danger

**Door:** two-way: a revert removes the paragraphs completely.

**Blast radius:** none: only agents reading AGENTS.md see it; no code or behaviour changes.
