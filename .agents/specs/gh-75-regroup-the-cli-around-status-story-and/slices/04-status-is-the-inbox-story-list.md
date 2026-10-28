---
id: gh-75/04
title: norn status shows what needs you; the listing moves to story list
depends_on: [gh-75/01]
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
`norn status` answers "what now?" with the inbox (its flags included), `norn story list` takes over the story table `status` printed, a one-time notice tells upgraders where the listing went, and `status --segment` keeps working. `inbox` and `status <key>` are gone.

## Scope
Behaviour: B5 (for `inbox`), B6 (story list, status), B9, B10, B13, B14, B15, B70 (status/story list JSON). Seams: S1. Out: `status --watch` (slice 05); `story view` (slice 06) — `status <key>` is removed here and its view comes back as `story view`.

## Acceptance
- AC1 (B9) Given one unit at a gate and one parked on a question, when `norn status` is typed, then it prints the Approve and Answer groups with each item's age and command, as `norn inbox` did; with nothing to do it prints the empty inbox as `inbox` did. — verifier: test
- AC2 (B10, B70) `norn status` with `--details`, `--notes`, `--history [--since 1d]` and `--json` prints exactly what `norn inbox` printed with the same flags (the inbox tests move, assertions kept). — verifier: test
- AC3 (B15, B6, B70) `norn story list` prints the table `norn status` printed before; `norn story list --json` prints the same JSON value old `status --json` did. — verifier: test
- AC4 (B13) Given a checkout that never showed it, when `norn status` is typed, then stderr carries "`norn status` now shows what needs you; the story listing moved to `norn story list`." once; a second `norn status` on that checkout shows no notice; stdout and `--json` output are the same with and without it; an unreadable notice file shows the notice again rather than failing. — verifier: test
- AC5 (B14) `norn status --segment` prints the same line and writes the same Herdr presentation as before (existing segment tests unchanged), and it is absent from `norn help` but listed by `norn help --all`. — verifier: test
- AC6 (B5) `norn inbox` (any flags) is a usage error (exit 2) "Unknown command: inbox", do_instead `norn help`. — verifier: test
- AC7 (B9, B13, B15) In a throwaway repo, `bun packages/cli/src/main.ts status` twice shows the notice once on stderr and the inbox on stdout; `story list` shows the table. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D7: the notice marker is a small validated file in the checkout's machine-local trace folder; `CliResult` gains `stderr`, written by `main`, so `runCli` never prints. D9: status and story list print markdown and take `--json`. The cockpit and any internal `runVerb` calls to `inbox`/`status` follow the move here. Printed commands that say `norn inbox` are renamed in slice 14.
