/**
 * gh-195 13-R3-F2: `rejected.json` is read entry by entry and written under a lock — one
 * entry of the wrong shape never makes the file read as empty for the next write, a file that is not
 * one at all is never written over, and a write waits for the lock another holder has.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RejectedMailboxReceipt } from "@norn/schema";
import { acquireLock, addRejectedReceipt, bindNornHome, pruneRejectedReceipts, readRejectedReceipts, rejectedLockPath, rejectedReceiptsPath } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

function checkout(): string {
  const root = tmp();
  Bun.spawnSync(["git", "init", "-q", root]);
  bindNornHome(root, join(tmp("norn-home-"), ".norn"));
  return root;
}

const entry = (id: string, at = "2026-10-01T00:00:00.000Z"): RejectedMailboxReceipt => ({
  story: "gh-9",
  unit: "gh-9",
  receipt_id: id,
  kind: "answer",
  who: "bob@b",
  step: "review",
  attempt: 1,
  at_step: "implement",
  reason: "stale",
  rejected_at: at,
  seen: { "gh-9": 3 },
});

const write = (root: string, text: string) => {
  const f = rejectedReceiptsPath(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const onDisk = (root: string) => JSON.parse(readFileSync(rejectedReceiptsPath(root), "utf8")).receipts as unknown[];

describe("rejected.json (13-R3-F2)", () => {
  test("review#1 F2: a dry prune takes no lock and writes nothing, even while another holder has the lock", async () => {
    const root = checkout();
    const text = JSON.stringify({ receipts: [entry("A")] });
    write(root, text);
    const lock = await acquireLock(rejectedLockPath(root));
    expect(lock.ok).toBe(true);
    try {
      const r = await pruneRejectedReceipts(root, "2026-11-01T00:00:00.000Z", new Set(), true);
      expect(r).toEqual({ removed: [entry("A")], error: null });
      expect(readFileSync(rejectedReceiptsPath(root), "utf8")).toBe(text);
    } finally {
      if (lock.ok) lock.release();
    }
    expect(existsSync(rejectedLockPath(root))).toBe(false);
  });

  test("an entry of the wrong shape is left out of the read and kept by the next write; the others stay open", async () => {
    const root = checkout();
    const bad = { story: "gh-9", receipt_id: "X" };
    write(root, JSON.stringify({ receipts: [entry("A"), bad] }));
    expect(readRejectedReceipts(root).map((r) => r.receipt_id)).toEqual(["A"]);
    await addRejectedReceipt(root, entry("B"));
    expect(onDisk(root)).toEqual([entry("A"), bad, entry("B")]);
    // tidy's prune keeps it too, dropping only the cleared old entries it can read
    expect((await pruneRejectedReceipts(root, "2026-11-01T00:00:00.000Z", new Set(["B"]), false)).removed.map((r) => r.receipt_id)).toEqual(["A"]);
    expect(onDisk(root)).toEqual([bad, entry("B")]);
  });

  test("a file that is not { receipts: [...] } is never written over: the keep fails and the file stays", async () => {
    const root = checkout();
    write(root, "{ not json");
    expect(readRejectedReceipts(root)).toEqual([]);
    await expect(addRejectedReceipt(root, entry("B"))).rejects.toThrow(/not written over/);
    // review#1 F2: tidy's prune reports it and touches nothing, dry or not
    for (const dry of [true, false]) expect(await pruneRejectedReceipts(root, "2026-11-01T00:00:00.000Z", new Set(), dry)).toEqual({ removed: [], error: expect.stringContaining("left as it is") });
    expect(readFileSync(rejectedReceiptsPath(root), "utf8")).toBe("{ not json");
  });

  test("a keep waits for the lock another holder has, then writes beside what that holder wrote", async () => {
    const root = checkout();
    write(root, JSON.stringify({ receipts: [] }));
    const lock = await acquireLock(rejectedLockPath(root));
    expect(lock.ok).toBe(true);
    const adding = addRejectedReceipt(root, entry("B"));
    await new Promise((r) => setTimeout(r, 100));
    // the holder's own read-modify-write, while the keep waits
    write(root, JSON.stringify({ receipts: [entry("A")] }));
    if (lock.ok) lock.release();
    await adding;
    expect(onDisk(root)).toEqual([entry("A"), entry("B")]);
  });
});
