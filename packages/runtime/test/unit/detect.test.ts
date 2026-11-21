/**
 * Detection for a step that may not keep code: before its agent starts the host notes what the agent
 * could change (a receipted snapshot), and a snapshot it cannot take parks the unit, never launching.
 */
import { describe, expect, test } from "bun:test";
import { claudeHarness } from "@norn/harness-claude";
import { type RoleDefinition, RUN_ENV } from "@norn/plugin-api";
import { ingestHook, reportRun } from "../../src/index.ts";
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

const SCRATCH: Record<string, RoleDefinition> = { ...ROLES, qa: { purpose: "Checks.", allow: ["code:scratch", "exec:any"] } };
const WT = "/machine/repo/worktrees/lt-1";

/** A story at its step with the run's launch applied, and the run's id. */
async function live(workflow: string) {
  const h = harness({ workflow, roles: SCRATCH });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id as string;
  return { h, runId };
}

const done = (h: Awaited<ReturnType<typeof live>>["h"], runId: string, outcome: string, id = "r1") => reportRun(h.env, UNIT, runId, { verb: "done", outcome }, id);

describe("norn done on a run that may not keep code", () => {
  test("code:read refuses the report while a tracked file differs from the snapshot, naming it, and takes it once put back", async () => {
    const { h, runId } = await live("granted");
    h.checkouts.changed[WT] = ["src/a.ts"];
    const r = await done(h, runId, "approve");
    expect(r.ok ? null : r.refusal).toMatchObject({ code: "code_changed", error: "the run may not keep code (code:read), and tracked files changed since the run started: src/a.ts" });
    expect(r.ok ? "" : r.refusal.do_instead).toContain("put the code back as the run found it");
    h.checkouts.changed[WT] = [];
    expect((await done(h, runId, "approve", "r2")).ok).toBe(true);
  });

  test("norn's own files never count: the story's spec folder and the run folder", async () => {
    const { h, runId } = await live("granted");
    h.checkouts.changed[WT] = [".agents/specs/lt-1/handoffs/story.md", ".agents/run/out/findings.json"];
    expect((await done(h, runId, "approve")).ok).toBe(true);
  });

  test("a changed git config or hook, or a moved remote branch, refuses at any level", async () => {
    const { h, runId } = await live("scratched");
    h.checkouts.snapshot[WT] = { ...BASE_SNAPSHOT, hooks: "hooks-1" };
    const r = await done(h, runId, "done");
    expect(r.ok ? null : r.refusal).toMatchObject({ code: "code_changed", error: "the run may not keep code (code:scratch), and a git hook changed since the run started" });
  });

  test("code:scratch takes an outcome that does not pass whatever it changed, as the check resets it", async () => {
    const { h, runId } = await live("scratched");
    h.checkouts.changed[WT] = ["src/a.ts"];
    expect((await done(h, runId, "done")).ok).toBe(true);
  });
});

describe("the check after a run that may not keep code reports", () => {
  test("kills the run's processes first, finds it clean, and lets the report route", async () => {
    const { h, runId } = await live("granted");
    expect((await done(h, runId, "approve")).ok).toBe(true);
    await tickUntil(h, has("agent.check"));
    expect(h.launcher.calls.filter((c) => c.op === "stop").map((c) => c.args[0])).toEqual([`h-${runId}`]);
    expect((await record(h, UNIT)).receipts.find((r) => r.data.kind === "run.checked")?.data).toMatchObject({ verdict: "clean", run_id: runId });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("code:scratch puts back what it changed under the receipt, commits included, on an outcome that does not pass", async () => {
    const { h, runId } = await live("scratched");
    h.checkouts.changed[WT] = ["src/a.ts"];
    h.checkouts.snapshot[WT] = { ...BASE_SNAPSHOT, head: "head-1", refs: "refs-1" };
    expect((await done(h, runId, "done")).ok).toBe(true);
    await tickUntil(h, has("agent.check"));
    expect(h.vcsCalls.find((c) => c.op === "restore")?.args).toEqual([WT, { head: "head-0", tree: "tree-0" }, ["src/a.ts"]]);
    expect((await record(h, UNIT)).receipts.find((r) => r.data.kind === "run.checked")?.data).toMatchObject({ verdict: "reset", reset: ["src/a.ts"], head: true });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("a change that lands after norn done took the report refuses it and parks the unit stuck", async () => {
    const { h, runId } = await live("granted");
    expect((await done(h, runId, "approve")).ok).toBe(true);
    h.checkouts.changed[WT] = ["src/late.ts"];
    await tickUntil(h, has("agent.check"));
    await tickUntil(h, has("receipts.apply"));
    const rec = await record(h, UNIT);
    expect(rec.state?.ended).toBeUndefined();
    expect(rec.state?.parked).toMatchObject({ reason: "run.check.refused" });
    expect(rec.state?.parked?.text).toContain("src/late.ts");
    expect(h.vcsCalls.filter((c) => c.op === "restore")).toEqual([]);
  });

  test("a check that cannot read the checkout parks the unit stuck; it never passes", async () => {
    const { h, runId } = await live("granted");
    expect((await done(h, runId, "approve")).ok).toBe(true);
    h.checkouts.snapshot[WT] = "git stash: fatal: index file corrupt";
    await tickUntil(h, has("agent.check"));
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.parked).toMatchObject({ reason: "run.check.failed", text: `the check after run ${runId} reported could not be done: git stash: fatal: index file corrupt` });
  });
});

describe("the write guard of a run that may not change code", () => {
  test("holds it to the story's documents from its record, though its pin says nothing of writes", async () => {
    const { h, runId } = await live("granted");
    const r = await ingestHook(
      { ctx: h.ctx, harnesses: { claude: claudeHarness }, journal: h.env.journal, worktreeOf: () => WT, writableRoots: ["/tmp"] },
      { harness: "claude", hook: "PreToolUse", payload: { hook_event_name: "PreToolUse", session_id: "s1", tool_use_id: "t1", tool_name: "Write", tool_input: { file_path: "src/a.ts", content: "x" } }, env: { [RUN_ENV.unit]: UNIT, [RUN_ENV.run]: runId } },
    );
    await r.delivered();
    expect(r.reply.stdout).toContain("deny");
  });
});
