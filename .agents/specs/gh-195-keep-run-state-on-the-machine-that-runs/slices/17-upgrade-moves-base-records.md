---
id: gh-195/17
title: norn upgrade moves the base's run state into archive refs
depends_on: [ gh-195/16 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`norn upgrade` in the main checkout packs each finished story's run state on the base into `refs/norn/runs/<story>`, pushes the refs, and stages the removal of run state and of the `runs/**` `.gitattributes` line, committing nothing; `norn init` no longer adds that line.

## Scope
Behaviour: B35, B36, B37. Seams: S1. Out: open stories (gh-195/06).

## Acceptance
- AC1 (B35) Given a base with run state under several spec folders (built with the harness's layout helpers) and a `runs/**` line in `.gitattributes`, when `norn upgrade` runs in the main checkout, then each story's ref is on the remote with the spec folder's `runs/` subtree as its tree, the removal of every run-state path and of the `.gitattributes` line is staged, nothing is committed (LY3), and `norn run list <story>` then reads the ref; once the removal is committed, `norn doctor` and `norn status` no longer point to `norn upgrade` (gh-195/16 AC6). — verifier: test
- AC2 (B35) Given an upgrade interrupted after some refs were pushed, when it reruns, then it pushes only the missing refs, and a run with nothing left says so. — verifier: test
- AC3 (B36) Given a `pre-receive` hook that rejects `refs/norn/runs/gh-4`, when `norn upgrade` runs, then gh-4's run state stays in the tree and unstaged, the other stories' removals are staged, and the output names gh-4 with the reason. — verifier: test
- AC4 (B37) Given a fresh repository, when `norn init` runs, then `.gitattributes` has no norn line (and is not created for norn alone). — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D14: `commit-tree` of each spec folder's `runs/` subtree on the base, no unpacking; one batch push with an "absent" lease per ref. Plan risk: run the migration on a copy of this repository's base before release (a QA task, not a test here). Prior art: the `upgrade` and `round-folders` cli tests. D16: there is no base-tree fallback, so `upgrade` is the only way an older repository's finished stories become readable again.
