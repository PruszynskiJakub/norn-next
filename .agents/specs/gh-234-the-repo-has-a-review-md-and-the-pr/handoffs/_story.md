## Goal

Add a short `REVIEW.md` at the repo root (what to skip, what counts as a failure, how to write a finding) and give `.github/pull_request_template.md` **Risk** and **How to revert** sections.

## Progress

- `REVIEW.md` written: skips `packages/schema/json/`, `packages/core/test/golden/`, `test/e2e/transcripts/`, `test/e2e/observe-snapshots/`, `runs/`; failures are a persisted format breaking old records, a claim or lease race, a non-atomic write (S1, with P6/S5), core reaching for IO; no style nits, every finding cites file and line.
- Deviation: the issue says "Biome owns style", but the repo has no Biome (no config, no dependency). REVIEW.md says the type check and the repo lints in the unit tier own style instead, so it does not name a tool that is not there. Adjust if Biome is meant to arrive.
- PR template: added `## Risk` and `## How to revert` after `## Tested`, before `Closes #`.
- Docs-only change: no new test. `bun run test` (1258 pass) and `bun run typecheck` green.
- Friction: the worktree had no `node_modules`; `bun run test` failed 64 tests and `tsc` was missing until `bun install`.
- implement#1 done: Added REVIEW.md (skip list, failure kinds citing S1/P6/S5, finding format) and Risk / How to revert to the PR template. Style line names the type check and repo lints instead of Biome, which the repo does not have. Unit tier and typecheck green.

## Resume

Nothing left for implement; next is review of the diff.
