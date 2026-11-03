---
id: gh-61/06
title: The inbox shows a version mismatch and a missing version
depends_on: [gh-61/01, gh-61/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
Observe records the running and the repo's norn version; `norn status`, the cockpit and the tab bar segment show a mismatch at the top of the inbox, and a hint when the repo records no version.

## Scope
Behaviour: B8 (status, segment), B5 (status hint). Seams: S1, S3. Out: drift facts (slice 11), refusing commands (slice 05).

## Acceptance
- AC1 (B8) `buildInbox` over Facts with `norn: { running: 0.18.1, repo: 0.19.0 }` puts a repo-level Unblock item first: "this repo needs norn 0.19.x (you run 0.18.1): install norn 0.19.x"; a newer binary's item names `norn upgrade`. — verifier: test
- AC2 (B5) Facts with no repo version → a Check item "no norn version recorded: run `norn upgrade`", which never notifies; a matching version adds no item. — verifier: test
- AC3 (B8) Binary 0.18.1 in a repo at 0.19.0 → `norn status` exits as today and prints the mismatch item on top; `norn status --segment` shows the mismatch in the tab bar line; inbox parity (`loadProjectView` = `buildInbox` over observe's Facts) holds. — verifier: test
- AC4 (B8) In a throwaway repo whose team file records a `norn_version` the dev build does not match, `bun packages/cli/src/main.ts status` shows the mismatch item at the top, readable at a glance. — verifier: agent

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D5 (the repo-level `norn` facts part: running, repo; slice 11 adds `skills_drift` to it), D7. Observe snapshots and golden cases move with the new facts field: review the diff and update them only for this change.
