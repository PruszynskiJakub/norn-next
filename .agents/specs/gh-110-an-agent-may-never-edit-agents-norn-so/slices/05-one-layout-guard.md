---
id: gh-110/05
title: Commands refuse the old or a mixed layout and name norn migrate
depends_on: [gh-110/02, gh-110/03, gh-110/04]
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
The code knows one layout: on a main checkout still on the old layout every command refuses with `do_instead: norn migrate`, with both layouts present every command refuses naming both paths, doctor reports it, hooks stay out of the agent's way, and a unit worktree's own old files are ignored.

## Scope
Behaviour: B17, B18, B19, B20, B21. Seams: S1. Out: `norn migrate` itself (slice 06; until then it is not a command and the guard just names it).

## Acceptance
- AC1 (B18) Given a main checkout with `.agents/norn/config.yaml` (or old workflows, or a non-empty old trace dir) and nothing at the new places, when `norn status`, `norn tick` or `norn watch` runs, then it refuses (exit 3, code `old_layout`) naming the main checkout with `do_instead: norn migrate`; with `--json` the refusal is a `CliError`. — verifier: test
- AC2 (B17) Given any one part (config, workflows, machine files) present in both its old and new place, when `norn status`, `norn tick` or another repo command runs, then it refuses (exit 3, code `both_layouts`) naming both paths, and reads and moves nothing. — verifier: test
- AC3 (B19) Given the old layout, when `norn init` runs, then it refuses with `do_instead: norn migrate` and writes nothing. — verifier: test
- AC4 (B20) Given the old layout (and, separately, both layouts), when `norn doctor` and `norn doctor --repo` run, then the repo group reports the layout as failed naming `norn migrate`, exits non-zero, and moves nothing. — verifier: test
- AC5 (B18) Given the old layout, when `norn hook` runs, then it exits 0, records nothing and blocks nothing; `norn brief`, `done`, `ask`, `stuck` refuse like any command. — verifier: test
- AC6 (B21) Given a migrated main checkout and a unit worktree that still holds `.agents/norn/config.yaml`, when `norn brief`, `norn done`, `norn ask` and the agent hooks run in that worktree, then they work as usual and read config and workflows from the main checkout. — verifier: test
- AC7 (B17, B18) In a throwaway repo, move the new files back to their old places by hand; `norn status` and `norn doctor` say what is wrong and what to run. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D4 (per-part classification, main checkout only), D5 (one guard at dispatch after `locate()`, before config loads; exempt: `migrate`, `doctor`, `help`). The harness builds an old-layout repo by running `init` and moving its files back (Plan, S1). The guard must never look at a worktree's own files (B21).
