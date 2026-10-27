/**
 * Confirmed defect, reproduced (refactor plan BUG-4, fixed by 1.4). Each `test.failing` passes while
 * the defect stands; the fix flips it to `test`.
 *   - BUG-4: the machine-local readers in runtime/local.ts cast parsed JSON instead of validating it
 *     (S2), so a file of the wrong shape leaks through: a string `attempted_at` in remote.json makes
 *     `now - attempted_at` NaN (observe never finds a sync due again); junk records.json entries are
 *     returned as records.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceDir } from "@norn/store";
import { readPendingRecords, readRemoteCache } from "../src/runtime/local.ts";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "norn-local-json-"));
  mkdirSync(traceDir(r), { recursive: true });
  return r;
}

test.failing("BUG-4 remote.json of the wrong shape reads as empty, not as a string timestamp", () => {
  const r = root();
  writeFileSync(join(traceDir(r), "remote.json"), JSON.stringify({ attempted_at: "2099-01-01T00:00:00Z", synced_at: "yesterday" }));
  expect(readRemoteCache(r)).toEqual({ synced_at: null, attempted_at: null, last_error: null, default_branch: null });
});

test.failing("BUG-4 records.json of the wrong shape reads as empty", () => {
  const r = root();
  writeFileSync(join(traceDir(r), "records.json"), JSON.stringify({ records: [{ story: 7 }, "junk"] }));
  expect(readPendingRecords(r)).toEqual([]);
});
