---
id: gh-190
slug: release
provider: gh
number: 190
url: https://github.com/PruszynskiJakub/norn-next/issues/190
title: Release
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:release
workflow: release
status: active
intake_at: 2026-11-03T16:49:52.442Z
body_hash: e618c28f6e05e11f540fc9935713bf634771559418173720d0e949e8c2c48b47
---

## Version

0.19.0

## Must include

- #189 Pin the norn version a repo needs, and refuse a mismatched binary or drifted skills

## Notes

First release with `norn_version`: per B27 the release PR sets `norn_version: 0.19.0` in `.agents/norn.config.yaml` and refreshes `.agents/skills/norn*` from the bundled sources.
