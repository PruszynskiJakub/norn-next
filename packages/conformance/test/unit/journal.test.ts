/**
 * The kernel's journal over a real store (store-local on in-memory files): what it reads as corrupt,
 * how a lost commit race shows, and that the act protocol converges after a crash at any store call
 * without performing its effect twice.
 */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import {
  type ActPlan,
  applyReceipts,
  Journal,
  type LoadedWorkflow,
  newRunState,
  outcomeReceiptId,
  type RunState,
  type UnitJournal,
  type WorkflowGraph,
} from "@norn/kernel";
import { fail, ok, type Store } from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { createLocalStore } from "@norn/store-local";

const UNIT = "gh-1";
const TICK = "01JD0000000000000000000000";
const NOW = "2026-11-17T10:00:00.000Z";
const HASH = "c".repeat(64);

const GRAPH: WorkflowGraph = {
  name: "check-only",
  hash: HASH,
  start: "test",
  stalled_ms: null,
  steps: {
    test: {
      name: "test",
      kind: "check",
      runner: { type: "builtin" },
      outcomes: ["pass", "fail"],
      routes: { pass: { to: "$done" }, fail: { to: "test", counter: "test.fail" } },
      check: { command: "bun test", timeout_ms: 60_000, exits: {} },
    },
  },
  counters: { "test.fail": { max: 5, reset_on: [] } },
};
const WORKFLOW: LoadedWorkflow = {
  pinned: { name: "check-only", hash: HASH, doc: { name: "check-only", start: "test", steps: { test: { check: "bun test" } } } },
  graph: GRAPH,
};

/** A store over `files` with the clock standing still, so two passes over the same receipts commit the same state. */
const storeOver = (files: ReturnType<typeof memoryFiles>): Store => createLocalStore(memoryHost({ files, now: () => NOW }));

async function seeded(): Promise<{ files: ReturnType<typeof memoryFiles>; store: Store }> {
  const files = memoryFiles();
  const store = storeOver(files);
  const committed = await new Journal(store).commit(UNIT, newRunState({ unit: UNIT, story: UNIT, workflow: WORKFLOW }), null);
  expect(committed).toEqual({ ok: true, value: { version: 1 } });
  return { files, store };
}

async function read(store: Store): Promise<UnitJournal> {
  const r = await new Journal(store).readUnit(UNIT);
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}

class Crash extends Error {}

/** The store, with the process stopping right after its n-th call takes effect: what a crash between two writes leaves. */
function crashingAfter(store: Store, n: number): Store {
  let calls = 0;
  const after = async <T>(p: Promise<T>): Promise<T> => {
    const v = await p;
    if (++calls === n) throw new Crash(`stopped after store call ${n}`);
    return v;
  };
  return {
    ...store,
    readUnit: (unit) => after(store.readUnit(unit)),
    appendReceipt: (unit, r) => after(store.appendReceipt(unit, r)),
    commitState: (unit, data, v) => after(store.commitState(unit, data, v)),
  };
}

/** Running a check: the run's receipt first, the command, its outcome receipt, then the routed state. */
function checkPlan(effects: string[], exit = 0): ActPlan<{ exit: number }> {
  const intentId = deriveUlid(TICK, 0);
  return {
    intent: { id: intentId, data: { kind: "run.started", step: "test", attempt: 1, run_id: intentId, run_kind: "check", executor: "check", attended: false } },
    perform: async () => {
      effects.push(intentId);
      return ok({ exit });
    },
    outcome: ({ exit: code }) => ({ kind: "check.finished", step: "test", attempt: 1, run_id: intentId, exit: code, outcome: code === 0 ? "pass" : "fail" }),
    next: (unit) => (unit.state ? { state: applyReceipts(unit.state, unit.unapplied, GRAPH).state, expectVersion: unit.version } : null),
  };
}

