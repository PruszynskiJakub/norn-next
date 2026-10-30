---
id: gh-117
slug: committing-runs-to-the-unit-branch-makes
provider: gh
number: 117
url: https://github.com/PruszynskiJakub/norn-next/issues/117
title: Committing runs/ to the unit branch makes norn's own files most of every PR and lets a rebase rewind live state
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-30T14:53:06.828Z
body_hash: b9b310fc9aba9af7a981c82de203aec0bbc3297cad1dfa27c88a77c9e36d8a2f
---

## Observed

S8 commits `runs/<unit>/` (receipts, state.json, pinned workflow.yaml, check logs, QA evidence) to the unit branch at every step boundary, and S10 only hides it in the diff view. It still counts in the PR's file and line totals, gets reviewed and checked out with the branch, and lands on main in the squash commit (GR6 keeps it there as the record).

Measured on the #106 squash commit (2d43e08): 39.7k changed lines, 1,473 files.

| part | lines | files |
|---|---|---|
| `.agents/specs/gh-75…/runs/` | 32,415 | 1,269 |
| ↳ receipts and state.json | ~9.6k | 378 |
| ↳ QA evidence (`AC*.md`, `out-*.txt`, `.log`, `.sample`, `.ts`, `.json`) | ~17k | ~600 |
| ↳ check logs, handoffs, workflow.yaml, other | ~5.8k | ~290 |
| real code (`packages/*`) | ~7.3k | ~170 |

#108's table understates this: it counted through `gh pr view --json files`, which returns only the first 100 files (it shows #106 at 2,276 lines under runs/).

Because runs/ lives in the branch's history, git operations on the branch act on norn's live state:
- #101, #97, #79: a rebase in a unit worktree rewinds state.json and receipts under a live unit; a tick then acts on the rewound files and leaves stray receipts that make the unit corrupt (S2).
- #92: the boundary commit stages the whole worktree, mixing agent work and norn state in one commit.
- T7a, `orphaned/`: runs/ work that exists locally but not on the remote branch needs its own Check item and tidy path.

## Wanted

norn's machine state stops travelling in the story's PR and in the branch history that agents and git commands rewrite, while keeping what it gives today:

- The record survives: shared between machines on takeover (T5), readable after merge for `norn-retro`, `run list`, `run view --why`.
- Atomic, validated, receipts before effects, state last (S1, S2, P6, S5).
- A PR's diff and totals show the work, plus at most a small human-facing summary (handoff.md, spec).

The option to weigh first: a norn ref per story, e.g. `refs/norn/runs/<story-id>`, with its own commit history (the claim and mailbox refs are the precedent, T2, T9), pushed at step boundaries alongside or instead of the branch, and kept after merge as the record. Things to settle:

- Where the files live in the worktree (gitignored, or a separate worktree on the ref) and how observe and store read them.
- What stays on the branch: handoff.md? the spec? a final record written once at merge?
- QA evidence: on the ref, or only links in the PR body (#96).
- Migration: units in flight and the runs/ already on main stay readable.
- Interaction with #71's rounds (layout under `runs/<unit>/` is left to its plan) — decide this first, or fold it into that plan.

If runs/ moves off the branch, #108 (one-line JSON) is no longer needed for the PR diff, and #101/#97's class of bug can't happen.

## Where

- `packages/adapters/src/git/index.ts:352`: boundary commit, `git add -A`
- `packages/store/src/refs.ts`: claim and mailbox refs (precedent for a norn ref)
- `packages/store/src/receipts.ts`, `packages/store/src/unit.ts`, `packages/store/src/paths.ts`: runs/ writes and paths
- `packages/core/src/decide/story.ts:260`: the gh-79 hold while a rebase is in progress
- `.gitattributes`: `runs/**` linguist-generated (S10)

## PRD

§7 layout (`runs/<unit>/` committed), S3, S8, S10, GR4, GR6 (spec folder with runs/ stays on base as the record), T5, T7a, T9, BS4, §20 risk row "Committed `runs/` noise in PR diff". Related: #108, #101, #97, #79, #92, #96, #71.
