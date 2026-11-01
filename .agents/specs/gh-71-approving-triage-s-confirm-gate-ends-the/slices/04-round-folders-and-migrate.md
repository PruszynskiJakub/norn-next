---
id: gh-71/04
title: The story record lives in round folders, and flat records move there
depends_on: [ gh-71/01, gh-71/03 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: agent }
---

## Goal
A story's state, pinned workflow, receipts, logs and evidence live in `runs/_story/rounds/01-<workflow>/`, with one shared `handoff.md` above it. A story already in progress with a flat record is moved there by its holder's first tick in one commit and goes on where it was; old flat records on the base stay readable as round 1.

## Scope
Behaviour: B30 (one round), B31, B34, B36. Seams: S1, S2. Decisions D2 (record folder field, optional `round`/`ended` in state, story facts `rounds`), D7 (`round.migrate`). Out: a second round (06), finished-round behaviour (05), showing the round (10).

## Acceptance
- AC1 (B30) Given a new story, when its first step starts and reports, then its state, pinned `workflow.yaml`, receipts numbered from 0001, logs and evidence are under `runs/_story/rounds/01-<workflow>/`, and nothing but `handoff.md` and `rounds/` is directly under `runs/_story/`. — verifier: test
- AC2 (B31) Given a story in round 1, when the handoff is written, then it is `runs/_story/handoff.md`, and its Goal / Progress / Resume survive the step's report. — verifier: test
- AC3 (B34) Given a story held by this checkout with a flat record (state at `implement`, receipts, logs, evidence directly under `runs/_story/`), when a tick runs, then the first action is `round.migrate`, which moves everything but `handoff.md` into `rounds/01-<workflow>/` with `git mv` in one commit on the story branch and pushes it; the story goes on at `implement`, round 1, counters unchanged, and the paths its receipts carry still resolve. Slice folders are untouched. — verifier: test
- AC4 (B34) Given a flat story during a rebase, or one this heartbeat does not hold, when decide runs, then `round.migrate` is not emitted; given a held flat story, it comes before any receipt or other rule. `round.migrate` has a rule case. — verifier: test
- AC5 (B36) Given a story merged into the base before this ships, with a flat record, when `run list` and `run view` read it, then they show it as round 1, and nothing is written to the base or to the record. — verifier: test
- AC6 (B30, B34) Given the e2e effect transcripts, observe snapshots, brief snapshot and view fixtures, when they are regenerated for the new layout, then the only differences are the moved record paths (and the migrate commit where a flat fixture is used), and every tier passes. — verifier: test
- AC7 (B34) Given a throwaway repo with a story started by the released norn and parked at a step, when the build of this branch ticks it, then `git log` shows one move commit, the record sits in `rounds/01-<workflow>/`, and `status` shows the story at the same step. — verifier: agent

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run typecheck`
- `bun run schema:emit && git diff --exit-code packages/schema/json`

## Notes
D2: the story keeps `dir: "_story"`; only the resolver from 01 learns the round folder (the highest-numbered `rounds/NN-*`). The `unit_dir` pattern in state is unchanged. Risk from the plan: a missed reader sees an empty folder and treats the story as not started; the regenerated transcripts show every moved path — review them. Only the claim holder migrates (T7); a clone without the claim reads the flat record as round 1 until it fetches. This is the wide slice of the story; if it does not fit one context window, a person may split migration (AC3, AC4, AC7) into its own slice, but the layout switch and the migration must land together, or live stories break.
