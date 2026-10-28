---
id: gh-75/13
title: config list, get, set and unset
depends_on: [gh-75/03]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: agent }
---

## Goal
`norn config` becomes a noun: `list` and `get` show the resolved configuration as before, and `set`/`unset` write one value into the user or repo file, validated and keeping comments.

## Scope
Behaviour: B6 (config list/get), B61, B62, B63, B64, B65, B66, B67, B68. Seams: S1 (interaction fake). Out: #64's file and key moves.

## Acceptance
- AC1 (B61, B6) `norn config list` and `norn config get default_mode` print what `norn config` and `norn config default_mode` printed (value and the layer that set it), `--json` identical (existing config tests move). — verifier: test
- AC2 (B62) `norn config set default_mode auto --user` → the user config file gains `default_mode: auto`; `config get default_mode` shows it from the user layer. `--repo` writes `.agents/norn/config.yaml`. — verifier: test
- AC3 (B63) Dotted keys and YAML values work: `agents.claude.model opus --repo`, `limits.deadline 90m --repo`, `notifiers '[{adapter: os}]' --user` (the list replaced whole); each is then shown by `config get`. — verifier: test
- AC4 (B64) Interactive, `config set default_mode auto` without a file flag asks "Write to user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)?" and writes to the chosen one. — verifier: test
- AC5 (B65) Without `--user`/`--repo` under `--json` or with no TTY → usage error (exit 2), do_instead "pass --user or --repo". — verifier: test
- AC6 (B66) `config set slots.max lots --repo` → refused naming the validation error; an unknown key → refused; in both the file is byte-for-byte unchanged. — verifier: test
- AC7 (B67) Given a commented repo config file, after `config set` only the changed line differs (comments and key order kept). — verifier: test
- AC8 (B68) `config unset default_mode --user` removes the key and `config get` shows the next layer's value; unsetting a key the file lacks changes nothing, exit 0; file-flag rules as `set`. — verifier: test
- AC9 (B62, B67) In a throwaway repo with a commented config, `config set` and `config unset` at the terminal leave a clean one-line `git diff`. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D8: yaml document round-trip, validate the layer and the merged result, atomic write (S1). The harness must point the user config at a temp home. `norn config <key>` (old form) becomes a usage error; it is not in B5's list but follows D1.
