import { describe, expect, test } from "bun:test";
import { deriveUlid } from "@norn/schema";
import { createRuntimeEnv, readWake, reportRun, wakeWriterOf } from "../../src/index.ts";
import { has, harness, record, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";

describe("the wake stamp", () => {
  test("a report another process records rewrites the stamp under that process's writer", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const runId = (await record(h, UNIT)).state?.run?.id as string;
    const before = await readWake(h.ctx);

    // `norn done` runs in its own process, which builds its own env over the same machine dir
    const other = createRuntimeEnv({ ctx: h.ctx, plugins: h.plugins, config: h.config, launcher: h.launcher, sessions: h.sessions });
    if (!other.ok) throw new Error(other.failure.message);
    expect(other.value.wakeBy).not.toBe(h.env.wakeBy);
    expect((await reportRun(other.value, UNIT, runId, { verb: "done", outcome: "done", text: "built" }, "r1")).ok).toBe(true);

    const after = await readWake(h.ctx);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(wakeWriterOf(after as string)).toBe(other.value.wakeBy);
  });

  test("a replayed receipt writes nothing, so it leaves the stamp as it was", async () => {
    const h = harness();
    const id = deriveUlid("01JD5G00000000000000000000", 1);
    expect((await h.env.journal.record(UNIT, { id, data: { kind: "unit.parked", reason: "first" } })).ok).toBe(true);
    const first = await readWake(h.ctx);
    expect(wakeWriterOf(first as string)).toBe(h.env.wakeBy);
    expect((await h.env.journal.record(UNIT, { id, data: { kind: "unit.parked", reason: "first" } })).ok).toBe(true);
    expect(await readWake(h.ctx)).toBe(first);
  });

  test("a stamp that cannot be written never fails the receipt it follows", async () => {
    const h = harness();
    const write = h.files.write.bind(h.files);
    h.files.write = async (path, data) => {
      if (path.endsWith("/runtime/wake")) throw new Error("disk full");
      return write(path, data);
    };
    const id = deriveUlid("01JD5G00000000000000000000", 2);
    expect((await h.env.journal.record(UNIT, { id, data: { kind: "unit.parked", reason: "kept" } })).ok).toBe(true);
    expect((await record(h, UNIT)).receipts.map((r) => r.id)).toEqual([id]);
  });
});
