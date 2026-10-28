---
id: gh-75/03
title: Targets from the worktree, and terminal prompts
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
A verb typed without a target acts on the unit of the worktree it is typed in, an explicit target wins, and at a terminal elsewhere it prompts with only the units the verb applies to; scripts and agents are refused with the candidates. Shipped on `run view` and `run list`, with the terminal interaction dependency (D2) and its harness fake.

## Scope
Behaviour: B54, B56, B57, B58, B59, B60 (on run verbs). Seams: S1 (new interaction fake). Out: each later verb declares which units it applies to and whether it is story-only (B55) in its own slice.

## Acceptance
- AC1 (B54) Given the harness cwd in the gh-N slice 2 worktree, when `norn run view` is typed, then it shows slice 2's latest run. — verifier: test
- AC2 (B56) Given the cwd in the gh-N worktree, when `norn run view gh-M` is typed, then it shows gh-M's run. — verifier: test
- AC3 (B57) Given the main checkout, an interactive session and two units with runs, when `norn run view` is typed, then the interaction fake is offered exactly the applicable units in `norn status` order, and the picked one is shown. — verifier: test
- AC4 (B58) Given exactly one applicable unit, then the pick-list is still shown, with that unit preselected; accepting it acts on it. — verifier: test
- AC5 (B59) Given no applicable unit, then the verb is refused (exit 3) with the reason, and nothing is prompted. — verifier: test
- AC6 (B60) Given a missing target under `--json`, with the interaction switched off (no TTY), or with an agent-session env (A6 launch env or orient env) present, then the verb is refused with a `CliError` (exit 2) whose do_instead names the candidates; nothing is prompted. — verifier: test
- AC7 (B57, B58) In a real terminal, `bun packages/cli/src/main.ts run view` in a throwaway repo shows a usable pick-list with the preselection, and Ctrl-C/Esc leaves without acting. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D2: interactive = TTY on stdin and stdout, no `--json`, not an agent session. The real interaction stays thin (Risks). The verb-applicability hook built here is what every later slice uses for its own "prompts only with applicable units" criterion.
