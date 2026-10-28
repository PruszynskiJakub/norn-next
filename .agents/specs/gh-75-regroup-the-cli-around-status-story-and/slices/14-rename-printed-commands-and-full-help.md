---
id: gh-75/14
title: Printed commands use the new names; help shows the whole tree
depends_on: [gh-75/02, gh-75/05, gh-75/06, gh-75/07, gh-75/08, gh-75/09, gh-75/10, gh-75/11, gh-75/12, gh-75/13]
status: planned
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
Every command norn prints names the new surface, so copying a printed command always works, and `norn help` shows the finished tree in tiers.

## Scope
Behaviour: B1, B2 (story), B3, B5 (whole list), B7, B69, B70. Seams: S1 and the pinned suites. Out: docs, skills, plugin, PRD (slice 15).

## Acceptance
- AC1 (B7) Inbox and status items name the new commands: a unit at a gate shows `norn story approve gh-N` under Approve, a stuck unit `norn run rerun gh-N`, a question `norn story answer gh-N "…"`, a running unit `norn run list gh-N`, a corrupt unit `norn run view gh-N --why`. — verifier: test
- AC2 (B7) Every `do_instead`, handoff header, brief, cockpit action and `doctor`/`init` next step that names a command names a new one: a test sweeps every builder of the printed-commands module and every `CliError` the cli suites produce, and finds no old verb (the B5 list). — verifier: test
- AC3 (B69, B70) The golden corpus, effect transcripts and observe snapshots are rewritten only through their update commands, and the diff contains only the command-string rename; a unit mid-workflow under the old strings continues after it with no migration; `norn run view --why` on a tick recorded before the rename reports the version mismatch, not a failure. — verifier: test
- AC4 (B1) `norn help` prints Core (`status`, `story` naming its verbs, `run`, each with a one-line summary), Setup (`init`, `doctor`, `config`, `uninstall`), Background (`watch`, `sync`, `tidy`), Agent protocol (`brief`, `done`, `ask`, `stuck`), then the agent preamble and skills list; `tick` and `hook` are absent. `--json` gives the same tree as data. — verifier: test
- AC5 (B2) `norn story` and `norn help story` list general: `create`, `list`, `view`; decision: `answer`, `approve`, `reject`, `update-branch`; work: `start`, `chat`, `edit`; team: `checkout`, `handoff`, `close`, `reopen`; exit 0. `norn run` lists `list`, `view`, `attach`, `rerun`, `cancel`. — verifier: test
- AC6 (B3) `norn help --all` lists everything in AC4 plus `tick`, `hook` and `status --segment`. — verifier: test
- AC7 (B5, B69) A table test over `drop`, `inbox`, `cockpit`, `orient`, `open`, `answer`, `approve`, `unstick`, `update`, `mode`, `workflow`, `take`, `release`, `trace`, `why`: each is a usage error (exit 2) "Unknown command: …", do_instead `norn help`, nothing on disk changes; `brief`, `done`, `ask`, `stuck` and `hook` behave as before. — verifier: test
- AC8 (B7) In a throwaway repo driven to a gate, a question and a stuck unit, every command `norn status`, `story view` and the cockpit print works when pasted. — verifier: agent

## Checks
- `bun test`
- `bun run typecheck`

## Notes
One reviewed rename in the printed-commands module (prefactor 2). Update the golden corpus with `bun run golden -- --update`, transcripts and snapshots with `NORN_TRANSCRIPT_UPDATE=1`; review each diff as exactly the rename (Risks).
