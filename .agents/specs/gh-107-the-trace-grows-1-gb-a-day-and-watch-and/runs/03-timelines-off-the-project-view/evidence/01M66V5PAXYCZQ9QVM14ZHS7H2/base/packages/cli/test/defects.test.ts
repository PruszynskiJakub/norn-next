/**
 * Fixed defect, kept as a regression test (refactor plan BUG-4, fixed by 1.4):
 *   - BUG-4: the machine-local readers (now store/src/local.ts) cast parsed JSON instead of validating it
 *     (S2), so a file of the wrong shape leaked through: a string `attempted_at` in remote.json made
 *     `now - attempted_at` NaN (observe never found a sync due again); junk records.json entries were
 *     returned as records. Every local reader now goes through store `readLocalJson`.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceDir, readPendingRecords, readRemoteCache } from "@norn/store";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "norn-local-json-"));
  mkdirSync(traceDir(r), { recursive: true });
  return r;
}

test("BUG-4 remote.json of the wrong shape reads as empty, not as a string timestamp", () => {
  const r = root();
  writeFileSync(join(traceDir(r), "remote.json"), JSON.stringify({ attempted_at: "2099-01-01T00:00:00Z", synced_at: "yesterday" }));
  expect(readRemoteCache(r)).toEqual({ synced_at: null, attempted_at: null, last_error: null, default_branch: null });
});

test("BUG-4 records.json of the wrong shape reads as empty", () => {
  const r = root();
  writeFileSync(join(traceDir(r), "records.json"), JSON.stringify({ records: [{ story: 7 }, "junk"] }));
  expect(readPendingRecords(r)).toEqual([]);
});
