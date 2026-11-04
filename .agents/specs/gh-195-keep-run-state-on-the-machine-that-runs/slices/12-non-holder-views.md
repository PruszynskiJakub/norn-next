---
id: gh-195/12
title: Other machines see a story from its ref or its branch
depends_on: [gh-195/03, gh-195/08]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
On a machine that does not hold a story, `story view` and `status` show step, attempt and counters from the story's ref under `remote`, labelled with its age once it is no longer kept current, and under `local` show the claim, the branch, the last boundary step, the PR and CI, and where the record is.

## Scope
Behaviour: B10 (the other clone's view), B13, B17, B18, B19, B30 (the tick's fetch). Seams: S1. Out: the mailbox (gh-195/13), finished stories (gh-195/16).

## Acceptance
- AC1 (B17, B10) Given gh-9 under `remote` held by clone A, when A finishes implement and clone B ticks, then `norn story view gh-9` and `norn status` on B show "Step: review (attempt 1)" and the counters, read from `refs/norn/runs/gh-9`. — verifier: test
- AC2 (B13) Given the team switched `remote` → `local` after gh-9's ref was pushed, when B views gh-9, then it shows the ref's step and attempt under "record as of <ref commit time> — gh-9 now keeps its record on <holder>'s machine". — verifier: test
- AC3 (B18) Given gh-9 under `local` held by A with a boundary commit for implement and a PR with CI, when B views it, then it shows the holder, heartbeat and expiry, the branch's last commit, "last boundary: implement", the PR and CI, and "run state is on <holder>'s machine — ask them to run norn story handoff gh-9, or take it over after the claim expires (<expiry>)", and no attempt or counters. — verifier: test
- AC4 (B19) Given gh-9 under `local` whose branch has no boundary commit yet, when B views it, then it shows "no boundary pushed yet" where the last step would be. — verifier: test
- AC5 (B30) Given open stories gh-9 (held by A) and gh-10 (held by B), and a closed gh-4 with a ref, when B ticks, then B's local refs hold `refs/norn/runs/gh-9` only; `story view` and `status` run no fetch (they read the local ref, unpacked once per record commit into a cache in the machine dir). — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D6. The view (`loadProjectView`) never touches the network; observe and the view must agree (the observe snapshots' inbox parity check). The cache key is the record commit.
