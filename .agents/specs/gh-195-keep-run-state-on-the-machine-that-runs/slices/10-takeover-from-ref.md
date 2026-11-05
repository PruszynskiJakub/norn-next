---
id: gh-195/10
title: Takeover unpacks the record from the ref
depends_on: [ gh-195/09 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`norn story checkout` on another machine fetches the story's ref, unpacks it into its machine dir and continues where the story was; a branch that moved ahead is fine, a rewritten branch restarts the step as a new attempt with the reason given.

## Scope
Behaviour: B22, B23, B24, B33 (the checkout half). Seams: S1. Out: no ref at all (gh-195/11).

## Acceptance
- AC1 (B22) Given `norn story handoff gh-9` on clone A at review attempt 2, when `norn story checkout gh-9` runs on clone B, then B holds the claim, has the branches checked out and the record in its machine dir, prints the status and the handoff, and its next tick resumes review at attempt 2 with the same counters. — verifier: test
- AC2 (B23) Given the record matches `abc123` and a commit was pushed on top of the story branch after it, when checkout runs on B, then it unpacks and continues, and the step works on the newer head. — verifier: test
- AC3 (B24) Given the story branch was force-pushed so the record's commit is not an ancestor of its head, when checkout runs on B, then the record is kept, it says "the branch of gh-9 was rewritten since the record (<sha> is gone); restarting review as attempt 3", counters and history stay, and the brief's "Why this attempt" says the same. — verifier: test
- AC4 (B33) Given a story with no branch handed over by A, when checkout runs on B, then it unpacks the record without the ancestry check and continues. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D10 (a ref exists branch), D6 (checkout fetches the one ref it needs). Unpack validates every JSON before renaming into place (S1, S2).

Known limits (review#2 F7): a rewritten story branch restarts only the story unit's step (D10: "the cursor's step"). In a sliced story the story cursor sits at `slices`, so the slices — on their own branches — keep their cursors, and a stuck or `$done` unit gets no notice beyond the take receipt's `rewritten`.
