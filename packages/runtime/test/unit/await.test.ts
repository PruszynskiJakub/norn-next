import { describe, expect, test } from "bun:test";
import { type AgentRunRequest, briefRenderInput, readStepRun } from "../../src/index.ts";
import { type Harnessed, has, harness, MINUTE, record, rulesOf, tickUntil, trackerItem } from "./support.ts";

const WORKTREE = "/machine/repo/worktrees/lt-1";
const OPEN = { id: 4, state: "open" as const, draft: false, head_branch: "norn/lt-1", base_branch: "main", head_sha: "b2", title: "Story 1" };

async function atCi(): Promise<Harnessed> {
  const h = harness({ workflow: "awaited" });
  h.items.push(trackerItem(1));
  h.changes["norn/lt-1"] = { ...OPEN };
  h.forge.checks[4] = "pending";
  await tickUntil(h, has("await.start"));
  return h;
}

describe("an await step under the tick", () => {
  test("waits on pending checks with no step run and no detached process, naming what it waits on", async () => {
    const h = await atCi();
    const r = await h.runtime.tick();
    expect(rulesOf(r)).toContain("lt-1 await.waiting");
    expect(r.outcomes.find((o) => o.decision.rule === "await.waiting")?.decision).toMatchObject({ reason: "waiting on ci.passed, ci.failed, ci.none; seen ci.pending" });
    expect(await readStepRun(h.ctx, "lt-1")).toBeNull();
    expect(h.stepCalls).toEqual([]);
  });

  test("a red CI sends the work back with each failed check, its link and its annotations in last_check", async () => {
    const h = await atCi();
    h.forge.checks[4] = "failure";
    h.forge.failed[4] = [
      { name: "unit", url: "https://ci.example/runs/1", annotations: [{ path: "src/login.ts", line: 12, message: "expected 200, got 500" }] },
      { name: "shard-2", url: "https://ci.example/runs/2", cancelled: true, annotations: [] },
    ];
    await tickUntil(h, has("await.signal"));
    const rec = await record(h, "lt-1");
    expect(rec.state).toMatchObject({ step: "fix", counters: { "ci.ci.failed": 1 } });
    expect(rec.receipts.findLast((x) => x.data.kind === "step.finished")?.data).toMatchObject({ step_kind: "await", outcome: "ci.failed", detail: { failed: h.forge.failed[4] } });
    await tickUntil(h, has("agent.start"));
    const run = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const input = await briefRenderInput(h.env, "lt-1", run.brief, run.run_id);
    if (!input.ok) throw new Error(input.failure.message);
    const failed = [
      "CI failed on the change (`ci` ended `ci.failed`):",
      "",
      "- `unit`: https://ci.example/runs/1",
      "  - src/login.ts:12 expected 200, got 500",
      "- `shard-2` (cancelled): https://ci.example/runs/2",
    ].join("\n");
    expect(input.value.rework).toBe(failed);
    expect(await h.files.read(`${WORKTREE}/.agents/inputs/last_check.md`)).toBe(`${failed}\n`);
  });

  test("a red CI with no failed check named still says CI failed", async () => {
    const h = await atCi();
    h.forge.checks[4] = "failure";
    await tickUntil(h, has("agent.start"));
    const run = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const input = await briefRenderInput(h.env, "lt-1", run.brief, run.run_id);
    expect(input.ok && input.value.rework).toBe("CI failed on the change (`ci` ended `ci.failed`); the forge named no failed check.");
  });

  test("passing checks go on to the merge, which the forge's merge onto the base ends", async () => {
    const h = await atCi();
    h.forge.checks[4] = "success";
    await tickUntil(h, has("await.signal"));
    expect((await record(h, "lt-1")).state?.step).toBe("merge");
    h.clock.advance(MINUTE);
    h.changes["norn/lt-1"] = { ...OPEN, state: "merged", merge_sha: "m1", merged_at: h.clock.now() };
    await tickUntil(h, has("claim.release"));
    expect((await record(h, "lt-1")).state?.ended).toBe("done");
  });

  test("a forge outage keeps it waiting and shows in the tick's problems", async () => {
    const h = await atCi();
    h.forge.down = true;
    const r = await h.runtime.tick();
    expect(rulesOf(r)).toContain("lt-1 await.waiting");
    expect(r.problems).toContain("forge: the fake forge is down");
    expect((await record(h, "lt-1")).state?.step).toBe("ci");
  });
});

describe("the shipped ship under the tick, over a forge that is not GitHub", () => {
  async function shipping(checks: boolean) {
    const h = harness({ workflow: "shipping" });
    if (!checks) h.env.slots.forge = { ...h.env.slots.forge, capabilities: { ...h.env.slots.forge.capabilities, checks: false } };
    h.items.push(trackerItem(1));
    h.changes["norn/lt-1"] = { ...OPEN, draft: true };
    return h;
  }

  test("ci waits on the forge's checks and goes to ready once they pass; past ready, mark-ready runs and the merge ends the story", async () => {
    const h = await shipping(true);
    h.forge.checks[4] = "pending";
    await tickUntil(h, has("await.waiting"));
    expect((await record(h, "lt-1")).state?.step).toBe("ci");
    h.forge.checks[4] = "success";
    await tickUntil(h, has("gate.park"));
    const st = (await record(h, "lt-1")).state;
    await h.env.journal.record("lt-1", { id: "01JD5G0000APPROVE000000000", data: { kind: "gate.decided", outcome: "approve", by: "person", step: st?.step, attempt: st?.attempt } });
    await tickUntil(h, has("await.start"));
    expect(h.stepCalls.map((c) => c.kind)).toEqual(["open-pr", "mark-ready"]);
    expect((await record(h, "lt-1")).state?.step).toBe("merge");
    h.changes["norn/lt-1"] = { ...OPEN, state: "merged", merge_sha: "m1", merged_at: h.clock.now() };
    await tickUntil(h, has("claim.release"));
    expect((await record(h, "lt-1")).state?.ended).toBe("done");
  });

  test("a forge without checks goes straight from ci to ready", async () => {
    const h = await shipping(false);
    await tickUntil(h, has("gate.park"));
    expect(h.forge.calls.some((c) => c.startsWith("checks"))).toBe(false);
    expect((await record(h, "lt-1")).receipts.find((r) => r.data.kind === "step.finished" && r.data.step === "ci")?.data).toMatchObject({ outcome: "ci.none" });
  });

  test("a red CI leaves through ci-failed back to the step the workflow names, counted on the exit's counter", async () => {
    const h = await shipping(true);
    h.forge.checks[4] = "failure";
    await tickUntil(h, has("agent.start"));
    expect((await record(h, "lt-1")).state).toMatchObject({ step: "fix", counters: { "ship.ci-failed": 1 } });
  });
});
