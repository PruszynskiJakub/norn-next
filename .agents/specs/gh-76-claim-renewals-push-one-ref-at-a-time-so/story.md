---
id: gh-76
slug: claim-renewals-push-one-ref-at-a-time-so
provider: gh
number: 76
url: https://github.com/PruszynskiJakub/norn-next/issues/76
title: Claim renewals push one ref at a time, so a tick renewing N claims makes N round trips
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:fix
workflow: fix
status: done
intake_at: 2026-10-28T13:42:03.724Z
body_hash: 298d5b28d9ff97a13e6e3aace26f65b8904aabca94378e0ab882e0d39ea6dd35
merge:
  pr: 83
  url: https://github.com/PruszynskiJakub/norn-next/pull/83
  head_sha: 0aa0d60f0a06b6b3b9213525db345ab35c695adb
  merge_commit_sha: da0abe3802a615afc1c3d6eced7e0aeac341a589
  merged_by: PruszynskiJakub
  merged_at: 2026-10-28T15:32:43.000Z
---

## Observed

Ticks that renew claims are much slower than the rest. Over the first 1,182 ticks in `.agents/norn/trace/2026-10-28.jsonl` (up to 09:59:07Z):

| | ticks | avg | median | > 8s |
|---|---|---|---|---|
| with a `claim.renew` | 462 | 11.0s | 9.9s | 276 |
| without | 720 | 1.9s | 1.0s | 72 |

Tick time grows with the number of renewals: a tick renewing one claim takes about 3.5–4s, five about 14s, ten 27–42s — roughly 2.5–3s per renewal. A read-only `git ls-remote origin` to GitHub over SSH takes 1.6–1.8s here.

Each renewal is its own `git push --porcelain --force-with-lease=<ref>:<expected> origin <sha>:refs/norn/claims/<story>` followed by a local `update-ref` (`casRef`, `packages/store/src/git.ts:122`, push at line 129; called once per story by `renewClaim`, `packages/store/src/refs.ts:176`). The actor performs decisions one at a time (`Actor.run`, `packages/cli/src/runtime/act/index.ts:72`). So N claimed stories mean N separate pushes every `claim.renew` (default 3m, `packages/schema/src/config.ts:162`).

Claims renewed in the same tick stay together, because `renewed_at` is that tick's time (`claimBlob`, `packages/core/src/decide/story.ts:119`). In this trace, renewals ran in groups of 5, 2 and 1 until a 411s tick at 09:50; after it, all 10 claimed stories came due together, and since then every renewal tick makes 10 pushes and takes 27–42s.

## Wanted

All claim renewals due in a tick go to the remote in one `git push` (one `--force-with-lease=<ref>:<expected>` per refspec), so the cost no longer grows with the number of claimed stories (H5: claim beats are remote calls to keep cheap). Requirements:
- Use a plain, non-`--atomic` push, so one lost claim does not fail the other renewals.
- Read each ref's outcome from its `--porcelain` line, not from the exit code: git exits non-zero when any ref is rejected, even if the others were updated. A lost CAS on one story (`!` … `[rejected] (stale info)`) marks only that story as lost, and that story's other actions are skipped as today (H7 / R1.2).
- Reasons stay as they are (`stale`, `rejected`, `network`, `other`); a network failure fails every renewal in the batch.
- Each successfully pushed ref is still mirrored locally with `update-ref`.
- `packages/store/test/refs.test.ts` covers the batched path (all succeed, one stale among several, network failure); the claim-lost effect transcript (`recovery.test.ts`) is updated if its spawns change.

## Repro

1. Have several stories claimed on one checkout (`norn status` lists them as `mine`).
2. Run `norn watch` for longer than `claim.renew`.
3. `grep '"type":"tick","tick_id"' .agents/norn/trace/<day>.jsonl | jq -c '{at, ms: .duration_ms, renews: [.decisions[] | select(.rule == "claim.renew")] | length}'`: ticks with renewals take about (renewals × one push round trip) longer than the rest.
