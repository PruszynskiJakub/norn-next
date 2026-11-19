/**
 * The store contract as a reusable suite: what the kernel may assume of any store plugin (a folder on
 * this machine, git refs shared by a team, ...). Receipts are numbered without gaps and never change,
 * state moves only by compare-and-swap, racing writers never both win against one expected version,
 * claims expire by the host's clock, and the kernel's JSON comes back exactly as it went in.
 */
import { describe, expect } from "bun:test";
import {
  type ClaimRecord,
  type PluginResult,
  type Store,
  type StoredMessage,
  type UnitRecord,
  validateClaimRecord,
  validateStoredMessage,
  validateUnitRecord,
} from "@norn/plugin-api";
import { compareVersions } from "@norn/schema";
import { type ContractOptions, contractTest, expectValid, failureOf, valueOf } from "./contract.ts";
import { receiptId } from "./tracker-contract.ts";

export interface StoreWorld {
  store: Store;
  /**
   * A second store over the same backing data, as another process on this machine would open it.
   * The race tests split their writers between the two; without it they all go through `store`.
   */
  twin?(): Store | Promise<Store>;
  /** the host clock the store reads */
  now(): string;
  /** move that clock forward */
  advance(ms: number): void;
  /** while on, every write fails, as a full disk or an unreachable remote would; reads may fail too */
  failing(on: boolean): void;
}

export type StoreContractTest =
  | "names itself, with capabilities that match the parts it offers"
  | "a unit nothing was written to reads as no state and no receipts"
  | "receipts get gapless seqs from 1 and read back in order"
  | "a receipt is idempotent by id and never changes"
  | "seqs and receipt ids are per unit"
  | "commitState creates with null, then moves one version per commit"
  | "a stale or wrong expected version is a conflict and writes nothing"
  | "racing appenders never share or skip a seq"
  | "racing appends of one id land once"
  | "racing committers against one version: exactly one wins"
  | "listUnits lists written units sorted, and a story's own and slice units"
  | "archive hides a story's units from the default listing, and they still read"
  | "claims: acquire, renew by the holder, release"
  | "claims: another holder is refused until the claim expires"
  | "claims: expectVersion guards acquire"
  | "racing acquirers: exactly one holds the claim"
  | "claims: takeOver moves a claim at the expected version, live or not"
  | "racing takeovers: exactly one holds the claim"
  | "mailbox: send is idempotent by id, receive keeps send order, ack removes"
  | "racing senders all land, once each"
  | "artifacts round-trip, list sorted and normalized, remove a missing one is fine"
  | "artifacts refuse absolute and escaping paths"
  | "artifacts: a name is a file or a folder, never both"
  | "artifacts: paths that differ only in case are two artifacts"
  | "malformed units, stories, ids and durations are refused as invalid"
  | "odd JSON and text round-trip exactly"
  | "a failing store answers writes with failures and nothing lands"
  | "a shared store syncs and flushes"
  | "floor: none until raised, then it only rises"
  | "racing raises leave the highest floor";

/** How many writers each race test starts. */
const RACERS = 8;

const UNIT = "gh-12";
const SLICE = "gh-12/03";

const deep = (n: number): unknown => (n === 0 ? { leaf: "bottom" } : n % 2 === 0 ? { level: n, next: deep(n - 1) } : [n, deep(n - 1)]);

/** JSON no store may lose a byte of: unicode, escapes, odd keys, extreme numbers, deep and large values. */
export function oddJson(): unknown {
  return {
    unicode: "zażółć gęślą jaźń · 日本語 · 🧵👩‍💻 · ‮right-to-left‬",
    escapes: 'quote " backslash \\ newline \n tab \t nul \u0000 lone \ud800 surrogate',
    keys: { "": "empty key", "a/b": 1, "with space": 2, 日本: 3, "0": "integer-like", "..": "dots" },
    numbers: [0, 1, -1, 1.5, 1e300, -2.5e-300, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
    literals: [true, false, null],
    empty: { obj: {}, arr: [], str: "" },
    nested: deep(64),
    large: { text: "x".repeat(200_000), rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: `row ${i}`, ok: i % 3 === 0 })) },
  };
}

/** Text an artifact must give back byte for byte: CRLF, no trailing newline, unicode. */
const ODD_TEXT = "# Spec — ünïcödé 🧵\r\nline two\n\n\ttabbed   \u0000end without newline";

