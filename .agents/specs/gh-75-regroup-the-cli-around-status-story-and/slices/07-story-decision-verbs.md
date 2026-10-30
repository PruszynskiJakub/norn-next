---
id: gh-75/07
title: story answer, approve, reject and update-branch
depends_on: [ gh-75/03 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
---

## Goal
The decisions a person makes on a story live under it: `story answer`, `story approve`, `story reject --reason`, `story update-branch`. `answer`, `approve` (and `approve --reject`) and `update` are gone.

## Scope
Behaviour: B5 (for `answer`, `approve`, `update`), B24, B25, B26, B27, B55 (update-branch), B57 (on approve). Seams: S1. Out: printed commands that still name `norn approve …` (slice 14).

## Acceptance
- AC1 (B24) Given gh-N parked on a question, when `norn story answer gh-N "Use the v2 API"` is typed, then the answer is delivered and recorded exactly as `norn answer` did (receipt, typing, mailbox path unchanged). — verifier: test
- AC2 (B25) Given gh-N at the ready gate, when `norn story approve gh-N` is typed, then the approve receipt is written and the next tick moves on. — verifier: test
- AC3 (B26) `norn story reject gh-N --reason "misses B4"` writes the reject receipt with that comment and the next tick routes as reject; without `--reason` → usage error (exit 2), do_instead "pass --reason". — verifier: test
- AC4 (B27) Given gh-N done with an unmerged PR held here, `norn story update-branch gh-N` re-enters the base update step; a story not in a BS9 state is refused with the same do_instead as `norn update` gave. — verifier: test
- AC5 (B55) In a slice worktree of gh-N, `norn story update-branch` acts on gh-N; `norn story approve` acts on the slice. — verifier: test
- AC6 (B57, B59) In the main checkout, interactive, with gh-N and gh-M at gates and gh-K parked on a question, `norn story approve` offers gh-N and gh-M only; with nothing at a gate it is refused "Nothing waits at a gate". `story answer` offers only units parked on a question; `story reject` only units at a gate. — verifier: test
- AC7 (B5) `norn answer`, `norn approve`, `norn update` are usage errors (exit 2) "Unknown command: …"; nothing is written. — verifier: test
- AC8 (B25, B26) In a throwaway repo with a unit at a gate, `story approve` and `story reject --reason` behave at the terminal as the old commands did. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
Old tests move with their assertions (human.test.ts). The cockpit's internal verb calls for approve/answer follow here.
