---
id: gh-61/04
title: The `norn_version` team key and the match rule
depends_on: []
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
The team config can record `norn_version`; a bad value or a wrong file is an ordinary config error; `config list|get` shows it; one pure function says whether a running version matches, is older or is newer.

## Scope
Behaviour: B2, B3, B4, K8 (only `upgrade`/`init` write it). Seams: S1, S2. Out: refusing anything on a mismatch (slice 05), writing the key (slices 08, 09).

## Acceptance
- AC1 (B2) The match function, given the spec's examples as a table: repo 0.18.0 → 0.18.0 and 0.18.3 match, 0.17.9 older, 0.19.0 newer; repo 0.18.2 → 0.18.1 older; repo 1.2.0 → 1.5.1 matches, 2.0.0 newer. — verifier: test
- AC2 (B3) `norn_version: banana` in `.agents/norn.config.yaml` → `norn tick` prints `config_invalid` naming the file and the key, exit 6. — verifier: test
- AC3 (B3) `norn_version: 0.19.0` in `.agents/norn.config.local.yaml` or `~/.norn/config.yaml` → `config_wrong_file` naming `.agents/norn.config.yaml`. — verifier: test
- AC4 (B4) `norn config get norn_version` prints `0.19.0` with source `repo`; without the key it prints no value and a line saying `norn upgrade` records it; `config list` includes the key. — verifier: test
- AC5 (B4) `norn config set norn_version 0.20.0` and `config unset norn_version` are refused, exit 3, `do_instead` naming `norn upgrade`, and the file is unchanged. The JSON schemas and the generated reference list the key (not stale). — verifier: test
- AC6 (B3) The risk check: the latest released norn (without this change), run in a throwaway repo whose team file has `norn_version: 0.19.0`, refuses with `config_invalid` exit 6 and writes nothing; the result is noted in the handoff for the docs (slice 14). — verifier: agent

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D3 (match in the schema package; refusal texts built once in core, used from slice 05), D4. AC6 is the plan's first Risk; run the released binary only in a repo under `$TMPDIR`.
