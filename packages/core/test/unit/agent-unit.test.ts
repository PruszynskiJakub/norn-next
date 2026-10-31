import { describe, expect, test } from "bun:test";
import type { UnitState } from "@norn/schema";
import { type AgentUnit, agentWorkRefusal, currentRun, cursorStep, implicitAsk, implicitAskOpen, standingReport } from "../../src/agent-unit.ts";
import type { NumberedReceipt } from "../../src/facts.ts";
import { at, numbered, receipt, SLICE_WF, sliceUnit, stateFor } from "../fixtures.ts";

const unit = sliceUnit("gh-1", "01", "a");
const RUN = { run_id: "01JRRRRRRRRRRRRRRRRRRRRRRR", step: "implement", attempt: 1, agent: "claude", started_at: at() } as NonNullable<UnitState["run"]>;

function view(patch: Partial<UnitState>, receipts: NumberedReceipt[] = [], unapplied: NumberedReceipt[] = []): AgentUnit {
  return { unit, state: stateFor(unit, SLICE_WF, patch), workflow: SLICE_WF, receipts, unapplied };
}

describe("agent-unit rules (§9)", () => {
  test("currentRun: the applied run, else an unapplied started receipt (MO3)", () => {
    expect(currentRun(view({ status: "running", run: RUN }))).toEqual({ run_id: RUN.run_id, applied: true });
    const st = stateFor(unit, SLICE_WF);
    const started = numbered(1, receipt({ ...st, run: RUN }, "started"));
    expect(currentRun(view({}, [started], [started]))).toEqual({ run_id: RUN.run_id, applied: false });
    expect(currentRun(view({}))).toBeNull();
  });

  test("standingReport: an agent ask stands until answered; implicit asks never count (§9.3)", () => {
    const st = stateFor(unit, SLICE_WF, { run: RUN });
    const ask = numbered(1, receipt(st, "ask", { question: "q" }));
    expect(standingReport(view({ run: RUN }, [ask]), RUN.run_id)?.n).toBe(1);
    const answer = numbered(2, receipt(st, "answer", { answer: "a" }, "human"));
    expect(standingReport(view({ run: RUN }, [ask, answer]), RUN.run_id)).toBeNull();
    const implicit = numbered(1, receipt(st, "ask", { question: "q", implicit: true }));
    expect(standingReport(view({ run: RUN }, [implicit]), RUN.run_id)).toBeNull();
  });

  test("implicitAsk / implicitAskOpen (R6.1)", () => {
    const st = stateFor(unit, SLICE_WF, { run: RUN });
    const ask = numbered(1, receipt(st, "ask", { question: "q", implicit: true }));
    const parked: Partial<UnitState> = { status: "parked", run: RUN, park: { kind: "ask", reason: "q", since: at(), receipt_id: ask.receipt.receipt_id } };
    expect(implicitAskOpen(view(parked, [ask]))?.n).toBe(1);
    const answer = numbered(2, receipt(st, "answer", { answer: "a" }, "human"));
    expect(implicitAsk(view(parked, [ask, answer], [answer]))?.answered).toBe(true);
    expect(implicitAskOpen(view(parked, [ask, answer], [answer]))).toBeNull();
    expect(implicitAsk(view({ status: "running", run: RUN }, [ask]))).toBeNull();
  });

  test("agentWorkRefusal names why an agent may not work the unit", () => {
    expect(cursorStep(view({}))?.type).toBe("agent");
    expect(agentWorkRefusal(view({ status: "running", run: RUN }), "brief")).toBeNull();
    expect(agentWorkRefusal(view({ step: "$done", status: "done" }), "brief")?.code).toBe("unit_done");
    expect(agentWorkRefusal(view({ status: "stuck" }), "brief")?.code).toBe("unit_stuck");
    expect(agentWorkRefusal(view({ step: "nope" }), "brief")?.code).toBe("no_step");
    expect(agentWorkRefusal(view({ step: "human-qa" }), "brief")?.code).toBe("gate_step");
    expect(agentWorkRefusal(view({ step: "test" }), "brief")?.code).toBe("not_agent_step");
    expect(agentWorkRefusal(view({ status: "parked", park: { kind: "ask", reason: "q", since: at() } }), "done")?.code).toBe("parked_ask");
    expect(agentWorkRefusal(view({ status: "parked", park: { kind: "attended", reason: "r", since: at() } }), "done")).toBeNull();
  });
});
