---
id: gh-342/08
title: The recipes show shared files, `use:`, exits and `like:`
depends_on: [gh-342/04]
status: planned
criteria:
  - { id: AC1, verifier: agent }
---

## Goal
"Write your own workflow" in the recipes teaches a workflow author to write a shared file, `use:` it, route its exits and copy steps with `like:`, and says what is refused, without reading the code.

## Scope
User stories: the recipes show shared files, `use:`, exits, `like:` and refusals. Seams: S5. Out: a workflow-writing skill (a later story).

## Acceptance
- AC1 Given the recipes doc, when an agent follows "Write your own workflow" to write a workflow with a shared file, an exit routed with a counter and a `like:` step in a throwaway repo, then it loads; and the section lists what is refused (missing shared file, clash or double use, unknown exit, nested `use:`, keys that belong in the workflow, each bad `like:`) with wording that keeps a shared file's exit apart from a check's `exits`. — verifier: agent

## Checks
- `bun run test`
- `bun run docs:emit`

## Notes
The docs lints run in the unit tier. Depends on 04 so the examples and refusal wording match the loader's messages. Plan Risks: "exit" means two things; keep them apart in wording.
