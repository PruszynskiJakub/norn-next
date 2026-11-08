---
id: gh-228
slug: norn-review-applies-a-security-checklist
provider: gh
number: 228
url: https://github.com/PruszynskiJakub/norn-next/issues/228
title: norn-review applies a security checklist when the diff touches the paths REVIEW.md marks sensitive
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-07T22:33:43.386Z
body_hash: 8b9ea98ba22412badf61a2744565f9d3f6e5fb145335b4ed7c861a5a5ff13f44
merge:
  pr: 286
  url: https://github.com/PruszynskiJakub/norn-next/pull/286
  head_sha: 3dbc30dbd16950090e38d9ae0cd7a293ad9964e4
  merge_commit_sha: ed79897f216e80ddb736ddd82178d6850a34e0de
  merged_by: PruszynskiJakub
  merged_at: 2026-11-08T07:01:14.000Z
---

## Observed

There is no security review anywhere, although `norn:kind:security` exists. `REVIEW.md` already names this repo's one-way doors as blocking failures, and `norn-review` reads it (`packages/cli/assets/skills/norn-review/SKILL.md`), but nothing makes those diffs get a closer look.

## Wanted

- `norn-review` (bundled source) gains a Security checklist (injection, secrets, process spawning, env loading, the PATH shim, tokens) that it applies when the diff touches paths the repo's `REVIEW.md` marks sensitive. Its findings are blocking as usual. Worded generically, since the skill ships to every repo.
- This repo's `REVIEW.md` lists its sensitive paths: `.github/workflows/`, `scripts/`, `packages/schema/src/`, `packages/store/`, `packages/cli/src/runtime/shim.ts`.

## Out of scope

A check step with named outcomes (changes W2/W3), a path config key, and routing to a separate deeper review step. The reviewer can see the paths itself.

## Rules

P7, SK1.
