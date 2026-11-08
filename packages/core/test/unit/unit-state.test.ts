import { describe, expect, test } from "bun:test";
import { type UnitState, type UnitStateRecord, validate } from "@norn/schema";
import { roundFinished } from "../../src/policy.ts";
import { normalizeUnitState, roundRejected, toCorrupt, toDone, toParked, toReady, toRunning, toStuck } from "../../src/unit-state.ts";
import { at, SOLO_WF, stateFor, storyUnit } from "../fixtures.ts";

const AT = at();
const ID = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const RUN = { run_id: ID, step: "implement", attempt: 1, started_at: AT, how: "auto" as const };
const ENDED = { by: "person" as const, at: "implement", receipt_id: ID };
const base: UnitStateRecord = stateFor(storyUnit(), SOLO_WF);
const rec = (p: Partial<UnitStateRecord>): UnitStateRecord => ({ ...base, ...p });
const park = <K extends string>(kind: K, extra: Record<string, unknown> = {}) => ({ kind, reason: `${kind} reason`, since: AT, ...extra });

const strictOk = (st: unknown) => {
  const v = validate("state", st);
  if (!v.ok) throw new Error(`not a UnitState: ${JSON.stringify(v.errors)}\n${JSON.stringify(st)}`);
};

describe("normalizeUnitState: every record reads as a legal state", () => {
  // [rule, record, the fields it reads as]
  const rows: Array<[string, UnitStateRecord, Partial<UnitStateRecord>]> = [
    ["done at a step → $done, run dropped", rec({ status: "done", run: RUN }), { step: "$done", status: "done", run: null, park: null }],
    ["done keeps a workflow park", rec({ step: "$done", status: "done", park: park("workflow", { command: "x" }) as never }), { status: "done", park: park("workflow", { command: "x" }) as never }],
    ["done drops any other park", rec({ step: "$done", status: "done", park: park("ask") as never }), { status: "done", park: null }],
    ["ready at $done → done", rec({ step: "$done" }), { step: "$done", status: "done" }],
    ["running at $done → done", rec({ step: "$done", status: "running", run: RUN }), { step: "$done", status: "done", run: null }],
    ["parked at $done → done", rec({ step: "$done", status: "parked", park: park("gate") as never }), { step: "$done", status: "done", park: null }],
    ["running without a run → stuck", rec({ status: "running" }), { status: "stuck", park: { kind: "stuck", reason: "running without a run record", since: base.updated_at } }],
    ["running drops a park", rec({ status: "running", run: RUN, park: park("ask") as never }), { status: "running", park: null, run: RUN }],
    ["ready drops a park and a run", rec({ park: park("gate") as never, run: RUN }), { status: "ready", park: null, run: null }],
    ["parked without a park → stuck", rec({ status: "parked" }), { status: "stuck", park: { kind: "stuck", reason: "parked without a reason", since: base.updated_at } }],
    ["parked on a stuck kind → stuck", rec({ status: "parked", park: park("exhausted") as never, run: RUN }), { status: "stuck", park: park("exhausted") as never, run: RUN }],
    ["parked on a corrupt kind → stuck, reason kept", rec({ status: "parked", park: park("corrupt") as never }), { status: "stuck", park: { ...park("corrupt"), kind: "stuck" } as never }],
    ["stuck without a park", rec({ status: "stuck" }), { status: "stuck", park: { kind: "stuck", reason: "stuck", since: base.updated_at } }],
    ["stuck on an ask kind → kind stuck", rec({ status: "stuck", park: park("ask", { receipt_id: ID }) as never }), { status: "stuck", park: { ...park("ask", { receipt_id: ID }), kind: "stuck" } as never }],
    ["corrupt without a corrupt park", rec({ status: "corrupt", park: park("gate") as never }), { status: "corrupt", park: { kind: "corrupt", reason: "gate reason", since: AT } }],
    ["corrupt without any park", rec({ status: "corrupt" }), { status: "corrupt", park: { kind: "corrupt", reason: "corrupt", since: base.updated_at } }],
  ];
  test.each(rows)("%s", (_rule, r, fields) => {
    const before = structuredClone(r);
    const st = normalizeUnitState(r);
    strictOk(st);
    expect(st).toEqual(expect.objectContaining(fields));
    expect(r).toEqual(before);
    // the read is stable: a normalised state is already canonical
    expect(normalizeUnitState(st)).toBe(st);
  });

  test("`ended` is dropped outside done and corrupt, kept on them", () => {
    expect(normalizeUnitState(rec({ status: "running", run: RUN, ended: ENDED }))).not.toHaveProperty("ended");
    expect(normalizeUnitState(rec({ status: "stuck", ended: ENDED }))).not.toHaveProperty("ended");
    expect(normalizeUnitState(rec({ status: "done", ended: ENDED }))).toMatchObject({ step: "$done", ended: ENDED });
    expect(normalizeUnitState(rec({ status: "corrupt", ended: ENDED }))).toMatchObject({ ended: ENDED });
  });

  test.each<[string, UnitStateRecord]>([
    ["ready", base],
    ["running", rec({ status: "running", run: RUN })],
    ["parked on an ask with its run", rec({ status: "parked", park: park("ask") as never, run: RUN })],
    ["stuck at $done on a remote park", rec({ step: "$done", status: "stuck", park: park("remote") as never })],
    ["stuck at $done on a stuck park (the writers' invariant, not the schema's)", rec({ step: "$done", status: "stuck", park: park("stuck") as never })],
    ["done with a workflow park", rec({ step: "$done", status: "done", park: park("workflow") as never })],
    ["corrupt", rec({ status: "corrupt", park: park("corrupt") as never, run: RUN })],
  ])("a canonical %s record comes back as the same reference", (_n, r) => {
    expect(validate("state", r).ok).toBe(true);
    expect(normalizeUnitState(r)).toBe(r as UnitState);
  });
});

