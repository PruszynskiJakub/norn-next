---
id: gh-75/15
title: Docs, skills, Herdr plugin and PRD on the new names, held by a lint
depends_on: [gh-75/14]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
Nothing shipped refers to a removed command: README, CONTRIBUTING, AGENTS.md, the bundled and repo-local skills, the Herdr plugin and the PRD use the new surface, and a repo lint keeps it so.

## Scope
Behaviour: B8, B71. Seams: S2. Out: behaviour changes.

## Acceptance
- AC1 (B8, B71) `test/repo.test.ts` fails when any package source, `packages/cli/assets`, `plugins/`, `.agents/skills`, README, CONTRIBUTING, AGENTS.md or `.agents/PRD.md` names a removed command (`norn drop`, `norn inbox`, … the B5 list, plus `norn status <key>` and `cockpit` flags), and passes on the tree as shipped; a planted `norn unstick` in a scanned file makes it fail. — verifier: test
- AC2 (B8) The Herdr plugin's actions (next, pick, cockpit, open) call the new commands; its cockpit action runs `norn status --watch --pane`, its next action `norn run attach --next`. — verifier: test
- AC3 (B71) The PRD's command table (§15) is the noun tree, and the rules that named old commands (O1, O2, O5, MO5, S7, BS9, GR7, K2a, HC4–HC13, …) name the new ones; S7 reads "through `norn story edit <unit> --workflow <name> --at <step>`". — verifier: test
- AC4 (B8) In Herdr with the plugin loaded from this branch, the next, pick, cockpit and open actions work. — verifier: agent

## Checks
- `bun test test/repo.test.ts`
- `bun test`

## Notes
D1: docs, PRD and lint land last. Edit bundled skills in `packages/cli/assets/skills/`, never the `.agents/skills/norn*` copies (refresh copies the way the repo does). The lint allows the printed-commands module and the B5 refusal table, and skips CHANGELOG.md (history). `.agents/PRD.md` is amended in place (no new SPEC file). AC3 is checked by the lint for old names plus a test that the §15 table lists `status`, `story`, `run` with their verbs.
