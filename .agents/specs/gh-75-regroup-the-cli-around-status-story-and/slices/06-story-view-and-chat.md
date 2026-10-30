---
id: gh-75/06
title: story view and story chat replace status <key> and orient
depends_on: [ gh-75/03, gh-75/04 ]
status: integrated
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
One view per story: `norn story view [<story|slice>]` shows slices with their steps, the PR, open notes and what waits for the person (`--web` opens the PR or issue), and `norn story chat` opens the story's Herdr workspace with an agent. `orient` is gone.

## Scope
Behaviour: B5 (for `orient`), B6 (story view), B16, B17, B29, B55 (view, chat). Seams: S1 (fake shell, fake Herdr). Out: other story verbs.

## Acceptance
- AC1 (B16) Given gh-N with two slices, a PR and an open note, when `norn story view gh-N` is typed, then it shows the slices with their steps, the PR link and state, the open notes and the items waiting for the person. — verifier: test
- AC2 (B6, B70) `norn story view gh-N --json` prints one JSON value: the orient report's JSON extended with the slice steps and PR state (D6). — verifier: test
- AC3 (B17) `norn story view gh-N --web` with PR #40 → the fake shell records the PR's URL opened; a story without a PR → the issue's URL. — verifier: test
- AC4 (B29) `norn story chat gh-N` opens or focuses the `gh-N orient` workspace with an agent, as `orient --open` did (fake Herdr records it). — verifier: test
- AC5 (B55) In a slice worktree of gh-N, `norn story view` and `norn story chat` act on gh-N; without a target outside a worktree they prompt with stories only. — verifier: test
- AC6 (B5) `norn orient` (any flags) is a usage error (exit 2) "Unknown command: orient". — verifier: test
- AC7 (B16) In a throwaway repo, `bun packages/cli/src/main.ts story view <key>` reads as one coherent story view at the terminal. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D6. The cockpit's internal `runVerb(["orient", …, "--open"])` moves to `story chat` here. The orient agent's own shim and env (AGENTS.md decision) are unchanged.
