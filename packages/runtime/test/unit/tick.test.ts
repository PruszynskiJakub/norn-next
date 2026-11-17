import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { parseJson } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { acquireTickLock, createRuntime, tickLockPath, tracePath } from "../../src/index.ts";
import { has, harness, MINUTE, type Report, record, rulesOf, session, START, tickUntil, trackerItem } from "./support.ts";

const lastRules = (reports: Report[]) => reports.map(rulesOf);

describe("a story from intake to done", () => {
  test("a check step: intake, claim, round, check, apply, done, release", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    const reports = await tickUntil(h, has("claim.release"));
    expect(lastRules(reports)).toEqual([
      ["- intake.story"],
      ["- claim.take", "lt-1 claim.pending"],
      ["lt-1 round.start"],
      ["lt-1 check.run"],
      ["lt-1 receipts.apply"],
      ["- claim.renew", "lt-1 check.finished"],
      ["lt-1 unit.ended.done", "- claim.release"],
    ]);
    const unit = await record(h, "lt-1");
    expect(unit.state?.ended).toBe("done");
    expect(unit.receipts.map((r) => r.data.kind)).toEqual(["round.started", "run.started", "check.finished"]);
    // the worktree is the unit's own, on a branch cut from the base, and the check ran in it
    expect(h.vcsCalls.find((c) => c.op === "ensure")?.args).toEqual(["lt-1", "norn/lt-1", "main"]);
    expect(h.exec.calls.map((c) => [c.argv, c.opts.cwd, c.opts.timeoutMs])).toEqual([[["sh", "-c", "bun test"], "/machine/repo/worktrees/lt-1", 300_000]]);
    const claim = await h.env.slots.store.claims.read("lt-1");
    expect(claim.ok && claim.value).toBeNull();
  });

  test("an agent step: the launcher starts it with its brief, the report routes it, and the ended run is stopped", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const [start] = h.launcher.of("start");
    expect(start?.[0]).toMatchObject({ unit: "lt-1", step: "build", executor: "claude", attended: false, worktree: "/machine/repo/worktrees/lt-1", brief: { workflow: "agented", step: "build", attempt: 1, skills: ["norn-implement"] } });
    await tickUntil(h, has("receipts.apply"));
    const handle = (await record(h, "lt-1")).state?.run?.session;
    expect(handle).toStartWith("h-");
    h.sessions.byUnit.set("lt-1", session("reported", { report: { verb: "done", outcome: "done" } }));
    await tickUntil(h, has("agent.reported"));
    expect((await record(h, "lt-1")).state?.ended).toBe("done");
    expect(h.launcher.of("stop")).toEqual([[handle]]);
  });

  test("plugin steps get the slots and their config; a wait step is polled until it answers", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    h.stepAnswers["await-thing"] = ["waiting", "waiting", "ready"];
    const reports = await tickUntil(h, has("gate.park"));
    expect(reports.flatMap(rulesOf).filter((r) => r.includes("step."))).toEqual(["lt-1 step.run", "lt-1 step.finished", "lt-1 step.run", "lt-1 step.poll", "lt-1 step.poll", "lt-1 step.finished"]);
    const probe = h.stepCalls.find((c) => c.kind === "probe")?.input as Record<string, unknown> & { slots: Record<string, { name: string }> };
    expect(probe).toMatchObject({ unit: "lt-1", story: "lt-1", step: "poke", config: { note: "hi" }, worktree: "/machine/repo/worktrees/lt-1", branch: "norn/lt-1", base: { branch: "main", ref: "main" } });
    // an effect runs under its intent, whose id keys the effects it asks a provider for; a wait poll after the first has none
    const intents = h.stepCalls.map((c) => (c.input as { receipt_id?: string }).receipt_id);
    expect(typeof intents[0]).toBe("string");
    expect(intents.at(-1)).toBeUndefined();
    expect([probe.slots.vcs?.name, probe.slots.forge?.name, probe.slots.tracker?.name]).toEqual(["fake", "fake", "fake"]);
    expect(h.stepCalls.filter((c) => c.kind === "await-thing")).toHaveLength(3);
  });
});

describe("the trace", () => {
  test("every tick writes its facts, decisions and outcomes under trace-v2", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    const [r] = (await tickUntil(h, () => true)) as [Report];
    const text = await h.files.read(tracePath(h.ctx, r.tick_id));
    const doc = parseJson(Type.Object({ tick_id: Type.String(), decisions: Type.Array(Type.Unknown()), outcomes: Type.Array(Type.Unknown()), facts: Type.Object({ intake: Type.Array(Type.Unknown()) }, { additionalProperties: true }) }, { additionalProperties: true }), text ?? "", "trace");
    expect(doc.ok && [doc.value.tick_id, doc.value.decisions.length, doc.value.outcomes.length, doc.value.facts.intake.length]).toEqual([r.tick_id, 1, 1, 1]);
  });
});

