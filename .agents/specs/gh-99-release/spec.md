---
id: gh-99
slug: release
provider: gh
number: 99
url: https://github.com/PruszynskiJakub/norn-next/issues/99
title: Release
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:release
workflow: release
status: new
intake_at: 2026-10-29T11:45:37.194Z
body_hash: ecd2a3d560ba8183290bd34ae39b8154b8c8e66a8d95a1b8ae593a261e0ffb56
---

## Version

0.11.1

## Must include

- #97 A tick mid-rebase acts on rewound runs/ files and leaves a stray receipt that corrupts the unit
- #98 Integrate's rebase drops the merge step's resolution and conflicts again

## Notes

Patch release so stories stuck on these bugs (e.g. gh-75) can move on with the released norn.
