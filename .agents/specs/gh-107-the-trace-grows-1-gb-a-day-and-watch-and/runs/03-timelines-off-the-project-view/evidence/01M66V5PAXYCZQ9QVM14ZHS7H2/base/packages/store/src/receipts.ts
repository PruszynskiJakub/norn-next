/**
 * Receipts `runs/<unit>/receipts/NNNN-<kind>.json` (S6): immutable, numbered, never
 * overwritten. Creation is exclusive (link-based O_EXCL) so two writers never share a number.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { FileError, NumberedReceipt } from "@norn/core";
import { type Receipt, assertValid, parseReceiptFileName, receiptFileName } from "@norn/schema";
import { createExclusive, displayPath, isErrno, json, readJsonFile, readText, safeUnlink } from "./fsx.ts";
import { receiptsDir } from "./paths.ts";

export interface ReceiptListing {
  /** valid receipts ascending by number */
  receipts: NumberedReceipt[];
  /** files failing validation, unparseable names, or duplicate numbers (S2) */
  errors: FileError[];
}

interface Entry {
  n: number;
  kind: string;
  file: string;
}

function entries(unitDir: string): { entries: Entry[]; errors: FileError[] } {
  const dir = receiptsDir(unitDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return { entries: [], errors: [] };
    throw e;
  }
  const out: Entry[] = [];
  const errors: FileError[] = [];
  const seen = new Map<number, string>();
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue; // temp files
    const p = parseReceiptFileName(name);
    if (!p) {
      errors.push({ file: join(dir, name), errors: [{ path: "", message: "not a receipt file name (NNNN-<kind>.json)" }] });
      continue;
    }
    const dup = seen.get(p.n);
    if (dup) {
      errors.push({ file: join(dir, name), errors: [{ path: "", message: `duplicate receipt number ${p.n} (also ${dup})` }] });
      continue;
    }
    seen.set(p.n, name);
    out.push({ n: p.n, kind: p.kind, file: join(dir, name) });
  }
  return { entries: out, errors };
}

/**
 * List receipts of a unit, ascending. `after` skips numbers ≤ after (unapplied ones:
 * `after = state.applied_through`). `root` makes paths in results repo-relative.
 */
export function listReceipts(unitDir: string, opts: { after?: number; root?: string } = {}): ReceiptListing {
  const listed = entries(unitDir);
  const errors = listed.errors.map((x) => ({ ...x, file: displayPath(x.file, opts.root) }));
  const es = listed.entries;
  const receipts: NumberedReceipt[] = [];
  for (const e of es) {
    if (opts.after !== undefined && e.n <= opts.after) continue;
    const r = readJsonFile("receipt", e.file, opts.root);
    if (r.ok) {
      if (r.value.kind !== e.kind)
        errors.push({ file: displayPath(e.file, opts.root), errors: [{ path: "/kind", message: `kind '${r.value.kind}' does not match file name` }] });
      else receipts.push({ n: e.n, file: displayPath(e.file, opts.root), receipt: r.value });
    } else if (r.reason === "corrupt") errors.push(r.error);
  }
  return { receipts, errors };
}

export function readReceipt(unitDir: string, n: number, root?: string): NumberedReceipt | FileError | null {
  const e = entries(unitDir).entries.find((x) => x.n === n);
  if (!e) return null;
  const r = readJsonFile("receipt", e.file, root);
  if (r.ok) return { n, file: displayPath(e.file, root), receipt: r.value };
  return r.reason === "corrupt" ? r.error : null;
}

/** Highest receipt number present or reserved (valid or not); 0 when none. */
export function lastReceiptNumber(unitDir: string): number {
  let max = entries(unitDir).entries.reduce((m, e) => Math.max(m, e.n), 0);
  try {
    for (const name of readdirSync(receiptsDir(unitDir))) {
      const m = /^\.(\d{4})\.reserve$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
  }
  return max;
}

export type WriteReceiptResult =
  | { ok: true; n: number; file: string; existed: boolean }
  | { ok: false; reason: "taken"; n: number; file: string };

/** Hidden per-number reservation; makes numbers exclusive across kinds. */
const reservePath = (unitDir: string, n: number) => join(receiptsDir(unitDir), `.${String(n).padStart(4, "0")}.reserve`);

/**
 * Write receipt number `n` exactly (decide numbers receipts; actions.ts step 1).
 * A number is reserved with an exclusive hidden `.NNNN.reserve` file (holding the
 * receipt_id) while the receipt is created, so two writers never share a number even
 * with different kinds; the reservation is removed afterwards.
 * If NNNN already holds (or is reserved for) the same receipt_id, it counts as written
 * (replay after a crash). Any other occupant → `taken`. Never overwrites.
 */
export function writeReceiptAt(unitDir: string, n: number, receipt: Receipt): WriteReceiptResult {
  assertValid("receipt", receipt);
  const file = join(receiptsDir(unitDir), receiptFileName(n, receipt.kind));
  const existing = entries(unitDir).entries.find((e) => e.n === n);
  if (existing)
    return sameReceipt(existing.file, receipt)
      ? { ok: true, n, file: existing.file, existed: true }
      : { ok: false, reason: "taken", n, file: existing.file };
  const reserve = reservePath(unitDir, n);
  if (!createExclusive(reserve, receipt.receipt_id) && readText(reserve) !== receipt.receipt_id)
    return { ok: false, reason: "taken", n, file: reserve };
  // re-check under the reservation: a writer that finished and dropped its reservation
  // between our first look and our reserve has already created its file
  const raced = entries(unitDir).entries.find((e) => e.n === n);
  if (raced && !sameReceipt(raced.file, receipt)) {
    safeUnlink(reserve);
    return { ok: false, reason: "taken", n, file: raced.file };
  }
  const created = raced ? false : createExclusive(file, json(receipt));
  const result: WriteReceiptResult =
    created || sameReceipt(raced?.file ?? file, receipt)
      ? { ok: true, n, file: raced?.file ?? file, existed: !created }
      : { ok: false, reason: "taken", n, file };
  safeUnlink(reserve);
  return result;
}

function sameReceipt(file: string, receipt: Receipt): boolean {
  const r = readJsonFile("receipt", file);
  return r.ok && r.value.receipt_id === receipt.receipt_id;
}

/**
 * Append `receipt` as the next free number (CLI verbs, act's check/git results,
 * mailbox import). Retries on races; idempotent per receipt_id.
 */
export function appendReceipt(unitDir: string, receipt: Receipt): { n: number; file: string; existed: boolean } {
  assertValid("receipt", receipt);
  const dup = findReceiptById(unitDir, receipt.receipt_id);
  if (dup) return { n: dup.n, file: dup.file, existed: true };
  for (let attempt = 0; attempt < 100; attempt++) {
    const n = lastReceiptNumber(unitDir) + 1;
    const r = writeReceiptAt(unitDir, n, receipt);
    if (r.ok) return { n: r.n, file: r.file, existed: r.existed };
  }
  throw new Error(`could not append receipt in ${unitDir}: too many concurrent writers`);
}

/** Receipt with this receipt_id, if any (absolute file path). */
export function findReceiptById(unitDir: string, receiptId: string): NumberedReceipt | null {
  for (const e of entries(unitDir).entries) {
    const r = readJsonFile("receipt", e.file);
    if (r.ok && r.value.receipt_id === receiptId) return { n: e.n, file: e.file, receipt: r.value };
  }
  return null;
}
