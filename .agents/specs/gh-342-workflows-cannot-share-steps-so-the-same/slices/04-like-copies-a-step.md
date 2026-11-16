---
id: gh-342/04
title: A step copies another step in its file with `like:`
depends_on: [ gh-342/03 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
A step written `like: test` copies the `test` step in the same file and replaces only the top-level keys it writes, in a workflow and in a shared file, so near-identical steps keep their command and timeout in one place.

## Scope
User stories: `like:` copies and replaces only written keys; `like:` in a workflow and in a shared file; a bad `like:` refused with its reason. Seams: S1, S4. Out: replacing YAML anchors in the shipped files (05, 06).

## Acceptance
- AC1 Given a workflow with `test` (a check with command, timeout and outcomes) and `test-merge: { like: test, outcomes: … }`, when loaded, then `test-merge` has `test`'s command and timeout and only its own `outcomes`; a written key replaces the copied value whole (shallow), and the flattened text lists the target's keys in order followed by the copy's new keys. — verifier: test
- AC2 Given a shared file whose step uses `like:` on another step of that shared file, when a workflow using it loads, then the copy is resolved within the shared file before its steps are brought in. — verifier: test
- AC3 Given `like:` naming a step that does not exist, itself, another `like` step, a `use` step, or a step only in another file (a shared step from the workflow, or a workflow step from the shared file), or a `use` step carrying `like:`, when loaded, then the workflow is refused with that reason, naming the file and step. — verifier: test
- AC4 Given a workflow with `like:` but no `use:`, when loaded, then `source` is the flattened text (no `like` left), and the emitted `workflow-source` and `workflow-shared` schemas accept `like` steps. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit`

## Notes
Plan D6 (shallow; resolved per file before `use` is flattened), D2 (key order), D3 (a `like` step allows the known step keys loosely; the full check runs on the copy). Depends on 03 because a `like` inside a shared file needs `use:` to be loaded at all, and both extend the same flattening module and schemas.