describe("one unit's failure", () => {
  test("a failing action is recorded and the other units' actions still run", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1), trackerItem(2));
    h.launcher.failStart.set("lt-1", "throw");
    const reports = await tickUntil(h, has("agent.start"));
    const last = reports.at(-1) as Report;
    expect(rulesOf(last)).toEqual(["lt-1 agent.start !unknown: effect for " + (last.decisions[0] as { intent: { id: string } }).intent.id + " threw: launch of lt-1 crashed", "lt-2 agent.start"]);
    expect(h.launcher.of("start").map((a) => (a[0] as { unit: string }).unit)).toEqual(["lt-1", "lt-2"]);
    expect((last.outcomes[0] as { retryable: boolean }).retryable).toBe(false);
  });

  test("a story whose claim cannot be read is left out whole and named in the problems", async () => {
    const h = harness();
    h.items.push(trackerItem(1), trackerItem(2));
    await tickUntil(h, has("round.start"));
    await h.files.write("/machine/repo/runs-v2/stories/lt-1/claim.json", "{ torn");
    const r = await h.runtime.tick();
    expect(r.problems.some((p) => p.startsWith("lt-1 left out: claim:"))).toBe(true);
    expect(r.decisions.every((d) => d.unit !== "lt-1")).toBe(true);
    expect(rulesOf(r)).toContain("lt-2 check.run");
  });
});

describe("the tick lock", () => {
  test("a tick refuses to run while another holds the lock, and runs again once it is released", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    const [a, b] = await Promise.all([h.runtime.tick(), h.runtime.tick()]);
    expect([a?.skipped, b?.skipped]).toEqual([undefined, "locked"]);
    expect(b?.decisions).toEqual([]);
    expect(await h.files.read(tickLockPath(h.ctx))).toBeNull();
    expect((await h.runtime.tick()).skipped).toBeUndefined();
  });

  test("a live lock holds; one older than the stale timeout is taken over", async () => {
    const h = harness();
    await h.files.write(tickLockPath(h.ctx), `${JSON.stringify({ tick_id: "other", at: START })}\n`);
    h.clock.advance(5 * MINUTE);
    expect((await h.runtime.tick()).skipped).toBe("locked");
    h.clock.advance(6 * MINUTE);
    expect((await h.runtime.tick()).skipped).toBeUndefined();
    expect(await h.files.read(tickLockPath(h.ctx))).toBeNull();
  });

  test("a tick that outlives the stale timeout keeps its lock with a heartbeat, so no other tick takes it over", async () => {
    const h = harness();
    const staleMs = 200;
    const held = await acquireTickLock(h.ctx, "long", staleMs);
    expect(held).not.toBeNull();
    // a long check: the host's clock moves past the stale timeout while the tick still runs
    h.clock.advance(3 * staleMs);
    await Bun.sleep(3 * Math.floor(staleMs / 4));
    expect(await acquireTickLock(h.ctx, "other", staleMs)).toBeNull();
    expect(await h.files.read(tickLockPath(h.ctx))).toContain('"tick_id":"long"');
    await held?.release();
    expect(await h.files.read(tickLockPath(h.ctx))).toBeNull();
    // released: no beat writes the lock back
    await Bun.sleep(2 * Math.floor(staleMs / 4));
    expect(await h.files.read(tickLockPath(h.ctx))).toBeNull();
  });

  test("an unreadable lock was left by a writer that died mid-write, and is taken over", async () => {
    const h = harness();
    await h.files.write(tickLockPath(h.ctx), "{");
    expect((await h.runtime.tick()).skipped).toBeUndefined();
  });

  test("a tick that lost its lock to a takeover does not remove the new holder's lock", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    const files = h.files;
    const write = files.write.bind(files);
    // another tick takes the lock over while this one is still writing its trace
    files.write = async (path, data) => {
      if (path.includes("trace-v2")) await write(tickLockPath(h.ctx), '{"tick_id":"usurper","at":"2026-11-17T09:00:00.000Z"}\n');
      return write(path, data);
    };
    await h.runtime.tick();
    expect(await h.files.read(tickLockPath(h.ctx))).toContain("usurper");
  });
});

describe("createRuntime", () => {
  test("a slot no configured plugin provides is a refusal naming it", () => {
    const h = harness();
    const r = createRuntime({ ctx: memoryHost(), plugins: h.plugins, config: { ...h.config, vcs: { name: "hg" } }, launcher: h.launcher, sessions: h.sessions });
    expect(r.ok ? null : r.failure).toEqual({ code: "not_found", message: 'no configured plugin provides vcs "hg"', retryable: false });
    const e = createRuntime({ ctx: memoryHost(), plugins: h.plugins, config: { ...h.config, executors: { codex: { name: "codex" } } }, launcher: h.launcher, sessions: h.sessions });
    expect(e.ok ? null : e.failure.message).toBe('no configured plugin provides harness "codex"');
  });
});