describe("transition helpers", () => {
  const running = rec({ status: "running", run: RUN, round: 2, mode: "auto" });
  const exhausted = { ...park("exhausted", { receipt_id: ID }), counter: { name: "fix_loop", max: 2, outcome: "fail", to: "implement" } };
  const implicitAsk = { ...park("ask", { receipt_id: ID }), implicit: "hook" as const, options: ["yes", "no"], choice: { numbered: true, cursor: 0 }, screen: "Allow?" };

  test.each<[string, UnitState]>([
    ["toReady", toReady(running)],
    ["toRunning", toRunning(toReady(running), RUN)],
    ["toParked (an implicit ask)", toParked(running, implicitAsk)],
    ["toStuck (an exhausted counter)", toStuck(running, exhausted)],
    ["toDone", toDone(running)],
    ["toCorrupt", toCorrupt(running, "corrupt: x", AT)],
  ])("%s keeps state.json's key order and is a legal state", (_n, st) => {
    strictOk(st);
    expect(Object.keys(st)).toEqual(Object.keys(running));
  });

  test("a park keeps its writer's key order", () => {
    expect(Object.keys(toParked(running, implicitAsk).park)).toEqual(["kind", "reason", "since", "receipt_id", "implicit", "options", "choice", "screen"]);
    expect(Object.keys(toStuck(running, exhausted).park)).toEqual(["kind", "reason", "since", "receipt_id", "counter"]);
  });

  test("toParked and toStuck keep the run; toReady drops it", () => {
    expect(toParked(running, implicitAsk).run).toEqual(RUN);
    expect(toStuck(running, exhausted).run).toEqual(RUN);
    expect(toReady(running).run).toBeNull();
  });

  test("toReady and toStuck drop `ended`; toDone and toCorrupt keep it", () => {
    const closed = { ...running, ended: ENDED };
    expect(toReady(closed)).not.toHaveProperty("ended");
    expect(toStuck(closed, exhausted)).not.toHaveProperty("ended");
    expect(toDone(closed).ended).toEqual(ENDED);
    expect(toCorrupt(closed, "x", AT).ended).toEqual(ENDED);
  });

  test("roundRejected: a done round holds the workflow park and stays done; one parked at $done is re-parked on it", () => {
    const wfPark = park("workflow", { receipt_id: ID, command: "norn story edit gh-1 --workflow x" }) as { kind: "workflow"; reason: string; since: string };
    const done = toDone(base);
    expect(roundRejected(done, wfPark)).toEqual({ ...done, park: wfPark });
    const held = toStuck(done, park("remote"));
    const rejected = roundRejected(held, wfPark);
    expect(rejected).toMatchObject({ step: "$done", status: "stuck", park: wfPark });
    strictOk(rejected);
  });

  test("roundFinished narrows exactly: a stuck unit it rejects is still a StuckState", () => {
    const check = (st: UnitState): string => {
      if (roundFinished(st)) return st.status;
      // compiles only while the false branch keeps every StuckState
      return st.status === "stuck" ? `stuck on ${st.park.kind}` : st.status;
    };
    expect(check(toStuck(base, park("exhausted")))).toBe("stuck on exhausted");
    expect(check(toStuck(toDone(base), park("workflow")))).toBe("stuck on workflow");
    expect(check(toStuck(toDone(base), park("remote")))).toBe("stuck");
    expect(check(toDone(base))).toBe("done");
  });
});
