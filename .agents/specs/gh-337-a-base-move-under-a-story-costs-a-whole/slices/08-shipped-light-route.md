---
id: gh-337/08
title: Shipped workflows take the light route with a resolution review
depends_on: [ gh-337/07 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
---

## Goal
In the shipped story and quick workflows, a base update on the light path costs one test run, at most one short review of only what the resolver changed, and one CI run: update → (resolve) → test → resolution review → open-pr → ci → ready.

## Scope
User stories: shipped story and quick route the light path; the `resolution` step input; a clean merge skips the resolution review; the resolution review's blocking findings go back to resolve; describe runs again only when the merge danger changed. Seams: S1, S2, S3. Out: the carried approval (09).

## Acceptance
- AC1 Given the shipped story and quick workflows (both copies), then `git: update` routes `done` → test, `clean` → a merge test that passes to open-pr, `resolved` → a resolution test that passes to the resolution review, and both of those tests fail to implement; the test command is written once and both copies validate. — verifier: test
- AC2 Given a step with input `resolution`, when its brief renders, then it lists one `git show --remerge-diff <sha>` per merge commit since the last approval, so the reviewer sees exactly what the resolver did, a dropped base change included. — verifier: test
- AC3 Given a light-path update that ended `clean`, then no resolution review runs: the story goes from the merge test to open-pr. — verifier: test
- AC4 Given the resolution review ends `changes_requested`, then the story goes back to `resolve` (counter `resolution_loop`), not to implement. — verifier: test
- AC5 Given the resolution review ends `approve`, then open-pr pushes and keeps the PR body without running describe; given it ends `redescribe`, describe runs again before open-pr. — verifier: test
- AC6 Given the shipped workflow text uses a YAML anchor for the test command, when it is parsed, then both test steps carry the same command. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run docs:emit` (shipped workflows changed)

## Notes
D8, D10 (`resolution`). Change shipped workflows in both copies. The resolution review uses `norn-review` with inputs `[spec, resolution]`.