describe("Journal: reading a unit", () => {
  test("a unit nothing was written to reads as no state and no receipts", async () => {
    expect(await read(storeOver(memoryFiles()))).toEqual({ unit: UNIT, version: null, state: null, receipts: [], unapplied: [] });
  });

  test("receipt data that fails the kernel's schema makes the unit corrupt, naming the receipt and the field", async () => {
    const { store } = await seeded();
    await store.appendReceipt(UNIT, { id: "r1", data: { kind: "run.reported", run_id: "a1", verb: "shipped" } });
    const unit = await read(store);
    expect(unit).toMatchObject({ version: 1, state: null, receipts: [], unapplied: [] });
    expect(unit.corrupt).toStartWith("receipt 1 (r1): ");
    expect(unit.corrupt).toContain("/verb");
  });

  test("a done naming its evidence commit reads back whole; one whose evidence is malformed makes the unit corrupt, naming the field", async () => {
    const evidence = { commit: "a".repeat(40), files: [{ name: "AC1.png", kept: "AC1.webp" }] };
    const kept = await seeded();
    await kept.store.appendReceipt(UNIT, { id: "r1", data: { kind: "run.reported", run_id: "a1", verb: "done", outcome: "pass", evidence } });
    const unit = await read(kept.store);
    expect(unit.corrupt).toBeUndefined();
    expect(unit.receipts.map((r) => r.data)).toEqual([{ kind: "run.reported", run_id: "a1", verb: "done", outcome: "pass", evidence }]);
    const bad = await seeded();
    await bad.store.appendReceipt(UNIT, { id: "r1", data: { kind: "run.reported", run_id: "a1", verb: "done", outcome: "pass", evidence: { commit: "a".repeat(40), files: [{ name: "AC1.png" }] } } });
    const corrupt = await read(bad.store);
    expect(corrupt.corrupt).toStartWith("receipt 1 (r1): ");
    expect(corrupt.corrupt).toContain("/evidence");
  });

  test("decide's corrupt mark appended to a corrupt record reads back as corrupt_marked, and nothing else of the record does", async () => {
    const { store } = await seeded();
    await store.appendReceipt(UNIT, { id: "r1", data: { kind: "run.reported", run_id: "a1", verb: "shipped" } });
    expect((await read(store)).corrupt_marked).toBeUndefined();
    // a stuck mark is not the corrupt one
    await new Journal(store).record(UNIT, { id: "r2", data: { kind: "unit.marked", ended: "stuck", reason: "x" } });
    expect((await read(store)).corrupt_marked).toBeUndefined();
    await new Journal(store).record(UNIT, { id: "r3", data: { kind: "unit.marked", ended: "corrupt", reason: "receipt 1 (r1): /verb" } });
    const unit = await read(store);
    expect(unit).toMatchObject({ state: null, receipts: [], unapplied: [], corrupt_marked: true });
    expect(unit.corrupt).toStartWith("receipt 1 (r1): ");
  });

  test("a run state that fails the schema, is of an unreadable format, or names another unit makes the unit corrupt", async () => {
    const state = newRunState({ unit: UNIT, story: UNIT, workflow: WORKFLOW });
    const cases: Array<[unknown, string]> = [
      [{ format: 1, unit: UNIT }, "run state v1: "],
      [{ ...state, format: 2 }, "run state v1: run state format 2 is not readable"],
      [{ ...state, unit: "gh-2" }, "run state v1 is for unit gh-2"],
      [{ ...state, applied_through: 3 }, "run state v1 applied through receipt 3, but the unit has 0"],
    ];
    for (const [data, reason] of cases) {
      const store = storeOver(memoryFiles());
      expect((await store.commitState(UNIT, data, null)).ok).toBe(true);
      const unit = await read(store);
      expect(unit.state).toBeNull();
      expect(unit.corrupt).toStartWith(reason);
    }
  });

  test("a corrupt mark never makes a record whole again: applied_through one ahead stays corrupt and marked once the mark takes that seq", async () => {
    const state = newRunState({ unit: UNIT, story: UNIT, workflow: WORKFLOW });
    const store = storeOver(memoryFiles());
    await store.appendReceipt(UNIT, { id: "r1", data: { kind: "mode.changed", mode: "auto", by: "a-person" } });
    expect((await store.commitState(UNIT, { ...state, applied_through: 2 }, null)).ok).toBe(true);
    const before = await read(store);
    expect(before.corrupt).toStartWith("run state v1 applied through receipt 2, but the unit has 1");
    expect(before.corrupt_marked).toBeUndefined();
    const wrote = await new Journal(store).record(UNIT, { id: "r2", data: { kind: "unit.marked", ended: "corrupt", reason: before.corrupt as string } });
    expect(wrote).toEqual({ ok: true, value: { seq: 2, replayed: false } });
    const after = await read(store);
    expect(after).toMatchObject({ state: null, receipts: [], unapplied: [], corrupt_marked: true });
    expect(after.corrupt).toStartWith("marked corrupt by receipt 2");
  });

  test("a readable state that ended corrupt with its mark reads as that state", async () => {
    const { store } = await seeded();
    await new Journal(store).record(UNIT, { id: "r1", data: { kind: "unit.marked", ended: "corrupt", reason: "workflow gone" } });
    const state: RunState = { ...newRunState({ unit: UNIT, story: UNIT, workflow: WORKFLOW }), ended: "corrupt", ended_reason: "workflow gone", applied_through: 1 };
    expect((await new Journal(store).commit(UNIT, state, 1)).ok).toBe(true);
    const unit = await read(store);
    expect(unit.corrupt).toBeUndefined();
    expect(unit.state).toMatchObject({ ended: "corrupt", applied_through: 1 });
  });

  test("receipts above applied_through are the unapplied ones", async () => {
    const { store } = await seeded();
    const journal = new Journal(store);
    await journal.record(UNIT, { id: "r1", data: { kind: "mode.changed", mode: "auto", by: "a-person" } });
    const unit = await read(store);
    expect(unit.receipts.map((r) => r.seq)).toEqual([1]);
    expect(unit.unapplied.map((r) => r.seq)).toEqual([1]);
  });
});

