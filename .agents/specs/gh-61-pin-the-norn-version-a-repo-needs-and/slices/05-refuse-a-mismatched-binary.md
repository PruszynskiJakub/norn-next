---
id: gh-61/05
title: Commands that act refuse a mismatched binary
depends_on: [gh-61/01, gh-61/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
With a binary that does not match the main checkout's `norn_version`, every command that acts refuses with exit 3 and says what to install or run; reading, setup and reporting commands keep working; a repo without the key works as today.

## Scope
Behaviour: B5 (commands), B6, B7, B8 (read commands run), B9, B10, B12. Seams: S1. Out: the inbox/segment mismatch item (slice 06), `watch` (slice 07), `doctor`'s version line (slice 10).

## Acceptance
- AC1 (B6) Repo at 0.19.0, binary 0.18.1 → `norn tick` prints a `CliError` "this repo needs norn 0.19.x (you run 0.18.1)", `do_instead` "install norn 0.19.x", exit 3; no receipt, state, launch or push happens. — verifier: test
- AC2 (B6) A table test: every command declares a version class (`acts`, `reads`, `exempt`) as D1 lists them, the field is required by the type, and each `acts` command (`sync`, `brief`, `tidy`, `config set|unset`, the `story` and `run` verbs that change something) is refused the same way on a mismatch. — verifier: test
- AC3 (B7) Repo at 0.18.0, binary 0.19.0 → `do_instead` is "run `norn upgrade` to move this repo to norn 0.19.0 and commit the change, or install norn 0.18.x", exit 3. — verifier: test
- AC4 (B8, B9) On a mismatch, `help`, `--version`, `doctor`, `status`, `story list|view|wait`, `run list|view`, `config list|get`, `init`, `upgrade`, `migrate` and `uninstall` are not refused for the version and keep their exit codes. — verifier: test
- AC5 (B10) An agent's `norn done`, `norn ask`, `norn stuck`, `norn hook` and a tick's `norn check-run` are accepted when the team file moved to a newer version mid-step; the next `norn tick` is refused. — verifier: test
- AC6 (B12) The remote's base sets `norn_version: 0.19.0` but the main checkout has not pulled it → binary 0.18.1's `tick` runs; after the pull it is refused. A unit worktree's own team file is never what the guard reads. — verifier: test
- AC7 (B5, B3) No key → every command runs as before; an invalid key → the config error (exit 6) comes before any version refusal. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D1 (classes; `story reject`/`story handoff` act, `check-run` exempt), D2 (guard next to the layout guard in the dispatcher, after config load), D3 (refusal texts in core next to printed commands). `watch` is `acts` but per tick: in this slice it may simply refuse its first tick; slice 07 makes it keep running.
