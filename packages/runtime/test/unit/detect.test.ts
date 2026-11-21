/**
 * Detection for a step that may not keep code: before its agent starts the host notes what the agent
 * could change (a receipted snapshot), and a snapshot it cannot take parks the unit, never launching.
 */
import { describe, expect, test } from "bun:test";
import type { RoleDefinition } from "@norn/plugin-api";
import { BASE_SNAPSHOT, harness, has, record, session, tickUntil, trackerItem } from "./support.ts";

const ROLES: Record<string, RoleDefinition> = {
  builder: { purpose: "Builds.", allow: ["code:write", "docs:write", "exec:any"] },
  reviewer: { purpose: "Reviews.", allow: ["code:read", "docs:write", "out:findings"] },
};
const UNIT = "lt-1";

async function started(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness({ workflow: "granted", roles: ROLES, ...opts });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  return h;
}

describe("the snapshot a run that may not keep code is checked against", () => {
  test("is noted after the run's intent and before its agent starts, with the remote's copy of its branch", async () => {
    const h = await started();
    const kinds = (await record(h, UNIT)).receipts.map((r) => r.data.kind);
    expect(kinds.slice(-3)).toEqual(["run.started", "run.snapshot", "run.started"]);
    const snap = (await record(h, UNIT)).receipts.find((r) => r.data.kind === "run.snapshot")?.data;
    expect(snap).toMatchObject({ kind: "run.snapshot", step: "review", attempt: 1, snapshot: { ...BASE_SNAPSHOT, remote: null } });
    expect(h.vcsCalls.filter((c) => c.op === "snapshot")).toHaveLength(1);
    expect(h.launcher.calls.filter((c) => c.op === "start")).toHaveLength(1);
  });

  test("a retry of the visit is checked against the visit's first snapshot, never one its dead run left", async () => {
    const h = await started();
    await tickUntil(h, has("receipts.apply"));
    const first = (await record(h, UNIT)).state?.run?.id as string;
    expect(first).toBeDefined();
    h.sessions.byUnit.set(UNIT, session("ended"));
    await tickUntil(h, has("agent.died.retry"));
    expect(h.vcsCalls.filter((c) => c.op === "snapshot")).toHaveLength(1);
    expect((await record(h, UNIT)).receipts.filter((r) => r.data.kind === "run.snapshot")).toHaveLength(1);
  });

  test("a step that keeps its code takes none", async () => {
    const h = harness({ workflow: "agented", roles: ROLES });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    expect(h.vcsCalls.filter((c) => c.op === "snapshot")).toEqual([]);
  });

  test("a snapshot that fails starts no agent and parks the unit stuck, saying why", async () => {
    const h = harness({ workflow: "granted", roles: ROLES });
    h.checkouts.snapshot["/machine/repo/worktrees/lt-1"] = "git stash: fatal: index file corrupt";
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    expect(h.launcher.calls.filter((c) => c.op === "start")).toEqual([]);
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.parked).toMatchObject({ reason: "run.snapshot.failed", text: "the snapshot run " + (await record(h, UNIT)).state?.run?.id + " is checked against could not be taken: git stash: fatal: index file corrupt" });
    await tickUntil(h, has("unit.parked"));
  });

  test("a vcs that cannot snapshot parks it the same way, naming the vcs", async () => {
    const h = harness({ workflow: "granted", roles: ROLES, noSnapshot: true });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    expect(h.launcher.calls.filter((c) => c.op === "start")).toEqual([]);
    expect((await record(h, UNIT)).state?.parked?.text).toContain("vcs fake cannot note what an agent changes");
  });
});
