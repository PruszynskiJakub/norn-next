---
id: gh-195/12
title: Mailbox from a non-holder, and rejected receipts shown on the holder
depends_on: [gh-195/11]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
Answering or approving from a machine that does not hold the story stamps the receipt from the last boundary (`local`) or the ref (`remote`) and says the holder checks it; on the holder, a receipt that no longer matches shows as a Check item that clears on its own.

## Scope
Behaviour: B20, B21. Seams: S1. Out: answers typed by the holder (unchanged, R6.3).

## Acceptance
- AC1 (B20) Given gh-9 under `local` held by A, last boundary refine, when `norn story answer gh-9 "use option b"` runs on B, then the mailbox ref is posted with step refine and no attempt, and the reply says "sent to <holder>; the holder checks it against the step it is at (last boundary: refine)"; `story approve` behaves the same. — verifier: test
- AC2 (B20) Given gh-9 under `remote`, when B answers, then the receipt is stamped with the step and attempt from the fetched ref. — verifier: test
- AC3 (B21) Given an answer stamped for refine that reaches A after gh-9 moved to plan, when A ticks, then A rejects it (and the trace says so) and `norn status` on A shows a Check item "answer from <sender> for gh-9 was rejected: gh-9 is at plan now". — verifier: test
- AC4 (B21) Given that Check item, when a later answer or approval for gh-9 is accepted, or gh-9 finishes, then the item is gone; there is no dismiss command. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D12: the rejected receipt is kept machine-local next to the notices. Prior art: the `human` cli test (mailbox from another machine).
