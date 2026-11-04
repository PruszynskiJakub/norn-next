---
id: gh-195/10
title: Takeover with no record restarts from the branch
depends_on: [gh-195/09]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
When a holder left no record (claim expired or `--force`, no ref), `story checkout` starts a new round at the last boundary's step from the branch, with fresh counters, says the record was lost, and the brief tells the agent to check what is already done. A wiped machine dir on the holder recovers the same way.

## Scope
Behaviour: B25, B26. Seams: S1. Out: setting the old holder's copy aside (gh-195/13).

## Acceptance
- AC1 (B25) Given clone A holding gh-9 at implement under `local` with boundary commits on the branch and no ref, and A's claim expired, when `norn story checkout gh-9` runs on B, then it prints "the run record of gh-9 was on <holder> and is lost; restarting implement from the branch", starts a new round of the frontmatter's workflow pinned fresh from the branch, at the last `Norn-Step` trailer's step, attempt 1 and counters at zero, and `run list` shows the new round. — verifier: test
- AC2 (B25) The `take` receipt of AC1 carries `record_lost: true` (false on a takeover from a ref; the receipt schema and its JSON schema updated, R10.1), and the next brief tells the agent the record was lost and to check the branch for what is already done before it starts. — verifier: test
- AC3 (B25) Given no boundary commit on the branch at all, when the same checkout runs, then the round starts at the workflow's first step. — verifier: test
- AC4 (B26) Given clone A holding gh-9 whose `~/.norn` is deleted, when A's next tick runs, then it no longer treats the claim as its own; `norn story checkout gh-9 --force` on A takes it as AC1 when there is no ref, and as gh-195/09's takeover when there is one. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run schema:emit && git diff --exit-code packages/schema/json`

## Notes
D10 (no ref branch). Prior art: the `recovery` cli test and the e2e claim-lost transcript, which is rewritten here.
