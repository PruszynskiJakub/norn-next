---
id: gh-337/01
title: One push path for claim release; update outcome chosen in core
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
The two prefactorings the plan asks for, landed first and on their own: claim release and story close push through the same adopt-and-merge path as boundaries, and the `git: update` step's outcome is chosen by a pure core function. What a user sees today stays the same, except that a person's push to the story branch is merged at release instead of refusing it.

## Scope
User stories: a person's push merges with norn's local boundaries, never rebased (at claim release). Seams: S1 (the outcome function), S3. Out: the heads ref, the push rule, the light-path outcomes (later slices build on both functions).

## Acceptance
- AC1 Given a story whose remote branch is at or behind the local branch, when it is handed off with `norn story handoff`, released by a clean `norn watch` exit, or closed with `norn story close`, then the same branches and record are pushed in the same order as today, and the claim is released. — verifier: test
- AC2 Given a person pushed a commit to the story branch that the local branch lacks, when the story is handed off (or released by a clean watch exit, or closed), then the remote branch afterwards contains both the person's commit and norn's local boundary through a merge (no rebase, neither dropped), and the release succeeds instead of refusing as not a fast-forward. — verifier: test
- AC3 Given a `git: update` step, when the base merges cleanly the step ends `done`, and when it conflicts the step ends `conflict`, exactly as today; the choice is made by a core function given the merge result, and the existing golden cases and integrate tests pass unchanged. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan › Prefactoring 1 and 2. The person asked for both prefactorings in one slice of their own, first. Every slice starts behind this one, as the person asked: prefactorings first, then the push rule, merge step, story edit refusal, light path and re-approval and the base side; re-verify, overlap, regenerate and ask-instead-of-abort wait for all of those.
