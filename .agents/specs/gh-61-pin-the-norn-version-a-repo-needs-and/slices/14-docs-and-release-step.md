---
id: gh-61/14
title: Docs for the repo's norn version, and the release step sets it
depends_on: [ gh-61/05, gh-61/07, gh-61/08, gh-61/09, gh-61/10, gh-61/11, gh-61/12 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: agent }
  - { id: AC3, verifier: agent }
---

## Goal
A person can roll out a new norn to a team from the docs; norn's own `release` step sets `norn_version` and refreshes the bundled skill copies in the release PR.

## Scope
Behaviour: B26, B27. Seams: S5. Out: this repo's CI `doctor --repo` job (D15, a follow-up issue).

## Acceptance
- AC1 (B26) The generated reference lists `norn_version` and `upgrade` (not stale) and the docs lint passes. — verifier: test
- AC2 (B26) The docs explain the key, the match rule, which commands are refused and which are not, the upgrade path (install, `norn upgrade`, review, commit; teammates pull and install), that `init` never moves the version, the `migrate` rename, in-flight units (B22), what an older norn prints on a repo with the key (slice 04's finding), and a CI snippet for `doctor --repo`. — verifier: agent
- AC3 (B27) The repo-local `release` skill and the `release` workflow's `prepare` instructions set `norn_version: X.Y.Z` in the team file and copy `packages/cli/assets/skills/norn*` over `.agents/skills/norn*` in the release branch, in the same diff as the version bump. — verifier: agent

## Checks
- `bun run test`
- `bun run docs:emit && git diff --exit-code docs/reference.md`

## Notes
D13 (by hand, not `norn upgrade`), D15. Mention in the handoff that the follow-up CI issue needs filing.
