## Goal

Add a short `REVIEW.md` at the repo root (what to skip, what counts as a failure, how to write a finding) and give `.github/pull_request_template.md` **Risk** and **How to revert** sections.

## Progress

- `REVIEW.md` written: skips `packages/schema/json/`, `packages/core/test/golden/`, `test/e2e/transcripts/`, `test/e2e/observe-snapshots/`, `runs/`; failures are a persisted format breaking old records, a claim or lease race, a non-atomic write (S1, with P6/S5), core reaching for IO; no style nits, every finding cites file and line.
- Deviation: the issue says "Biome owns style", but the repo has no Biome (no config, no dependency). REVIEW.md says the type check and the repo lints in the unit tier own style instead, so it does not name a tool that is not there. Adjust if Biome is meant to arrive.
- PR template: added `## Risk` and `## How to revert` after `## Tested`, before `Closes #`.
- Docs-only change: no new test. `bun run test` (1258 pass) and `bun run typecheck` green.
- Friction: the worktree had no `node_modules`; `bun run test` failed 64 tests and `tsc` was missing until `bun install`.
- implement#1 done: Added REVIEW.md (skip list, failure kinds citing S1/P6/S5, finding format) and Risk / How to revert to the PR template. Style line names the type check and repo lints instead of Biome, which the repo does not have. Unit tier and typecheck green.
- review#1: approve. Traceability (docs-only; checked by reading the diff, no test expected):

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 REVIEW.md skip list (5 paths) | agent | QA (agent): `REVIEW.md` § Skip, all paths exist |
| W2 failure kinds (format, race, S1, core IO) | agent | QA (agent): `REVIEW.md` § What counts as a failure |
| W3 no style nits; file and line per finding | agent | QA (agent): `REVIEW.md` § How to write a finding (names lints, not Biome: repo has none) |
| W4 PR template Risk and How to revert | agent | QA (agent): `.github/pull_request_template.md` |
- review#1 approve: REVIEW.md and PR template Risk / How to revert meet the spec; no blocking findings. Minor: style line names the repo lints, not Biome (absent).

- describe#1: pr.md written (summary with file tree, evidence W1–W4 by reading, two-way door, blast radius none; notes the Biome deviation).
- describe#1 done: pr.md written: summary with file tree, W1–W4 evidence by reading (docs-only), Biome deviation noted, two-way door, blast radius none.

## Resume

Nothing left for describe; pr.md is current.
