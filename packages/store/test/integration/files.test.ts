import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { listReceipts } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

describe("receipts (S6)", () => {
  test("concurrent appends from several processes get distinct numbers", async () => {
    const u = tmp();
    const script = join(import.meta.dir, "fixtures/append.ts");
    const procs = Array.from({ length: 4 }, () => Bun.spawn(["bun", script, u, "8"], { stderr: "inherit" }));
    expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0, 0]);
    const l = listReceipts(u);
    expect(l.errors).toEqual([]);
    expect(l.receipts.length).toBe(32);
    expect(new Set(l.receipts.map((r) => r.n)).size).toBe(32);
  });
});
