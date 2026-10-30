import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  appendReceipt,
  atomicWrite,
  createExclusive,
  findReceiptById,
  lastReceiptNumber,
  listReceipts,
  readJsonFile,
  readReceipt,
  readState,
  writeReceiptAt,
  writeState,
} from "../src/index.ts";
import { receipt, state, tmp } from "./helpers.ts";

describe("atomic files (S1, S2)", () => {
  test("atomicWrite creates parents, replaces content, leaves no temp files", () => {
    const d = tmp();
    const p = join(d, "a/b/c.json");
    atomicWrite(p, "one");
    atomicWrite(p, "two");
    expect(readFileSync(p, "utf8")).toBe("two");
    expect(readdirSync(join(d, "a/b"))).toEqual(["c.json"]);
  });
  test("createExclusive never overwrites", () => {
    const p = join(tmp(), "x");
    expect(createExclusive(p, "first")).toBe(true);
    expect(createExclusive(p, "second")).toBe(false);
    expect(readFileSync(p, "utf8")).toBe("first");
  });
  test("validated read: missing, corrupt JSON, schema failure, ok", () => {
    const d = tmp();
    const p = join(d, "state.json");
    expect(readJsonFile("state", p)).toEqual({ ok: false, reason: "missing" });
    writeFileSync(p, "{nope");
    const bad = readJsonFile("state", p, d);
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.reason === "corrupt") expect(bad.error.file).toBe("state.json");
    writeFileSync(p, JSON.stringify({ ...state(), attempt: 0 }));
    const inv = readJsonFile("state", p);
    expect(!inv.ok && inv.reason === "corrupt" && inv.error.errors[0]?.path).toBe("/attempt");
    writeFileSync(p, JSON.stringify(state()));
    expect(readJsonFile("state", p).ok).toBe(true);
  });
});

describe("receipts (S6)", () => {
  test("append numbers sequentially and names files NNNN-<kind>.json", () => {
    const u = tmp();
    const a = appendReceipt(u, receipt());
    const b = appendReceipt(u, receipt({ kind: "stuck", reason: "blocked" }));
    expect([a.n, b.n]).toEqual([1, 2]);
    expect(readdirSync(join(u, "receipts")).sort()).toEqual(["0001-done.json", "0002-stuck.json"]);
    expect(lastReceiptNumber(u)).toBe(2);
  });
  test("append is idempotent per receipt_id", () => {
    const u = tmp();
    const r = receipt();
    appendReceipt(u, r);
    const again = appendReceipt(u, r);
    expect(again).toMatchObject({ n: 1, existed: true });
    expect(findReceiptById(u, r.receipt_id)?.n).toBe(1);
  });
  test("writeReceiptAt: replay of same id ok, other occupant taken, never overwrites", () => {
    const u = tmp();
    const r1 = receipt();
    expect(writeReceiptAt(u, 3, r1)).toMatchObject({ ok: true, existed: false });
    expect(writeReceiptAt(u, 3, r1)).toMatchObject({ ok: true, existed: true });
    const other = receipt({ kind: "ask", question: "?" });
    expect(writeReceiptAt(u, 3, other)).toMatchObject({ ok: false, reason: "taken" });
    expect(readReceipt(u, 3)).toMatchObject({ n: 3, receipt: { receipt_id: r1.receipt_id } });
    // no reservation files left behind
    expect(readdirSync(join(u, "receipts"))).toEqual(["0003-done.json"]);
  });
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
  test("list: after filter, corrupt files and kind mismatch reported", () => {
    const u = tmp();
    appendReceipt(u, receipt());
    appendReceipt(u, receipt());
    mkdirSync(join(u, "receipts"), { recursive: true });
    writeFileSync(join(u, "receipts/0003-done.json"), "{}");
    writeFileSync(join(u, "receipts/0004-ask.json"), JSON.stringify(receipt()));
    const l = listReceipts(u, { after: 1, root: u });
    expect(l.receipts.map((r) => r.n)).toEqual([2]);
    expect(l.receipts[0]?.file).toBe("receipts/0002-done.json");
    expect(l.errors.map((e) => e.file)).toEqual(["receipts/0003-done.json", "receipts/0004-ask.json"]);
    expect(existsSync(join(u, "receipts/0003-done.json"))).toBe(true);
  });
});

describe("committed runs/ JSON is one line (gh-108)", () => {
  test("receipts and state.json are written as one line of JSON plus a newline", () => {
    const u = tmp();
    const r = receipt();
    appendReceipt(u, r);
    writeReceiptAt(u, 5, receipt({ kind: "stuck", reason: "blocked" }));
    writeState(u, state());
    for (const f of ["receipts/0001-done.json", "receipts/0005-stuck.json", "state.json"]) {
      const text = readFileSync(join(u, f), "utf8");
      expect(text.endsWith("}\n")).toBe(true);
      expect(text.slice(0, -1)).not.toContain("\n");
    }
    expect(readFileSync(join(u, "receipts/0001-done.json"), "utf8")).toBe(`${JSON.stringify(r)}\n`);
  });
  test("older pretty-printed receipts and state.json still read", () => {
    const u = tmp();
    const r = receipt();
    mkdirSync(join(u, "receipts"), { recursive: true });
    writeFileSync(join(u, "receipts/0001-done.json"), `${JSON.stringify(r, null, 2)}\n`);
    writeFileSync(join(u, "state.json"), `${JSON.stringify(state(), null, 2)}\n`);
    expect(readReceipt(u, 1)).toMatchObject({ n: 1, receipt: { receipt_id: r.receipt_id } });
    expect(appendReceipt(u, r)).toMatchObject({ n: 1, existed: true });
    expect(readState(u)).toMatchObject({ ok: true, value: { step: "implement" } });
  });
});