describe("Journal: writing", () => {
  test("a receipt recorded twice under its id is written once", async () => {
    const { store } = await seeded();
    const journal = new Journal(store);
    const intent = { id: "r1", data: { kind: "mode.changed", mode: "auto", by: "a-person" } } as const;
    expect(await journal.record(UNIT, intent)).toEqual({ ok: true, value: { seq: 1, replayed: false } });
    expect(await journal.record(UNIT, intent)).toEqual({ ok: true, value: { seq: 1, replayed: true } });
  });

  test("a receipt or a state that fails the kernel's schema is refused before the store sees it", async () => {
    const { store, files } = await seeded();
    const before = files.snapshot();
    const journal = new Journal(store);
    const bad = await journal.record(UNIT, { id: "r1", data: { kind: "nudge.sent" } } as never);
    expect(bad.ok ? null : bad.failure.code).toBe("invalid");
    const state = (await read(store)).state as RunState;
    const worse = await journal.commit(UNIT, { ...state, attempt: 0 }, 1);
    expect(worse.ok ? null : worse.failure.code).toBe("invalid");
    const elsewhere = await journal.commit("gh-2", state, null);
    expect(elsewhere.ok ? null : elsewhere.failure.message).toContain("committed to gh-2");
    expect(files.snapshot()).toEqual(before);
  });

  test("a commit that lost the race is a conflict and overwrites nothing; a re-read sees the winner", async () => {
    const { files, store } = await seeded();
    const mine = new Journal(store);
    const theirs = new Journal(storeOver(files));
    const seen = (await read(store)).state as RunState;
    expect(await theirs.commit(UNIT, { ...seen, mode: "auto" }, 1)).toEqual({ ok: true, value: { version: 2 } });
    const lost = await mine.commit(UNIT, { ...seen, mode: "manual" }, 1);
    expect(lost.ok ? null : lost.failure.code).toBe("conflict");
    expect(await read(store)).toMatchObject({ version: 2, state: { mode: "auto" } });
  });

  test("an act whose commit lost the race answers the conflict, with its receipts kept for the next pass", async () => {
    const { files, store } = await seeded();
    const effects: string[] = [];
    const plan = checkPlan(effects);
    const racing: ActPlan<{ exit: number }> = {
      ...plan,
      next: (unit) => {
        const computed = plan.next(unit);
        return computed && { ...computed, expectVersion: 1 };
      },
    };
    const theirs = new Journal(storeOver(files));
    await theirs.commit(UNIT, { ...((await read(store)).state as RunState), mode: "auto" }, 1);
    const res = await new Journal(store).act(UNIT, racing);
    expect(res.ok ? null : res.failure.code).toBe("conflict");
    const unit = await read(store);
    expect(unit).toMatchObject({ version: 2, state: { step: "test", mode: "auto", applied_through: 0 } });
    expect(unit.unapplied.map((r) => r.data.kind)).toEqual(["run.started", "check.finished"]);
    const again = await new Journal(store).act(UNIT, plan);
    expect(again).toMatchObject({ ok: true, value: { performed: false, version: 3 } });
    expect(effects).toHaveLength(1);
  });

  test("an act on a corrupt unit performs nothing", async () => {
    const { store } = await seeded();
    await store.appendReceipt(UNIT, { id: "r1", data: { kind: "bogus" } });
    const effects: string[] = [];
    const res = await new Journal(store).act(UNIT, checkPlan(effects));
    expect(res.ok ? null : res.failure.message).toContain("corrupt");
    expect(effects).toEqual([]);
  });

  test("a failed effect leaves its intent on the record and commits nothing; the next pass performs it", async () => {
    const { store } = await seeded();
    const effects: string[] = [];
    const plan = checkPlan(effects);
    let first = true;
    const flaky: ActPlan<{ exit: number }> = {
      ...plan,
      perform: async () => {
        if (!first) return plan.perform();
        first = false;
        return fail("unavailable", "the runner is busy");
      },
    };
    const res = await new Journal(store).act(UNIT, flaky);
    expect(res.ok ? null : res.failure.code).toBe("unavailable");
    expect(await read(store)).toMatchObject({ version: 1, state: { applied_through: 0 } });
    expect(await new Journal(store).act(UNIT, flaky)).toMatchObject({ ok: true, value: { performed: true, version: 2 } });
    expect(effects).toHaveLength(1);
  });
});

