---
id: gh-337/06
title: story edit points at update-branch for a conflicting PR
depends_on: [ gh-337/01 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: agent }
---

## Goal
Restarting the same workflow on a finished story whose open PR conflicts is refused and names `norn story update-branch`; deliberate new work still starts a round, and the docs point at the right command.

## Scope
User stories: the refusal for the same workflow with no `--at`; a different workflow or `--at` still starts the round; AGENTS.md and the base recipe point at update-branch. Seams: S3. Out: everything else.

## Acceptance
- AC1 Given a finished story with a known open PR that conflicts with its base, when a person runs `norn story edit gh-N --workflow <the workflow its round ran>` with no `--at`, then it exits 3 (`refused`), with code `update_branch_instead` and a `do_instead` naming `norn story update-branch gh-N`, and no round starts. — verifier: test
- AC2 Given the same story, when a person runs `norn story edit` naming a different workflow, or with `--at <step>`, then the round starts as today; and with no conflicting PR the same-workflow edit starts as today. — verifier: test
- AC3 AGENTS.md and the "The base moved under a story" recipe say a finished story with a conflicting PR is updated with `norn story update-branch`, and that starting a new round is for new work. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run docs:emit` (if the command's reference text changes)

## Notes
D6.
