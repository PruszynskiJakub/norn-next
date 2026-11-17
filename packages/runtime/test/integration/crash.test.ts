/**
 * A crash between an effect and the record of how it went: the effect happened, its outcome never
 * reached the record. The next tick picks the story up from the record and does not perform the
 * effect a second time.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { changesDir } from "@norn/forge-none";
import { outcomeReceiptId } from "@norn/kernel";
import type { HostContext, Store } from "@norn/plugin-api";
import { type AgentScript, decideGate, machine, personMerges, rulesOf, team, tickUntil, unitRecord } from "./world.ts";

const builder: AgentScript = () => ({ commit: { "thing.txt": "the thing\n" }, outcome: "done" });

/** `store` with `appendReceipt` replaced; every other member is the store's own, bound to it. */
function overrideAppend(store: Store, append: Store["appendReceipt"]): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "appendReceipt") return append;
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe("a crash after an agent launch, before the receipt naming its session", () => {
  test("the next tick applies the launch on the record and never launches again", async () => {
    const t = await team();
    let crashed = 0;
    const m = await machine(t, {
      name: "a",
      workflow: "short",
      script: builder,
      wrapStore: (store) =>
        overrideAppend(store, async (unit, r) => {
          const data = r.data as { kind?: string; session?: string };
          if (crashed === 0 && data.kind === "run.started" && data.session !== undefined) {
            crashed++;
            throw new Error("the machine went down");
          }
          return store.appendReceipt(unit, r);
        }),
    });
    await m.env.slots.tracker.perform({ kind: "create", title: "Build it", body: "", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
    const unit = "lt-1";
    const reports = await tickUntil(m, async () => (await unitRecord(m, unit)).state?.parked !== undefined);
    const start = reports.flatMap((r) => r.outcomes).find((o) => o.decision.rule === "agent.start");
    expect(start?.ok === false && start.error).toContain("the machine went down");
    expect(crashed).toBe(1);
    // one launch, though the act never finished: the run on the record is that launch's
    expect(m.agents.starts).toHaveLength(1);
    const record = await unitRecord(m, unit);
    expect(record.state?.step).toBe("ready");
    const intent = record.receipts.find((r) => r.data.kind === "run.started" && r.data.run_kind === "agent");
    expect(intent?.data.kind === "run.started" && intent.data.run_id).toBe(m.agents.starts[0]?.run_id as string);
    expect(record.receipts.some((r) => r.id === outcomeReceiptId(intent?.id as string))).toBe(false);
    expect(reports.flatMap(rulesOf).filter((r) => r.includes("!"))).toHaveLength(1);
  }, 60_000);
});

describe("a crash after open-pr opened the change, before the host kept its answer", () => {
  test("the step runs again and updates that change; no second change is opened", async () => {
    const t = await team();
    let crashed = 0;
    const m = await machine(t, {
      name: "a",
      workflow: "short",
      script: builder,
      host: (ctx): HostContext => ({
        ...ctx,
        files: {
          ...ctx.files,
          write: async (path, data) => {
            if (crashed === 0 && path.includes("/runtime/step-runs/") && data.includes('"kind": "open-pr"')) {
              crashed++;
              throw new Error("the machine went down");
            }
            return ctx.files.write(path, data);
          },
        },
      }),
    });
    await m.env.slots.tracker.perform({ kind: "create", title: "Build it", body: "", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
    const unit = "lt-1";
    await tickUntil(m, async () => (await unitRecord(m, unit)).state?.parked !== undefined);
    await decideGate(m, unit, "approve");
    const reports = await tickUntil(m, async () => (await unitRecord(m, unit)).state?.step === "merge");
    expect(crashed).toBe(1);
    const runs = reports.flatMap((r) => r.outcomes).filter((o) => o.decision.kind === "run_step" && o.decision.step === "open-pr");
    expect(runs.map((o) => o.ok)).toEqual([false, true]);
    expect(readdirSync(changesDir(m.ctx))).toHaveLength(1);
    const found = await m.env.slots.forge.findChanges([`norn/${unit}`]);
    expect(found.ok && found.value[`norn/${unit}`]?.state).toBe("open");

    await personMerges(m, unit);
    await tickUntil(m, async () => (await unitRecord(m, unit)).state?.ended === "done");
    expect(readdirSync(changesDir(m.ctx))).toHaveLength(1);
  }, 60_000);
});
