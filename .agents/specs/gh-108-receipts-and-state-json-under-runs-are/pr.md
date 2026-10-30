## Summary

Receipts (`NNNN-<kind>.json`) and `state.json`, the JSON norn commits under `runs/`, are now written as one line of JSON plus a newline, so they stop making up most of every PR's diff. Reading is unchanged: older pretty-printed files still parse and validate, and nothing is migrated.

```diff
 writeReceiptAt(unitDir, n, receipt)
-  createExclusive(file, json(receipt))       // JSON.stringify(v, null, 2)
+  createExclusive(file, jsonLine(receipt))   // JSON.stringify(v) + "\n"
 writeState(unitDir, state)
-  atomicWriteJson(statePath, state)
+  atomicWrite(statePath, jsonLine(state))    // still temp → fsync → rename (S1), still last (S5)
```

Machine-local files (`~/.norn` leases, trace, heartbeat, caches) keep `json()` on purpose: `handOverLease` compares the lease text on disk to `json(from)`, so changing their format would break handover of leases an older norn wrote.

## Evidence

- **One line on write**
  **Before:** each receipt about 20 lines (`JSON.stringify(value, null, 2)`); this branch's own `runs/_story` receipts and `state.json`, written by the released norn, are 382 lines over 18 files.
  **After:** `packages/store/test/files.test.ts` "receipts and state.json are written as one line of JSON plus a newline": `appendReceipt`, `writeReceiptAt` and `writeState` each produce text that ends in `}\n` with no other newline, and a receipt equals `JSON.stringify(r) + "\n"`. The same 18 files would be 18 lines. Implement reported this test red before the change; it passes now (store `files.test.ts` 10/10).
- **Older pretty files still read**
  **Before:** n/a (only pretty files existed).
  **After:** "older pretty-printed receipts and state.json still read": a pretty receipt and `state.json` written by hand read back through `readReceipt` / `readState`, and appending the same receipt again returns `existed: true` (replay stays idempotent, since `sameReceipt` compares by `receipt_id`).
- **Pinned outputs**
  Effect transcripts and observe snapshots needed no update (transcripts already store JSON as one line); full suite and type check green apart from load-related timeouts that pass when run alone (see handoff). No QA step ran for this `quick` story, so nothing beyond the tests was observed.

Note: this branch's own `runs/` files are still pretty-printed, because the process runs the released norn. The smaller diffs show up on PRs after this ships in a release.

## Merge danger

**Door:** two-way: a revert brings back pretty output, and both forms read either way, so files written in the meantime stay valid.

**Blast radius:** low, `runs/` files: only the formatting of new receipts and `state.json` changes; schemas, receipt kinds and readers are untouched. Something outside norn that diffs or greps these files line by line would see the new shape.