/** Exact equality, key order included: a store that reorders or retypes anything is caught. */
const same = (got: unknown, want: unknown): void => {
  expect(JSON.stringify(got)).toBe(JSON.stringify(want));
};

const plusMs = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

function need<T>(what: string, v: T | undefined): T {
  if (v === undefined) throw new Error(`the store offers no ${what}, though its capabilities say it does`);
  return v;
}

export function storeContract(name: string, makeWorld: () => StoreWorld | Promise<StoreWorld>, opts: ContractOptions<StoreContractTest> = {}): void {
  describe(`store contract: ${name}`, () => {
    const t = (n: StoreContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);

    const made = async () => {
      const world = await makeWorld();
      const st = world.store;
      const twin = world.twin ? await world.twin() : st;
      /** writers alternate between the store and its twin, so a lock held per instance is not enough */
      const racer = (i: number): Store => (i % 2 === 0 ? st : twin);
      const read = async (unit: string, via: Store = st): Promise<UnitRecord> => {
        const r = valueOf(await via.readUnit(unit));
        expectValid(`unit ${unit}`, validateUnitRecord(r));
        return r;
      };
      const append = async (unit: string, n: number, data: unknown = { n }) => valueOf(await st.appendReceipt(unit, { id: receiptId(n), data }));
      const claim = (c: ClaimRecord): ClaimRecord => {
        expectValid("claim", validateClaimRecord(c));
        return c;
      };
      const messages = (ms: StoredMessage[]): StoredMessage[] => {
        for (const m of ms) expectValid(`message ${m.id}`, validateStoredMessage(m));
        return ms;
      };
      return { world, st, twin, racer, read, append, claim, messages };
    };

    t("names itself, with capabilities that match the parts it offers", async () => {
      const { st } = await made();
      expect(st.name.length).toBeGreaterThan(0);
      expect(["local", "distributed"]).toContain(st.capabilities.claims);
      expect(st.mailbox !== undefined).toBe(st.capabilities.mailbox);
      expect(st.artifacts !== undefined).toBe(st.capabilities.artifacts);
      if (st.capabilities.shared) {
        expect(typeof st.sync).toBe("function");
        expect(typeof st.flush).toBe("function");
      }
    });

    t("a unit nothing was written to reads as no state and no receipts", async () => {
      const { read } = await made();
      expect(await read(UNIT)).toEqual({ state: null, receipts: [] });
      expect(await read(SLICE)).toEqual({ state: null, receipts: [] });
    });

    t("receipts get gapless seqs from 1 and read back in order", async () => {
      const { world, read, append } = await made();
      const at = world.now();
      for (const n of [1, 2, 3]) expect(await append(UNIT, n)).toEqual({ seq: n, replayed: false });
      const { receipts, state } = await read(UNIT);
      expect(state).toBeNull();
      expect(receipts.map((r) => ({ seq: r.seq, id: r.id, data: r.data }))).toEqual([1, 2, 3].map((n) => ({ seq: n, id: receiptId(n), data: { n } })));
      for (const r of receipts) expect(Date.parse(r.at)).toBeGreaterThanOrEqual(Date.parse(at));
    });

    t("a receipt is idempotent by id and never changes", async () => {
      const { read, append } = await made();
      await append(UNIT, 1, { kind: "first" });
      await append(UNIT, 2);
      const before = await read(UNIT);
      expect(await append(UNIT, 1, { kind: "rewritten" })).toEqual({ seq: 1, replayed: true });
      expect(await read(UNIT)).toEqual(before);
      expect(await append(UNIT, 3)).toEqual({ seq: 3, replayed: false });
    });

    t("seqs and receipt ids are per unit", async () => {
      const { read, append } = await made();
      await append(UNIT, 1);
      await append(UNIT, 2);
      expect(await append(SLICE, 1)).toEqual({ seq: 1, replayed: false });
      expect(await append("gh-7", 2)).toEqual({ seq: 1, replayed: false });
      expect((await read(SLICE)).receipts.map((r) => r.id)).toEqual([receiptId(1)]);
      expect((await read(UNIT)).receipts).toHaveLength(2);
    });

    t("commitState creates with null, then moves one version per commit", async () => {
      const { st, read } = await made();
      expect(valueOf(await st.commitState(UNIT, { step: "plan" }, null))).toEqual({ version: 1 });
      expect((await read(UNIT)).state).toEqual({ version: 1, data: { step: "plan" } });
      expect(valueOf(await st.commitState(UNIT, { step: "build" }, 1))).toEqual({ version: 2 });
      expect(valueOf(await st.commitState(UNIT, null, 2))).toEqual({ version: 3 });
      expect((await read(UNIT)).state).toEqual({ version: 3, data: null });
      expect((await read(SLICE)).state).toBeNull();
    });

    t("a stale or wrong expected version is a conflict and writes nothing", async () => {
      const { st, read } = await made();
      expect(failureOf(await st.commitState(UNIT, { step: "x" }, 1)).code).toBe("conflict");
      expect((await read(UNIT)).state).toBeNull();
      valueOf(await st.commitState(UNIT, { step: "plan" }, null));
      valueOf(await st.commitState(UNIT, { step: "build" }, 1));
      for (const stale of [null, 1, 3]) expect({ stale, code: failureOf(await st.commitState(UNIT, { step: "lost" }, stale)).code }).toEqual({ stale, code: "conflict" });
      expect((await read(UNIT)).state).toEqual({ version: 2, data: { step: "build" } });
    });

    t("racing appenders never share or skip a seq", async () => {
      const { racer, read } = await made();
      const answers = await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).appendReceipt(UNIT, { id: receiptId(i + 1), data: { i } })));
      const seqs = answers.map((a) => valueOf(a)).map((a) => (expect(a.replayed).toBe(false), a.seq));
      expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: RACERS }, (_, i) => i + 1));
      const { receipts } = await read(UNIT);
      expect(receipts.map((r) => r.seq)).toEqual(Array.from({ length: RACERS }, (_, i) => i + 1));
      for (const [i, a] of answers.entries()) expect(receipts.find((r) => r.id === receiptId(i + 1))?.seq).toBe(valueOf(a).seq);
    });

    t("racing appends of one id land once", async () => {
      const { racer, read } = await made();
      const answers = (await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).appendReceipt(UNIT, { id: receiptId(1), data: { i } })))).map((a) => valueOf(a));
      expect(answers.filter((a) => !a.replayed)).toHaveLength(1);
      expect(new Set(answers.map((a) => a.seq))).toEqual(new Set([1]));
      expect((await read(UNIT)).receipts).toHaveLength(1);
    });

    t("racing committers against one version: exactly one wins", async () => {
      const { st, racer, read } = await made();
      const created = await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).commitState(UNIT, { writer: i }, null)));
      const won = created.flatMap((r, i) => (r.ok ? [i] : []));
      expect(won).toHaveLength(1);
      for (const r of created) if (!r.ok) expect(r.failure.code).toBe("conflict");
      expect((await read(UNIT)).state).toEqual({ version: 1, data: { writer: won[0] } });
      const moved = await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).commitState(UNIT, { writer: i, round: 2 }, 1)));
      const won2 = moved.flatMap((r, i) => (r.ok ? [i] : []));
      expect(won2).toHaveLength(1);
      expect((await read(UNIT, st)).state).toEqual({ version: 2, data: { writer: won2[0], round: 2 } });
    });

    t("listUnits lists written units sorted, and a story's own and slice units", async () => {
      const { st, append } = await made();
      expect(valueOf(await st.listUnits())).toEqual([]);
      await append("gh-12/03", 1);
      await append("gh-7", 1);
      valueOf(await st.commitState("gh-12", { step: "x" }, null));
      await append("gh-12/01", 1);
      await append("gh-120", 1);
      expect(valueOf(await st.listUnits())).toEqual(["gh-12", "gh-12/01", "gh-12/03", "gh-120", "gh-7"]);
      expect(valueOf(await st.listUnits({ story: "gh-12" }))).toEqual(["gh-12", "gh-12/01", "gh-12/03"]);
      expect(valueOf(await st.listUnits({ story: "gh-99" }))).toEqual([]);
      expect(valueOf(await st.listUnits({ archived: true }))).toEqual([]);
    });

    t("archive hides a story's units from the default listing, and they still read", async () => {
      const { st, read, append } = await made();
      await append("gh-12", 1);
      valueOf(await st.commitState("gh-12/01", { done: true }, null));
      await append("gh-7", 1);
      const before = await read("gh-12/01");
      expect([...valueOf(await st.archive("gh-12")).archived].sort()).toEqual(["gh-12", "gh-12/01"]);
      expect(valueOf(await st.listUnits())).toEqual(["gh-7"]);
      expect(valueOf(await st.listUnits({ archived: true }))).toEqual(["gh-12", "gh-12/01"]);
      expect(valueOf(await st.listUnits({ story: "gh-12", archived: true }))).toEqual(["gh-12", "gh-12/01"]);
      expect(await read("gh-12/01")).toEqual(before);
      expect((await read("gh-12")).receipts.map((r) => r.id)).toEqual([receiptId(1)]);
      expect(valueOf(await st.archive("gh-12")).archived).toEqual([]);
    });

    t("claims: acquire, renew by the holder, release", async () => {
      const { world, st, claim } = await made();
      expect(valueOf(await st.claims.read(UNIT))).toBeNull();
      const t0 = world.now();
      const first = claim(valueOf(await st.claims.acquire(UNIT, "machine-a", 60_000)));
      expect(first).toMatchObject({ story: UNIT, holder: "machine-a", acquired_at: t0, expires_at: plusMs(t0, 60_000) });
      expect(valueOf(await st.claims.read(UNIT))).toEqual(first);
      world.advance(30_000);
      const renewed = claim(valueOf(await st.claims.renew(UNIT, "machine-a", 60_000)));
      expect(renewed).toMatchObject({ holder: "machine-a", acquired_at: t0, expires_at: plusMs(world.now(), 60_000) });
      expect(renewed.version).toBeGreaterThan(first.version);
      world.advance(1_000);
      const again = claim(valueOf(await st.claims.acquire(UNIT, "machine-a", 10_000)));
      expect(again).toMatchObject({ acquired_at: t0, expires_at: plusMs(world.now(), 10_000) });
      expect(again.version).toBeGreaterThan(renewed.version);
      expect(valueOf(await st.claims.release(UNIT, "machine-a"))).toBeNull();
      expect(valueOf(await st.claims.read(UNIT))).toBeNull();
      expect(valueOf(await st.claims.release(UNIT, "machine-a"))).toBeNull();
      expect(failureOf(await st.claims.renew(UNIT, "machine-a", 1_000)).code).toBe("not_found");
    });

    t("claims: another holder is refused until the claim expires", async () => {
      const { world, st, claim } = await made();
      const held = claim(valueOf(await st.claims.acquire(UNIT, "machine-a", 60_000)));
      expect(failureOf(await st.claims.acquire(UNIT, "machine-b", 60_000)).code).toBe("conflict");
      expect(failureOf(await st.claims.renew(UNIT, "machine-b", 60_000)).code).toBe("conflict");
      expect(failureOf(await st.claims.release(UNIT, "machine-b")).code).toBe("conflict");
      expect(valueOf(await st.claims.read(UNIT))).toEqual(held);
      expect(valueOf(await st.claims.read("gh-7"))).toBeNull();
      world.advance(59_999);
      expect(failureOf(await st.claims.acquire(UNIT, "machine-b", 60_000)).code).toBe("conflict");
      world.advance(1);
      const taken = claim(valueOf(await st.claims.acquire(UNIT, "machine-b", 60_000)));
      expect(taken).toMatchObject({ holder: "machine-b", acquired_at: world.now() });
      expect(taken.version).toBeGreaterThan(held.version);
      expect(failureOf(await st.claims.renew(UNIT, "machine-a", 60_000)).code).toBe("conflict");
    });

    t("claims: expectVersion guards acquire", async () => {
      const { world, st, claim } = await made();
      const held = claim(valueOf(await st.claims.acquire(UNIT, "machine-a", 1_000, null)));
      expect(failureOf(await st.claims.acquire("gh-7", "machine-a", 1_000, 1)).code).toBe("conflict");
      world.advance(5_000);
      expect(failureOf(await st.claims.acquire(UNIT, "machine-b", 1_000, null)).code).toBe("conflict");
      expect(failureOf(await st.claims.acquire(UNIT, "machine-b", 1_000, held.version + 1)).code).toBe("conflict");
      expect(valueOf(await st.claims.read(UNIT))).toEqual(held);
      expect(claim(valueOf(await st.claims.acquire(UNIT, "machine-b", 1_000, held.version))).holder).toBe("machine-b");
    });

    t("racing acquirers: exactly one holds the claim", async () => {
      const { world, racer, st } = await made();
      const answers = await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).claims.acquire(UNIT, `machine-${i}`, 60_000)));
      const won = answers.flatMap((r, i) => (r.ok ? [i] : []));
      expect(won).toHaveLength(1);
      for (const r of answers) if (!r.ok) expect(r.failure.code).toBe("conflict");
      expect(valueOf(await st.claims.read(UNIT))?.holder).toBe(`machine-${won[0]}`);
      world.advance(60_000);
      const read = valueOf(await st.claims.read(UNIT));
      const retake = await Promise.all(Array.from({ length: RACERS }, (_, i) => racer(i).claims.acquire(UNIT, `late-${i}`, 60_000, read?.version)));
      expect(retake.filter((r) => r.ok)).toHaveLength(1);
    });

    t("claims: takeOver moves a claim at the expected version, live or not", async () => {
      const { world, st, claim } = await made();
      if (!st.capabilities.takeover) return;
      const takeOver = need("claims.takeOver", st.claims.takeOver);
      expect(failureOf(await takeOver(UNIT, "machine-a", 60_000, 1)).code).toBe("conflict");
      const free = claim(valueOf(await takeOver(UNIT, "machine-a", 60_000, null)));
      expect(free).toMatchObject({ holder: "machine-a", acquired_at: world.now() });
      world.advance(1_000);
      expect(failureOf(await takeOver(UNIT, "machine-b", 60_000, null)).code).toBe("conflict");
      expect(failureOf(await takeOver(UNIT, "machine-b", 60_000, free.version + 1)).code).toBe("conflict");
      expect(valueOf(await st.claims.read(UNIT))).toEqual(free);
      const live = claim(valueOf(await takeOver(UNIT, "machine-b", 30_000, free.version)));
      expect(live).toMatchObject({ holder: "machine-b", acquired_at: world.now(), expires_at: plusMs(world.now(), 30_000) });
      expect(live.version).toBeGreaterThan(free.version);
      expect(failureOf(await st.claims.renew(UNIT, "machine-a", 60_000)).code).toBe("conflict");
      world.advance(1_000);
      const mine = claim(valueOf(await takeOver(UNIT, "machine-b", 30_000, live.version)));
      expect(mine.acquired_at).toBe(live.acquired_at);
      world.advance(60_000);
      expect(claim(valueOf(await takeOver(UNIT, "machine-a", 60_000, mine.version))).acquired_at).toBe(world.now());
    });

    t("racing takeovers: exactly one holds the claim", async () => {
      const { st, racer } = await made();
      if (!st.capabilities.takeover) return;
      const held = valueOf(await st.claims.acquire(UNIT, "machine-a", 60_000));
      const answers = await Promise.all(Array.from({ length: RACERS }, (_, i) => need("claims.takeOver", racer(i).claims.takeOver)(UNIT, `person-${i}`, 60_000, held.version)));
      const won = answers.flatMap((r, i) => (r.ok ? [i] : []));
      expect(won).toHaveLength(1);
      for (const r of answers) if (!r.ok) expect(r.failure.code).toBe("conflict");
      expect(valueOf(await st.claims.read(UNIT))?.holder).toBe(`person-${won[0]}`);
    });

    t("mailbox: send is idempotent by id, receive keeps send order, ack removes", async () => {
      const { st, messages } = await made();
      if (!st.capabilities.mailbox) return;
      const mb = need("mailbox", st.mailbox);
      expect(valueOf(await mb.receive(UNIT))).toEqual([]);
      for (const id of ["m-c", "m-a", "m-b"]) expect(valueOf(await mb.send(UNIT, { id, from: "person", data: { say: id } }))).toEqual({ replayed: false });
      expect(valueOf(await mb.send(UNIT, { id: "m-a", from: "someone-else", data: { say: "again" } }))).toEqual({ replayed: true });
      const got = messages(valueOf(await mb.receive(UNIT)));
      expect(got.map((m) => ({ id: m.id, from: m.from, data: m.data }))).toEqual(["m-c", "m-a", "m-b"].map((id) => ({ id, from: "person", data: { say: id } })));
      expect(valueOf(await mb.receive("gh-7"))).toEqual([]);
      expect(valueOf(await mb.ack(UNIT, ["m-a", "no-such-message"]))).toBeNull();
      expect(valueOf(await mb.receive(UNIT)).map((m) => m.id)).toEqual(["m-c", "m-b"]);
      expect(valueOf(await mb.send(UNIT, { id: "m-a", from: "person", data: {} }))).toEqual({ replayed: true });
      expect(valueOf(await mb.receive(UNIT)).map((m) => m.id)).toEqual(["m-c", "m-b"]);
      valueOf(await mb.ack(UNIT, ["m-c", "m-b"]));
      expect(valueOf(await mb.receive(UNIT))).toEqual([]);
    });

    t("racing senders all land, once each", async () => {
      const { st, racer } = await made();
      if (!st.capabilities.mailbox) return;
      const ids = Array.from({ length: RACERS }, (_, i) => `m-${i}`);
      const sent = await Promise.all([...ids, ...ids].map((id, i) => need("mailbox", racer(i).mailbox).send(UNIT, { id, from: "person", data: { id } })));
      expect(sent.map((r) => valueOf(r)).filter((r) => !r.replayed)).toHaveLength(RACERS);
      const got = valueOf(await need("mailbox", st.mailbox).receive(UNIT)).map((m) => m.id);
      expect([...got].sort()).toEqual([...ids].sort());
    });

    t("artifacts round-trip, list sorted and normalized, remove a missing one is fine", async () => {
      const { st } = await made();
      if (!st.capabilities.artifacts) return;
      const ar = need("artifacts", st.artifacts);
      expect(valueOf(await ar.list(UNIT))).toEqual([]);
      expect(valueOf(await ar.read(UNIT, "spec.md"))).toBeNull();
      valueOf(await ar.write(UNIT, "spec.md", "# Spec\n"));
      valueOf(await ar.write(UNIT, "handoffs/./03.md", "handoff 03"));
      valueOf(await ar.write(UNIT, "handoffs//01.md", "handoff 01"));
      valueOf(await ar.write("gh-7", "spec.md", "another story"));
      expect(valueOf(await ar.list(UNIT))).toEqual(["handoffs/01.md", "handoffs/03.md", "spec.md"]);
      expect(valueOf(await ar.read(UNIT, "handoffs/03.md"))).toBe("handoff 03");
      expect(valueOf(await ar.read(UNIT, "./handoffs/01.md"))).toBe("handoff 01");
      valueOf(await ar.write(UNIT, "spec.md", "# Spec v2\n"));
      expect(valueOf(await ar.read(UNIT, "spec.md"))).toBe("# Spec v2\n");
      valueOf(await ar.remove(UNIT, "spec.md"));
      valueOf(await ar.remove(UNIT, "spec.md"));
      expect(valueOf(await ar.list(UNIT))).toEqual(["handoffs/01.md", "handoffs/03.md"]);
      expect(valueOf(await ar.read("gh-7", "spec.md"))).toBe("another story");
    });

    t("artifacts refuse absolute and escaping paths", async () => {
      const { st } = await made();
      if (!st.capabilities.artifacts) return;
      const ar = need("artifacts", st.artifacts);
      for (const bad of ["/etc/passwd", "../escape.md", "handoffs/../../escape.md", "", "handoffs/", "a\\b.md"]) {
        expect({ bad, code: failureOf(await ar.write(UNIT, bad, "x")).code }).toEqual({ bad, code: "invalid" });
        expect({ bad, code: failureOf(await ar.read(UNIT, bad)).code }).toEqual({ bad, code: "invalid" });
        expect({ bad, code: failureOf(await ar.remove(UNIT, bad)).code }).toEqual({ bad, code: "invalid" });
      }
      expect(valueOf(await ar.list(UNIT))).toEqual([]);
    });

    t("artifacts: a name is a file or a folder, never both", async () => {
      const { st } = await made();
      if (!st.capabilities.artifacts) return;
      const ar = need("artifacts", st.artifacts);
      valueOf(await ar.write(UNIT, "a", "file a"));
      expect(failureOf(await ar.write(UNIT, "a/b", "under a")).code).toBe("conflict");
      valueOf(await ar.write(UNIT, "c/d", "file c/d"));
      expect(failureOf(await ar.write(UNIT, "c", "over c")).code).toBe("conflict");
      expect(failureOf(await ar.write(UNIT, "c/d/e", "under c/d")).code).toBe("conflict");
      valueOf(await ar.write(UNIT, "c/e", "beside c/d"));
      valueOf(await ar.write(UNIT, "a", "file a v2"));
      expect(valueOf(await ar.list(UNIT))).toEqual(["a", "c/d", "c/e"]);
      expect(valueOf(await ar.read(UNIT, "a"))).toBe("file a v2");
      expect(valueOf(await ar.read(UNIT, "a/b"))).toBeNull();
      // once the file is gone the name is free to become a folder
      valueOf(await ar.remove(UNIT, "a"));
      valueOf(await ar.write(UNIT, "a/b", "under a"));
      expect(valueOf(await ar.list(UNIT))).toEqual(["a/b", "c/d", "c/e"]);
    });

    t("artifacts: paths that differ only in case are two artifacts", async () => {
      const { st } = await made();
      if (!st.capabilities.artifacts) return;
      const ar = need("artifacts", st.artifacts);
      valueOf(await ar.write(UNIT, "README.md", "upper"));
      valueOf(await ar.write(UNIT, "readme.md", "lower"));
      valueOf(await ar.write(UNIT, "Specs/Plan.md", "mixed"));
      expect(valueOf(await ar.read(UNIT, "README.md"))).toBe("upper");
      expect(valueOf(await ar.read(UNIT, "readme.md"))).toBe("lower");
      expect(valueOf(await ar.list(UNIT))).toEqual(["README.md", "Specs/Plan.md", "readme.md"]);
    });

    t("malformed units, stories, ids and durations are refused as invalid", async () => {
      const { st, read } = await made();
      const invalid = async <T>(what: string, r: Promise<PluginResult<T>>) => {
        expect({ what, code: failureOf(await r).code }).toEqual({ what, code: "invalid" });
      };
      await invalid("readUnit of a non-unit", st.readUnit("not a unit"));
      await invalid("append to a non-unit", st.appendReceipt("../gh-1", { id: receiptId(1), data: {} }));
      await invalid("append with a path as id", st.appendReceipt(UNIT, { id: "a/b", data: {} }));
      await invalid("commit to a non-unit", st.commitState("GH-1", {}, null));
      await invalid("listUnits of a slice", st.listUnits({ story: SLICE }));
      await invalid("archive of a slice", st.archive(SLICE));
      await invalid("claim of a slice", st.claims.read(SLICE));
      await invalid("claim for no time", st.claims.acquire(UNIT, "machine-a", 0));
      await invalid("claim by nobody", st.claims.acquire(UNIT, "", 1_000));
      if (st.mailbox) await invalid("message with a path as id", st.mailbox.send(UNIT, { id: "../m", from: "person", data: {} }));
      if (st.artifacts) await invalid("artifact of a slice", st.artifacts.write(SLICE, "a.md", "x"));
      expect(await read(UNIT)).toEqual({ state: null, receipts: [] });
      expect(valueOf(await st.claims.read(UNIT))).toBeNull();
    });

    t("odd JSON and text round-trip exactly", async () => {
      const { st, read, messages } = await made();
      const odd = oddJson();
      valueOf(await st.appendReceipt(UNIT, { id: receiptId(1), data: odd }));
      valueOf(await st.commitState(UNIT, odd, null));
      const got = await read(UNIT);
      same(got.receipts[0]?.data, odd);
      same(got.state?.data, odd);
      for (const scalar of ["just a string", 42, false, null]) {
        valueOf(await st.appendReceipt(SLICE, { id: `scalar-${String(scalar).replace(/ /g, "-")}`, data: scalar }));
      }
      same((await read(SLICE)).receipts.map((r) => r.data), ["just a string", 42, false, null]);
      if (st.mailbox) {
        valueOf(await st.mailbox.send(UNIT, { id: "odd", from: "person · 日本", data: odd }));
        const [m] = messages(valueOf(await st.mailbox.receive(UNIT)));
        same(m?.data, odd);
        expect(m?.from).toBe("person · 日本");
      }
      if (st.artifacts) {
        valueOf(await st.artifacts.write(UNIT, "notes/ünïcödé 🧵.md", ODD_TEXT));
        expect(valueOf(await st.artifacts.read(UNIT, "notes/ünïcödé 🧵.md"))).toBe(ODD_TEXT);
        expect(valueOf(await st.artifacts.list(UNIT))).toEqual(["notes/ünïcödé 🧵.md"]);
      }
    });

    t("a failing store answers writes with failures and nothing lands", async () => {
      const { world, st, read, append } = await made();
      await append(UNIT, 1);
      valueOf(await st.commitState(UNIT, { step: "plan" }, null));
      const held = valueOf(await st.claims.acquire(UNIT, "machine-a", 60_000));
      if (st.mailbox) valueOf(await st.mailbox.send(UNIT, { id: "m-1", from: "person", data: {} }));
      if (st.artifacts) valueOf(await st.artifacts.write(UNIT, "spec.md", "kept"));
      const before = await read(UNIT);
      world.failing(true);
      failureOf(await st.appendReceipt(UNIT, { id: receiptId(2), data: {} }));
      failureOf(await st.appendReceipt(SLICE, { id: receiptId(1), data: {} }));
      failureOf(await st.commitState(UNIT, { step: "lost" }, 1));
      failureOf(await st.claims.renew(UNIT, "machine-a", 600_000));
      failureOf(await st.claims.release(UNIT, "machine-a"));
      failureOf(await st.claims.acquire("gh-7", "machine-a", 60_000));
      if (st.mailbox) {
        failureOf(await st.mailbox.send(UNIT, { id: "m-2", from: "person", data: {} }));
        failureOf(await st.mailbox.ack(UNIT, ["m-1"]));
      }
      if (st.artifacts) {
        failureOf(await st.artifacts.write(UNIT, "spec.md", "lost"));
        failureOf(await st.artifacts.remove(UNIT, "spec.md"));
      }
      failureOf(await st.archive(UNIT));
      if (st.floor) failureOf(await st.floor.raise("2.0.0"));
      world.failing(false);
      expect(await read(UNIT)).toEqual(before);
      expect(await read(SLICE)).toEqual({ state: null, receipts: [] });
      expect(valueOf(await st.claims.read(UNIT))).toEqual(held);
      expect(valueOf(await st.claims.read("gh-7"))).toBeNull();
      expect(valueOf(await st.listUnits())).toEqual([UNIT]);
      if (st.mailbox) expect(valueOf(await st.mailbox.receive(UNIT)).map((m) => m.id)).toEqual(["m-1"]);
      if (st.artifacts) expect(valueOf(await st.artifacts.read(UNIT, "spec.md"))).toBe("kept");
      expect(await append(UNIT, 2)).toEqual({ seq: 2, replayed: false });
      if (st.floor) expect(valueOf(await st.floor.read())).toBeNull();
    });

    t("a shared store syncs and flushes", async () => {
      const { st, append } = await made();
      if (!st.capabilities.shared) return;
      await append(UNIT, 1);
      valueOf(await st.commitState(UNIT, { step: "plan" }, null));
      const flush = need("flush", st.flush).bind(st);
      expect(valueOf(await flush(UNIT)).pushed).toBe(true);
      expect(valueOf(await flush(UNIT)).pushed).toBe(false);
      expect(valueOf(await need("sync", st.sync).call(st)).fetched).toBeGreaterThanOrEqual(0);
    });

    t("floor: none until raised, then it only rises", async () => {
      const { st, twin } = await made();
      if (!st.floor) return;
      const floor = st.floor;
      expect(valueOf(await floor.read())).toBeNull();
      expect(valueOf(await floor.raise("0.36.6"))).toEqual({ floor: "0.36.6" });
      expect(valueOf(await floor.raise("0.36.10"))).toEqual({ floor: "0.36.10" });
      expect(valueOf(await floor.raise("0.36.9"))).toEqual({ floor: "0.36.10" });
      expect(valueOf(await floor.raise("0.36.10"))).toEqual({ floor: "0.36.10" });
      expect(valueOf(await floor.read())).toBe("0.36.10");
      expect(valueOf(await need("floor", twin.floor).read())).toBe("0.36.10");
      for (const bad of ["0.36", "0.37.0-dev.1", "v1.0.0", ""]) expect({ bad, code: failureOf(await floor.raise(bad)).code }).toEqual({ bad, code: "invalid" });
      expect(valueOf(await floor.read())).toBe("0.36.10");
    });

    t("racing raises leave the highest floor", async () => {
      const { st, racer } = await made();
      if (!st.floor) return;
      const versions = Array.from({ length: RACERS }, (_, i) => `0.${30 + ((i * 5) % RACERS)}.${i}`);
      const answers = await Promise.all(versions.map((v, i) => need("floor", racer(i).floor).raise(v)));
      const highest = [...versions].sort((a, b) => compareVersions(a, b)).at(-1);
      for (const [i, a] of answers.entries()) expect(compareVersions(valueOf(a).floor, versions[i] as string)).toBeGreaterThanOrEqual(0);
      expect(valueOf(await st.floor.read())).toBe(highest as string);
    });
  });
}
