---
id: gh-108
slug: receipts-and-state-json-under-runs-are
provider: gh
number: 108
url: https://github.com/PruszynskiJakub/norn-next/issues/108
title: Receipts and state.json under runs/ are pretty-printed, so norn's own files make up most of every PR's diff
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-10-30T10:35:27.743Z
body_hash: d692ae0c92737b7a0fde1dc9cb03733e05114cec3e12c9adbdc23107ffc19627
---

## Observed

norn's own files under `.agents/specs/*/runs/` take up most of every PR diff. Share of changed lines that are under runs/, last 8 PRs:

| PR | runs/ lines | runs/ files |
|---|---|---|
| #106 CLI regroup | 2276 / 2769 (82%) | 87 / 100 |
| #105 intake | 1885 / 2238 (84%) | 20 / 35 |
| #104 release workflow | 324 / 509 (63%) | 13 / 21 |
| #102 ci check | 323 / 484 (66%) | 13 / 19 |
| #100 Release 0.11.1 | 239 / 291 (82%) | 8 / 13 |
| #98 integrate rebase | 798 / 960 (83%) | 33 / 40 |
| #97 tick mid-rebase | 2211 / 2530 (87%) | 34 / 45 |
| #90 Release 0.11.0 | 1704 / 1770 (96%) | 12 / 17 |

`.gitattributes` already marks `runs/**` as `linguist-generated`, so GitHub collapses those files in the diff view. The PR's file count and +/- totals still include them, and so does the squash commit that lands on main.

Receipts are the largest part. In #106's runs/ lines, receipts account for about 45%: `started` is 455 lines over 22 files, `done` 325 over 11, then `classify` and `check`. Each receipt is about 20 lines because store writes every JSON file with `JSON.stringify(value, null, 2)` (`json()` in `packages/store/src/fsx.ts:154`).

## Wanted

Receipts (`NNNN-<kind>.json`) and `state.json`, the JSON files norn commits under `runs/`, are written as one line of JSON plus a trailing newline. This cuts their diff lines by roughly 10×.

- Reading is unchanged: older pretty-printed files still parse and validate, so units in flight and committed history keep working. Nothing gets rewritten in a migration.
- Machine-local files (`~/.norn` leases, trace, heartbeat, caches) can stay as they are. Changing them as well is fine if it keeps the code simpler (one `json()`), but the PR diff is the goal.
- No change to schemas, receipt kinds or what is written, only the formatting.
- Update the pinned outputs that record that formatting: the effect transcripts (`NORN_TRANSCRIPT_UPDATE=1`; they already store JSON as one line, so expect little change), the observe snapshots, and any fixture or test that compares file text.

Out of scope (separate decisions): keeping QA evidence (`out-*.txt`, `AC*.md`) off the branch, and moving `runs/` off the story branch to a norn ref (to be raised in #71's refine).

## Where

- `packages/store/src/fsx.ts:154`: `json()` and `atomicWriteJson`
- `packages/store/src/receipts.ts`, `packages/store/src/unit.ts`: receipt and `state.json` writes
- Other callers of `json()`/`atomicWriteJson`: `base.ts`, `cockpit.ts`, `heartbeat.ts`, `inbox-history.ts`, `leases.ts`, `local.ts`, `lock.ts`, `refs.ts` in `packages/store/src/`
- `.gitattributes`: `runs/**` already `linguist-generated`

## PRD

S1 (atomic writes; unchanged), S5 (state.json written last; unchanged). No rule changes.
