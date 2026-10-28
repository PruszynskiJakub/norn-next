## Summary

Every claim renewal due in a tick now goes to the remote in one `git push`, so a tick that renews N claims makes one round trip instead of N (H5). Before this, a checkout holding 10 claimed stories spent 27–42s on every renewal tick.

```diff
 Actor.run(decisions)
+  renewAll(side claim renew decisions)            // before the per-decision loop
+    renewClaims → casRefs                         // one push, a lease per refspec
+      git push --porcelain --force-with-lease=A:a --force-with-lease=B:b origin x:A y:B
+      each ref's outcome ← its porcelain line     // `!` = failed; no line → whole output (network fails all)
+      each ref pushed → local update-ref
   for d in order
-    perform(d)                                    // claim renew → renewClaim → casRef: one push per story
+    renewed[d] ?? perform(d)                      // R1.2 unchanged: lost story → its other actions skipped
```

The push is plain, not `--atomic`, so one lost claim does not fail the others. git exits non-zero when any ref is rejected, which is why the outcome is read per ref. `casRef` is now `casRefs` of one update, so single-ref callers run the same command as before.

## Evidence

- **Renewals due in a tick go out in one push**
  **Before:** with 3 claimed stories, a renewal tick made 3 claim pushes ([loop-red-N3.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-76-claim-renewals-push-one-ref-at-a-time-so/.agents/specs/gh-76-claim-renewals-push-one-ref-at-a-time-so/runs/_story/evidence/01M61DSSA60T9F4M3XCZRG3NSC/loop-red-N3.txt)). In the live trace, the average tick took 3.7s with 0 renewals and 35.7s with 10 ([tick-durations.jsonl](https://github.com/PruszynskiJakub/norn-next/blob/gh-76-claim-renewals-push-one-ref-at-a-time-so/.agents/specs/gh-76-claim-renewals-push-one-ref-at-a-time-so/runs/_story/evidence/01M61DSSA60T9F4M3XCZRG3NSC/tick-durations.jsonl)).
  **After:** the same loop ([debug-gh76.test.ts](https://github.com/PruszynskiJakub/norn-next/blob/gh-76-claim-renewals-push-one-ref-at-a-time-so/.agents/specs/gh-76-claim-renewals-push-one-ref-at-a-time-so/runs/_story/evidence/01M61DSSA60T9F4M3XCZRG3NSC/debug-gh76.test.ts), `GH76_N=3`) on this branch passes with one push:
  ```text
  renewals=3 ok=3 claim pushes=1
  push --porcelain --force-with-lease=refs/norn/claims/gh-1:<sha> --force-with-lease=refs/norn/claims/gh-2:<sha> --force-with-lease=refs/norn/claims/gh-3:<sha> origin <sha>:refs/norn/claims/gh-1 <sha>:refs/norn/claims/gh-2 <sha>:refs/norn/claims/gh-3
  ```
  `refs.test.ts` "every renewal goes out in one push and is mirrored locally": 3 renewals → `pushes.length == 1`, all ok, the local and remote refs both at the new sha.
  Tick time on a real GitHub remote has not been measured: the process runs the released `norn`, so that number shows up in the trace after release.

- **One lost claim fails only its story (R1.2)**
  **Before:** each story had its own push, so this held with N pushes.
  **After:** `recovery.test.ts` "one renewal lost among several": with 3 stories, B force-takes gh-2. The tick makes 1 claim push, the renewals come out `gh-1 true, gh-2 false (stale info), gh-3 true`, and `receipts.apply` comes out `gh-1 ok, gh-2 skipped: claim lost, gh-3 ok`. It fails before the fix (3 pushes) and passes now.
  `refs.test.ts` "one stale renewal among several fails alone": res = `[ok, stale, ok]`, gh-2's message names only its own ref, its local ref is unchanged, and gh-3 lands on the remote. git's own behaviour (exit 1 while the other ref is updated) is checked in [git-batched-push-probe.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-76-claim-renewals-push-one-ref-at-a-time-so/.agents/specs/gh-76-claim-renewals-push-one-ref-at-a-time-so/runs/_story/evidence/01M61DSSA60T9F4M3XCZRG3NSC/git-batched-push-probe.txt).

- **Reasons unchanged; a network failure fails the whole batch**
  **After:** `refs.test.ts` "an unreachable remote fails every renewal as network": `[network, network, network]`. The reason patterns (`stale`, `rejected`, `network`, `other`) moved into `casFailReason` without changes.

- **Without a remote, and with nothing to renew**
  **After:** `refs.test.ts`: with no remote, each renewal is its own local `update-ref` CAS (`[true, stale, true]`). With no renewals there is no push.

- **Claim-lost effect transcript**
  **After:** unchanged. A single renewal sends the same push argv as before, so `recovery.test.ts`'s transcript keeps its spawns. Typecheck and the full suite pass (1203 tests, review#1).

## Merge danger

**Door:** two-way: no persisted format changes. Claim refs and blobs are unchanged, so a revert restores one push per ref.

**Blast radius:** every claim holder: a bug in reading the porcelain lines would mark a good renewal as lost, or a lost one as held, on every checkout running `watch` or `tick` with claims. Both cases are covered by real-git tests over bare repos (all ok, one stale among several, network failure). A single ref (acquire, release) sends the same command as before.
