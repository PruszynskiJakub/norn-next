---
id: gh-190
slug: release
provider: gh
number: 190
url: https://github.com/PruszynskiJakub/norn-next/issues/190
title: Release 0.19.0
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:release
workflow: release
status: done
intake_at: 2026-11-03T16:49:52.442Z
body_hash: e618c28f6e05e11f540fc9935713bf634771559418173720d0e949e8c2c48b47
merge:
  pr: 191
  url: https://github.com/PruszynskiJakub/norn-next/pull/191
  head_sha: 8ce8201ce84ca15f4b2b4e4606b78890274b003d
  merge_commit_sha: 859b213bc15a2bcb4ef6570c2f6d478c2cc86d74
  merged_by: PruszynskiJakub
  merged_at: 2026-11-03T17:03:06.000Z
---

## Version

0.19.0

## Must include

- #189 Pin the norn version a repo needs, and refuse a mismatched binary or drifted skills

## Notes

First release with `norn_version`: per B27 the release PR sets `norn_version: 0.19.0` in `.agents/norn.config.yaml` and refreshes `.agents/skills/norn*` from the bundled sources.
