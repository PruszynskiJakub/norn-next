---
id: gh-75/08
title: story start and story edit
depends_on: [gh-75/03]
status: planned
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
Starting an attended step is `norn story start [--print]`; changing a story's mode or a unit's workflow is `norn story edit` (`--auto|--manual`, `--workflow <name> [--at <step>]`). `open`, `mode` and `workflow` are gone.

## Scope
Behaviour: B5 (for `open`, `mode`, `workflow`), B28, B30, B31, B32, B55 (edit --auto|--manual). Seams: S1 (fake Herdr, fake shell). Out: printed start hints (slice 14).

## Acceptance
- AC1 (B28) Given gh-N at an attended step, `norn story start gh-N` opens a Herdr tab in its worktree running the start command (fake Herdr records it); `--print` prints the command instead; behaviour otherwise as `norn open`. Without a target it offers only units a person can start. — verifier: test
- AC2 (B30) `norn story edit gh-N --auto` writes the mode receipt and the next tick runs gh-N in auto; `--manual` the reverse; `--auto --manual` together → usage error (exit 2); `story edit` with no change flag → usage error. — verifier: test
- AC3 (B31) Given gh-M not started, `norn story edit gh-M --workflow fix` sets its workflow as `norn workflow` did. — verifier: test
- AC4 (B32) Given gh-N started, `norn story edit gh-N --workflow quick --at implement` switches it, journaled as `workflow --to` was; without `--at` → refused with do_instead naming `--at`. — verifier: test
- AC5 (B55) In a slice worktree of gh-N, `story edit --auto` changes gh-N's mode; `story edit --workflow` acts on the slice. — verifier: test
- AC6 (B5) `norn open`, `norn mode`, `norn workflow` are usage errors (exit 2) "Unknown command: …". — verifier: test
- AC7 (B28, B32) In a throwaway repo, `story start --print` prints a start command that works when pasted, and `story edit --workflow … --at …` lands the unit on that step. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
S7 is unchanged in substance; only its command moves (PRD wording in slice 15). The cockpit's internal `open` call follows here.
