---
id: gh-75/01
title: Noun–verb command tree, with run list and run view
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
---

## Goal
The command framework knows nouns with verbs, verb-level help and tiered help (prefactor 1), and the first noun ships on it: `norn run list` and `norn run view [--why | --receipt]` replace `trace` and `why`.

## Scope
Behaviour: B2 (for `run`), B4, B5 (for `trace`, `why`), B6 (run list/view), B43, B44, B45, B70 (run list/view JSON). Seams: S1. Out: `run attach`, `rerun`, `cancel` (slices 05, 09); help tiers listing the full surface (slice 14); target prompts (slice 03).

## Acceptance
- AC1 (B2) Given a repo, when `norn run` is typed with no verb (and `norn help run`), then its verbs are listed and it exits 0; only the verbs that exist so far are listed, in the order the spec gives (`list`, `view`, then `attach`, `rerun`, `cancel` as later slices add them). — verifier: test
- AC2 (B4) When `norn help run view` or `norn run view --help` is typed, then that verb's usage and options are printed, exit 0. — verifier: test
- AC3 (B43, B70) Given a story with slices and recorded runs, when `norn run list gh-N` is typed, then it prints the step timeline `norn trace gh-N` printed before (durations, outcomes, who, reasons; the story with its slices) and `--json` prints the same JSON value `trace --json` did; every `trace` flag is accepted with the same effect. — verifier: test
- AC4 (B44, B6) When `norn run view <unit>` is typed, then it shows the latest run of that unit (step, attempt, outcome, durations, receipts); `norn run view <run-id>` shows that run; `--json` prints one JSON value. — verifier: test
- AC5 (B45, B70) When `norn run view <unit> --why` (with `why`'s flags) or `norn run view --receipt <id>` is typed, then it prints what `norn why` / `why --receipt` printed, `--json` identical. — verifier: test
- AC6 (B5) When `norn trace` or `norn why` is typed, then it is a usage error (exit 2) "Unknown command: …" with do_instead pointing at `norn help`, and nothing is written. — verifier: test
- AC7 (B69) Every other command still works under its current name with unchanged output (existing suites pass unmodified apart from the moved trace/why tests). — verifier: test
- AC8 (B43, B44, B45) In a throwaway repo with a few ticks recorded, `run list`, `run view`, `run view --why` and `run view --receipt` read correctly at the terminal. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
Prefactor 1 lands here: the framework change registers today's flat commands unchanged. Help tiers (Core, Setup, Background, Agent protocol, hidden tier for `help --all`) are built here but only checked against the final surface in slice 14. Old `trace`/`why` tests move with their assertions, renamed (Testing decisions). Any place norn runs a verb internally by argv (the cockpit's `runVerb`) must follow the move in this slice. The printed strings `norn trace …`/`norn why …` in inbox items and hints are renamed in slice 14, not here.
