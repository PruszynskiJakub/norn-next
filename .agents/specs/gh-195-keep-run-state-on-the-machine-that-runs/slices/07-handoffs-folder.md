---
id: gh-195/07
title: Handoffs move to handoffs/<unit>.md, prose only
depends_on: [gh-195/02, gh-195/05, gh-195/06]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
---

## Goal
Each unit's handoff is `<spec folder>/handoffs/_story.md` or `handoffs/<nn>-<slug>.md`, on that unit's branch, holding only Goal, Progress and Resume; the status it used to carry is printed by `brief` and `story checkout`. With this, no branch and no PR carries a `runs/` path.

## Scope
Behaviour: B1, B6, B7, B8, B39. Seams: S1, S2. Out: run state (gh-195/05, gh-195/06), PR evidence (gh-195/15).

## Acceptance
- AC1 (B39) Given gh-9 with slice `01-parser`, when both run a step, then `handoffs/_story.md` is on the story branch and `handoffs/01-parser.md` on the slice branch (reaching the story branch with the slice's integration), and the story's handoff stays one file across rounds. — verifier: test
- AC2 (B6) Given a boundary where the agent did not edit its handoff, when the commit lands, then the handoff is not in it; and the file never holds a generated status header or heartbeat lines. — verifier: test
- AC3 (B7) Given gh-9 at review attempt 2, when `norn brief` and `norn story checkout gh-9` run, then each prints "Step: review (attempt 2)", the counters and the last outcome above the handoff's written part. — verifier: test
- AC4 (B8) Given a handoff from an older norn with `norn:header` and `norn:heartbeat` blocks, when the unit's first boundary commit lands, then both blocks are gone and Goal, Progress and Resume are as written. — verifier: test
- AC5 (B39, B34) Given an open story with `runs/<unit>/handoff.md` on its branch, when its first tick moves the record, then the handoff is at `handoffs/<unit>.md` with the generated blocks stripped and its prose unchanged, in the same "move … run state off the branch" commit. — verifier: test
- AC6 (B1) Given the slice-workflow e2e story driven to its PR, when the PR's changed files and every branch tree are listed, then they hold the code, the spec, `pr.md` and the handoffs, and no `runs/` path. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run test:e2e`

## Notes
D9, D13 step 2. `renderHandoffStatus` stays and renders from `state.json`. The bundled norn skill and the brief tell agents the new path: edit `packages/cli/assets/skills/`, never the `.agents/skills/norn*` copies. Transcripts and snapshots are rewritten again here; review the diff as the handoff move only.
