---
id: gh-110/04
title: Machine-local files in ~/.norn/repos/<id>/
depends_on: [ gh-110/01 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: agent }
---

## Goal
The checkout's trace, locks, heartbeat and caches live in `<norn home>/repos/<folder>-<hash8>/`, shared by every unit worktree, never in the working tree or `.git`; `norn doctor` warns about an orphaned one after a repo folder moves.

## Scope
Behaviour: B5, B6. Seams: S1. Out: config and workflow paths (slice 03); moving an existing trace (slice 06).

## Acceptance
- AC1 (B5) Given a fresh repo after `norn init` and a tick, then the trace day file, tick lock, heartbeat and caches are under the norn home's `repos/<folder>-<hash8>/` (hash from the real path of the git common dir), with a `checkout.json` naming the checkout; nothing of them is in the working tree or `.git`, `git status` is clean, and `.gitignore` has no trace line (it keeps `.env.norn` and `.norn-unit`). — verifier: test
- AC2 (B5) Given a unit worktree of that repo, when `norn brief` / a hook / a tick runs from it, then it uses the main checkout's machine dir and writes no machine-local norn file in the worktree; the heartbeat id is the same one (ID2). — verifier: test
- AC3 (B5) Given two clones of one remote on the same machine, then each gets its own machine dir and its own heartbeat id. — verifier: test
- AC4 (B6) Given a user config and machine slot leases in the norn home, then they stay where they were and are read as before; only `repos/` is added. — verifier: test
- AC5 (B5) Given a machine dir whose `checkout.json` names a path with the same folder name that no longer exists, when `norn doctor` runs, then it warns about the orphaned dir and prints the `mv` that adopts it, and moves nothing (D3). — verifier: test
- AC6 (B5) In a throwaway repo, run a tick and confirm the files at the terminal; the headless runner's logs land in the machine dir's `runs/`. — verifier: agent

## Checks
- `bun test packages/store`
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D1, D2, D3, D9, D10. `checkout.json` is a new schema in `@norn/schema` (run `bun run schema:emit`). The trace event for an unreadable machine-local file carries an absolute `file` path (D10). The id is derived, never stored in the repo or git config (D2). This slice and 03 both touch store's path module and init; they may land in either order.
