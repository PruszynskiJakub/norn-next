---
id: gh-118/03
title: Tier configs and commands; cli tests into unit, integration and e2e
depends_on: [ gh-118/01, gh-118/02 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: agent }
  - { id: AC7, verifier: agent }
  - { id: AC8, verifier: agent }
---

## Goal
The three tiers exist as commands and the cli package, the bulk of the suite's time, lives in them: `bun test` stops running cli harness tests, `bun run test:integration` and `bun run test:e2e` run them in parallel and green. Shared helpers sit in `test/support/`, the six story flows with their transcripts and snapshots in `test/e2e/`, and the golden script harvests from the new places.

## Scope
Behaviour: B1 (cli part), B2, B5, B6, B16, B18 (cli part), B19, B20 (integration and e2e). Seams: S1, S3, S4. Out: store, adapters, view (slice 04); schema, core, root tests (slice 05); turning the guard on (slice 07); workflows, CI and docs (slice 06; `test:fast`/`test:cli` stay until then).

## Acceptance
- AC1 (B1, B2) The root bunfig ignores exactly `**/integration/**` and `test/e2e/**`, and the `test` script is exactly `bun test`. — verifier: test
- AC2 (B5, B6) `test:integration` and `test:e2e` each run `bun test` with their own config, which selects only `packages/*/test/integration/` or `test/e2e/` respectively, runs in parallel with a 20 s default timeout, and passes extra arguments through. — verifier: test
- AC3 (B16) An integration (or unit) test importing the transcript recorder or the observe snapshot helpers fails the repo rules naming the file; only `test/e2e/` may import them. — verifier: test
- AC4 (B19) The golden script's discovery finds the harness test files in cli integration and in `test/e2e/` and runs each with its tier's config. — verifier: test
- AC5 (B4, D5) Every cli file placed in `packages/cli/test/unit/` passes under the unit guard (`bun test --preload <guard> packages/cli/test/unit`); mixed files are split with no test lost. — verifier: test
- AC6 (B18) The diff of every transcript and observe snapshot file is a rename with no content change; `bun run golden` adds no case and `bun run golden -- --update` changes no decision. — verifier: agent
- AC7 (B19) `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <flow file>` rewrites only that flow's transcript under `test/e2e/transcripts/`, unchanged. — verifier: agent
- AC8 (B5, B6, B20) `bun run test:integration` and `bun run test:e2e` each pass three runs in a row; the cause of any parallel-only failure is fixed, not retried around, and named in the handoff. — verifier: agent

## Checks
- `bun test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run typecheck`

## Notes
D1, D3, D4, D6 (herdr plugin test moves to cli integration), D7, D12, D13 (B15 lint itself lands in slice 07). e2e = slice workflow flow (renamed from `e2e.test` to say what it is), base sync, recovery, auto-recovery, observe snapshots, team. Every other harness file is cli integration. Moves keep assertions unchanged (Testing decisions); a move that seems to need a changed assertion is a PR finding. Run the parallel tiers three times before the bulk of the move, so a second parallel-run cause (Risks) surfaces early. The biggest slice by file count, but almost all `git mv`; if the context runs short, the person may split the integration move from the e2e move.
