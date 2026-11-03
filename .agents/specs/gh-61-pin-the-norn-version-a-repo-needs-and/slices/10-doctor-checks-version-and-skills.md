---
id: gh-61/10
title: "`norn doctor` and `doctor --repo` fail on a mismatch or drifted skills"
depends_on: [gh-61/01, gh-61/02, gh-61/04, gh-61/03]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`doctor` reports the repo's norn version against the binary and fails on a mismatch or on a drifted bundled skill; `doctor --repo` runs both, so CI on the released binary goes red on a stale version or a hand-edited skill.

## Scope
Behaviour: B23, B24, B25, B5 (doctor warning). Seams: S1. Out: this repo's CI job (D15, a follow-up issue).

## Acceptance
- AC1 (B23) Binary 0.19.2, repo 0.19.0 → "PASS norn 0.19.2 matches this repo's norn version 0.19.0"; binary 0.18.1 → "FAIL norn 0.18.1 does not match this repo's norn version 0.19.0", "→ install norn 0.19.x", exit 1. — verifier: test
- AC2 (B5) No key → a warning "no norn version recorded: run `norn upgrade`", not a failure. — verifier: test
- AC3 (B24, B21) `.agents/skills/norn-review/SKILL.md` edited → "FAIL skills norn-review differs from norn 0.19.0's copy" with "→ run `norn upgrade` and commit (git diff .agents/skills/ shows the change)", exit 1; an edited repo-local skill is not mentioned. — verifier: test
- AC4 (B25) `norn doctor --repo` with no agent, runner or remote configured: a hand-edited `.agents/skills/norn/SKILL.md` fails the skills check, exit 1; a repo at an older version fails the version check; a clean repo passes, exit 0. Missing skills and links stay out of `--repo`. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D12. Depends on 03 only because the fix line names `norn upgrade`.