describe("Journal: the act protocol across crashes", () => {
  async function baseline() {
    const { files, store } = await seeded();
    const effects: string[] = [];
    const res = await new Journal(store).act(UNIT, checkPlan(effects));
    expect(res).toEqual({ ok: true, value: { value: { exit: 0 }, performed: true, version: 2 } });
    return { unit: await read(store), files, effects };
  }

  test("an uninterrupted act writes intent, outcome and state, in that order, and ends the unit where the outcome routes", async () => {
    const { unit, effects } = await baseline();
    expect(unit.receipts.map((r) => [r.seq, r.data.kind])).toEqual([
      [1, "run.started"],
      [2, "check.finished"],
    ]);
    expect(unit.receipts[1]?.id).toBe(outcomeReceiptId(deriveUlid(TICK, 0)));
    expect(unit.state).toMatchObject({ step: "test", ended: "done", run: null, applied_through: 2 });
    expect(unit.unapplied).toEqual([]);
    expect(effects).toHaveLength(1);
  });

  // store calls of one act: read, append intent, (effect), append outcome, re-read, commit
  for (const n of [1, 2, 3, 4, 5]) {
    test(`a crash right after store call ${n} replays to the same record without performing the effect again`, async () => {
      const want = await baseline();
      const { files, store } = await seeded();
      const effects: string[] = [];
      await expect(new Journal(crashingAfter(store, n)).act(UNIT, checkPlan(effects))).rejects.toBeInstanceOf(Crash);
      const replay = await new Journal(storeOver(files)).act(UNIT, checkPlan(effects));
      expect(replay.ok).toBe(true);
      expect(effects).toHaveLength(1);
      const got = await read(storeOver(files));
      expect(got).toEqual(want.unit);
      expect(files.snapshot()).toEqual(want.files.snapshot());
    });
  }

  test("an act replayed once it is committed writes, performs and commits nothing", async () => {
    const { files, effects } = await baseline();
    const before = files.snapshot();
    const again = await new Journal(storeOver(files)).act(UNIT, checkPlan(effects));
    expect(again).toEqual({ ok: true, value: { value: null, performed: false, version: 2 } });
    expect(effects).toHaveLength(1);
    expect(files.snapshot()).toEqual(before);
  });

  test("a crash after the effect but before its outcome receipt performs it again, under the same intent id", async () => {
    const want = await baseline();
    const { files, store } = await seeded();
    const effects: string[] = [];
    let appends = 0;
    const dying: Store = {
      ...store,
      appendReceipt: async (unit, r) => {
        if (++appends === 2) throw new Crash("stopped before the outcome receipt");
        return store.appendReceipt(unit, r);
      },
    };
    await expect(new Journal(dying).act(UNIT, checkPlan(effects))).rejects.toBeInstanceOf(Crash);
    await new Journal(storeOver(files)).act(UNIT, checkPlan(effects));
    expect(effects).toEqual([deriveUlid(TICK, 0), deriveUlid(TICK, 0)]);
    expect(await read(storeOver(files))).toEqual(want.unit);
  });

  test("an act with no outcome receipt is complete once a committed state applies its intent", async () => {
    // its store calls: read, append intent, (effect), re-read, commit; only a crash between the
    // effect and the commit (after the re-read) leaves the effect to be performed again
    const performedPerCrash: number[] = [];
    for (const n of [1, 2, 3, 4]) {
      const effects: string[] = [];
      const plan: ActPlan<{ exit: number }> = { ...checkPlan(effects), outcome: null };
      const { files, store } = await seeded();
      await expect(new Journal(crashingAfter(store, n)).act(UNIT, plan)).rejects.toBeInstanceOf(Crash);
      await new Journal(storeOver(files)).act(UNIT, plan);
      expect(await read(storeOver(files))).toMatchObject({ version: 2, state: { run: { executor: "check" }, applied_through: 1 } });
      const committed = files.snapshot();
      expect(await new Journal(storeOver(files)).act(UNIT, plan)).toMatchObject({ ok: true, value: { performed: false, version: 2 } });
      expect(files.snapshot()).toEqual(committed);
      performedPerCrash.push(effects.length);
    }
    expect(performedPerCrash).toEqual([1, 1, 2, 1]);
  });
});
