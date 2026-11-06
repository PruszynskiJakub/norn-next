---
id: gh-234
slug: the-repo-has-a-review-md-and-the-pr
provider: gh
number: 234
url: https://github.com/PruszynskiJakub/norn-next/issues/234
title: The repo has a REVIEW.md, and the PR template asks about risk and revert
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-05T23:06:55.379Z
body_hash: e05e46ae42bfa7f5fa3d2fc769f4b7561051e0e0b03dfbc5f5b652a2abc15a35
merge:
  pr: 239
  url: https://github.com/PruszynskiJakub/norn-next/pull/239
  head_sha: a6c0887ebef4b33303aef50c912c2113bd28c082
  merge_commit_sha: cf04092b6994e5db4d9bdb94316e5b731194ee5c
  merged_by: PruszynskiJakub
  merged_at: 2026-11-06T07:59:19.000Z
---

## Observed

No `REVIEW.md`, so reviewers spend attention on generated or fixture files and on nits. The hand-written PR template (used for bypass PRs) asks only "What's new" and "Tested".

## Wanted

- `REVIEW.md` at the repo root, short:
  - ignore `packages/schema/json/`, `packages/core/test/golden/`, `test/e2e/transcripts/`, `test/e2e/observe-snapshots/` and `runs/`;
  - failure means: a persisted format that breaks old records, a claim or lease race, a write that is not atomic (S1), core reaching for IO;
  - no style nits (Biome owns style); every finding cites file and line.
- `.github/pull_request_template.md` gains **Risk** and **How to revert**.

The review skill reads REVIEW.md once #226 ships; the file is useful to people before that.

## Where

Repo root, `.github/pull_request_template.md`.

## Rules

S1, S5, P6.
