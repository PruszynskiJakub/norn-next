---
id: gh-301/06
title: Hooks refuse file-tool writes under run state
depends_on: [ gh-301/01, gh-301/02 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
In any unit step, a file-tool write whose path resolves under the checkout's run state folder is refused with the reason that a hand-edited file makes the unit `corrupt`; reads and shell commands are not inspected.

## Scope
User stories: file-tool writes under run state refused, reads and shell not inspected. Seams: S2 (the resolved path given as input), S3 (path resolution for real). Decisions D8, D12. Out: shell commands of any kind (gh-301/05).

## Acceptance
- AC1 Given a unit step, attended or not, when a file tool writes a path that resolves under the checkout's whole `runs/` folder in the machine dir (this unit's state or another unit's), then the call is denied with the reason that a hand-edited file fails validation and makes the unit `corrupt`. — verifier: test
- AC2 Given a write given as a relative path, or through a symlink, or to a file that does not exist yet, when `norn hook` resolves it through the cli harness (relative to the payload's cwd, the nearest existing parent through realpath), then a path landing under run state is denied and one landing elsewhere is allowed. — verifier: test
- AC3 Given a unit step, when a file tool reads under run state, or a shell command writes there, then the call is allowed; and a write elsewhere in the worktree is allowed. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
No edge on gh-301/05: both add a deny case to the core hook-answer function and are merged in either order. Keep the realpath bounded to file-write tool calls (Risks: hook latency).
