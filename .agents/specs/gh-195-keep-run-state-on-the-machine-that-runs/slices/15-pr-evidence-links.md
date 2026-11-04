---
id: gh-195/15
title: open-pr pushes the record and links the PR's evidence to it
depends_on: [gh-195/08]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: person }
---

## Goal
The describe agent links QA evidence in `pr.md` by its path in the story's record; `open-pr` pushes the record, rewrites those links to that record commit's URLs on GitHub or GitLab, and then opens or updates the PR, where the images render inline.

## Scope
Behaviour: B28, B11 (the open-pr push under `local`). Seams: S1, S4. Out: committing evidence to the branch (out of scope, the fallback).

## Acceptance
- AC1 (B28, B11) Given gh-9 under `local` with QA evidence and a `pr.md` holding `![B2 after](evidence/01-parser/<run_id>/shot.png)`, when `open-pr` runs, then `refs/norn/runs/gh-9` is pushed first and the body sent to `FakeRemote` has the link rewritten to `…/blob/<record commit>/01-parser/…/shot.png?raw=true` (GitHub) or `…/-/raw/<record commit>/…` (GitLab), the path being the file's real path in the record (the story's current round for `_story`). — verifier: test
- AC2 (B28) Given a `pr.md` link to an evidence file the record does not hold, when `open-pr` runs, then that link is left as written and named in the step's output; and given the record push is rejected, the git step fails and is retried as git steps are, and no PR is opened or updated. — verifier: test
- AC3 (B28) Given rework after the PR was opened, when `open-pr` runs again, then it pushes a new record commit whose parent is the earlier one and rewrites to the new commit, so the older body's links still resolve on the remote. — verifier: test
- AC4 (B28) The describe step's input is the new `record` input kind, which lists each unit's receipts and evidence folders in the machine dir in the brief; it replaces `{ file: runs/ }` in the shipped and repo-local `story` workflows, the workflow schema, its emitted JSON and the reference docs are regenerated, and the norn-pr skill tells the agent to link by record path. — verifier: test
- AC5 (B28) On a real GitHub PR and a real GitLab MR opened by this build, the QA screenshot `pr.md` cites renders inline in the PR body. — verifier: person, because only a real provider's markdown renderer shows whether an image from a commit reachable only through `refs/norn/runs/*` renders (GitHub verified in planning, GitLab not; S4). If GitLab fails, the fallback in Out of scope comes back for GitLab only.

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run schema:emit && bun run docs:emit && git diff --exit-code packages/schema/json docs/reference.md`

## Notes
D5. Edit the norn-pr skill in `packages/cli/assets/skills/`; change the story workflow in both places (AGENTS.md: shipped and repo-local). From gh-195/05 until this slice the describe step's `{ file: runs/ }` input names a folder that is no longer in the worktree; if the brief refuses a missing file input, gh-195/05 replaces it with the spec folder as a stopgap and this slice puts the `record` kind in.
