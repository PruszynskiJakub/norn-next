---
id: gh-373
slug: release
provider: gh
number: 373
url: https://github.com/PruszynskiJakub/norn-next/issues/373
title: Release
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:release
workflow: release
status: done
intake_at: 2026-11-17T09:28:39.131Z
body_hash: 52ac9f6ba6a4a3499210b20e57cd1d7313dac71a8d6ba554e5ffd5f9343b9428
merge:
  pr: 374
  url: https://github.com/PruszynskiJakub/norn-next/pull/374
  head_sha: 724df0ee971e9a3b90965ed2fb32676895beba66
  merge_commit_sha: 213a2db0f996636a5d95a3ef4cd7b7d48a9438bc
  merged_by: PruszynskiJakub
  merged_at: 2026-11-17T09:49:05.000Z
---

## Version


## Must include


## Notes

After installing, restart every running `norn watch`: one started on an older norn keeps leaking a file descriptor per tick until it is restarted.
