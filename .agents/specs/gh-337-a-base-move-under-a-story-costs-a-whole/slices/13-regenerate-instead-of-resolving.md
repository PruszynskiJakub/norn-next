---
id: gh-337/13
title: Generated files regenerate instead of resolving
depends_on: [gh-337/07]
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
A base update whose conflicts are all generated files completes with no agent: take the base side, run the mapped commands, commit the merge. A branch holding only its spec folder takes the base's side with no agent. A regenerated merge counts as clean on the light path.

## Scope
User stories: the regenerate key in the team config; all conflicts mapped → regenerated with no agent; any unmapped conflict → resolve; a failed command or a path still conflicted → resolve with the output in the brief; a regenerated merge goes through test; this repo maps schema:emit and docs:emit, never golden cases; a spec-folder-only branch takes the base side as a merge; the key documented; a regenerated merge counts as a clean merge. Seams: S1, S2, S3, S4. Out: nothing else.

## Acceptance
- AC1 Given `.agents/norn.config.yaml` with `regenerate: [{ paths: [globs], run: cmd, timeout? }]`, then the config loads and validates; a malformed entry is refused with the reason. — verifier: test
- AC2 Given a base update whose conflicting paths all match the mapping, then norn takes the base version of each, runs the matched commands (each bounded by its timeout, default 2m), and commits the merge with a `Norn-Regenerated` trailer, with no agent session; the story then goes through its test step as after any merge. — verifier: test
- AC3 Given any conflicting path matches no glob, then the update goes to `resolve` as today. — verifier: test
- AC4 Given a mapped command fails or times out, or a path is still conflicted after the commands ran, then the merge is aborted and the update goes to `resolve`, with the command's output in the resolver's brief. — verifier: test
- AC5 Given a story branch holding nothing but its own spec folder, when a base update conflicts, then norn takes the base's version of every conflicted file outside the folder and commits it as a merge, with no agent and no config. — verifier: test
- AC6 Given a light-path update whose merges are regenerated, then it ends `clean` only when each regenerated merge carries the trailer and its remerge-diff touches only paths the mapping matches; otherwise `resolved`. — verifier: test
- AC7 The git port can merge while keeping the conflicts in the worktree, proven by the git contract suite for the real adapter and the fakes. — verifier: test
- AC8 This repo's `.agents/norn.config.yaml` maps the emitted schemas to `bun run schema:emit` and `docs/reference.md` to `bun run docs:emit`, and maps no golden case; the team config docs and `docs/reference.md` describe the key and say commands must be fast and deterministic. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` and `bun run docs:emit`

## Notes
D13. Depends on slice 07 for the clean classification (AC6). Closes #126 (AC5): the PR body says so. Regenerate runs inside act's update and holds the tick up to its timeout.
