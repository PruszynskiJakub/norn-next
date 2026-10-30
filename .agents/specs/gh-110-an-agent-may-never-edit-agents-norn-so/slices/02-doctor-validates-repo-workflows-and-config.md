---
id: gh-110/02
title: norn doctor validates the repo workflows and config, and doctor --repo
depends_on: []
status: active
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
`norn doctor` gains a repo group that validates every repo workflow exactly as a tick does (W5) and the repo config against its schema, read-only; `norn doctor --repo` runs only that group, on a machine with no agent, runner or remote.

## Scope
Behaviour: B7, B8, B9, B10. Seams: S1. Out: the layout check in the repo group (slice 05); the new paths (slice 03) — this slice reads workflows and config wherever store says they are.

## Acceptance
- AC1 (B7) Given a repo workflow with a cycle and no counter, when `norn doctor` runs, then it names that workflow file and the uncounted cycle with its path, and exits non-zero. — verifier: test
- AC2 (B7) Given a repo workflow whose step names a skill not installed for its agent, when `norn doctor` runs, then it names the workflow, the step and the missing skill, and exits non-zero; a tick refuses the same workflow for the same reason (one validator, prefactor 2). — verifier: test
- AC3 (B8) Given a repo config with `max_agents: "two"`, when `norn doctor` runs, then it names the config file, the key and why it is invalid, and exits non-zero. — verifier: test
- AC4 (B9) Given a clean checkout with valid workflows and config, when `norn doctor` runs, then the repo group reports them valid, it exits 0 when the machine group passes, and `git status` is still clean. — verifier: test
- AC5 (B10) Given no agent binary on PATH and no remote auth, when `norn doctor --repo` runs in a checkout with valid workflows and config, then it exits 0 and reports no agent, runner or remote check; with one workflow broken it names it and exits non-zero. — verifier: test
- AC6 (B7, B8) `norn doctor --json` carries the repo group's verdicts in its one JSON value, and `norn help doctor` lists `--repo`. — verifier: test
- AC7 (B7, B8, B10) In a throwaway repo, break a workflow and the config by hand; `norn doctor` and `norn doctor --repo` read clearly at the terminal and point at the file to fix. — verifier: agent

## Checks
- `bun test packages/cli/test/housekeeping.test.ts`
- `bun test packages/cli`
- `bun run typecheck`

## Notes
Plan Prefactoring 2 lands here: extract the load-and-validate of repo workflows (with each agent's visible skills) and repo config that observe uses today, and have doctor call it (D7). Never copy the rules. D14: wiring `doctor --repo` into this repo's CI is the follow-up story's, not this one.
