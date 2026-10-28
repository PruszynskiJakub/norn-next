---
id: gh-75/10
title: story checkout, handoff and close
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
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: agent }
---

## Goal
Moving a story between machines and ending it read as what they do: `story checkout [--force]`, `story handoff`, and `story close` (drop's effects, with confirmation and a claim check). `take`, `release` and `drop` are gone. Take's restore moves into a runtime module (prefactor 3) so slice 11 can reuse it.

## Scope
Behaviour: B5 (for `take`, `release`, `drop`), B33, B34, B35, B36, B37, B38, B39, B55 (handoff, close). Seams: S1 (interaction fake). Out: `story reopen` (slice 11).

## Acceptance
- AC1 (B33) `norn story checkout gh-N` claims the story, checks out its branches into worktrees and prints the handoff, as `norn take` did; another machine's live claim → refused unless `--force`, which takes it over as before (existing team tests move, assertions kept). — verifier: test
- AC2 (B34) `norn story handoff gh-N` pushes the branches and the handoff, then deletes the claim; a second checkout (another harness machine) can `story checkout` it. — verifier: test
- AC3 (B35) `norn story close gh-N --yes` pushes the branches, then removes the worktrees, local branches and the claim; `story.md` on the pushed story branch says `dropped`; the fake remote shows issue #N still open and no PR touched. — verifier: test
- AC4 (B36) Interactive, `norn story close gh-N` asks "Close gh-N? Worktrees for <n> units will be removed [y/N]"; answering N changes nothing and exits 0; y closes as AC3. — verifier: test
- AC5 (B37) `norn story close gh-N` without `--yes` under `--json` or with no TTY → refused (exit 3), do_instead "pass --yes"; nothing changes. — verifier: test
- AC6 (B38) Claim held by another machine → `story close` refused (exit 3), do_instead `norn story checkout gh-N`; nothing changes. — verifier: test
- AC7 (B39) `story close gh-N --yes` on a story whose pushed `story.md` says `dropped` → refused `already_closed` (exit 3); nothing changes. — verifier: test
- AC8 (B55) In a slice worktree of gh-N, `norn story handoff` and `norn story close` act on gh-N. — verifier: test
- AC9 (B5) `norn take`, `norn release`, `norn drop` are usage errors (exit 2) "Unknown command: …"; nothing is dropped. — verifier: test
- AC10 (B33, B34, B35) In two throwaway clones sharing a bare remote, handoff on one and checkout on the other continue the story; close on the holder leaves the record on the remote. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D5: closed = `story.md` `dropped`, read from the pushed story branch. Prefactor 3 (take's claim-and-restore as a runtime module) is the first commit of this slice, behaviour unchanged; close reuses drop's teardown as it is. do_instead strings inside these commands that name `norn take`/`norn drop` move to the printed-commands module and are renamed in slice 14 if not already here.
