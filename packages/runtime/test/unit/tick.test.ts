import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { parseJson } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { acquireTickLock, createRuntime, readStoryDoc, tickLockPath, tracePath, writeStoryDoc } from "../../src/index.ts";
import { type Harnessed, has, harness, MINUTE, type Report, record, rulesOf, session, START, tickUntil, trackerItem } from "./support.ts";

const lastRules = (reports: Report[]) => reports.map(rulesOf);

describe("a story from intake to done", () => {
  test("a check step: intake, claim, round, check, apply, done, finish, release", async () => {
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
      ["- story.finish", "- claim.release"],
    ]);
    // finished: the ticks after decide nothing, rather than a noop per ended unit on every one
    expect(rulesOf(await h.runtime.tick())).toEqual([]);
    const unit = await record(h, "lt-1");
    expect(unit.state?.ended).toBe("done");
    expect(unit.receipts.map((r) => r.data.kind)).toEqual(["round.started", "run.started", "check.finished"]);
    // the worktree is the unit's own, on a branch cut from the base, and the check ran in it
    expect(h.vcsCalls.find((c) => c.op === "ensure")?.args).toEqual(["lt-1", "norn/lt-1", "main"]);
    expect(h.exec.calls.map((c) => [c.argv, c.opts.cwd, c.opts.timeoutMs])).toEqual([[["sh", "-c", "bun test"], "/machine/repo/worktrees/lt-1", 300_000]]);
    const claim = await h.env.slots.store.claims.read("lt-1");
    expect(claim.ok && claim.value).toBeNull();
    // finishing a round that ended done removes its worktree; with no merged change the item stays open for a next round
    expect(h.items[0]?.open).toBe(true);
    expect(h.vcsCalls.filter((c) => c.op === "remove").map((c) => c.args)).toEqual([["lt-1"]]);
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
    // the story's finish closes what the ended run left open (its pane) and removes its worktree
    await tickUntil(h, has("story.finish"));
    expect(h.launcher.of("close")).toEqual([[handle]]);
    expect(h.vcsCalls.filter((c) => c.op === "remove").map((c) => c.args)).toEqual([["lt-1"]]);
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

describe("the ref the base is measured at", () => {
  const withRemote = (h: Harnessed, copies: Record<string, string | null>) => {
    h.env.slots.vcs.remoteRef = async (branch) => ({ ok: true, value: copies[branch] ?? null });
  };
  const cutAndStep = async (h: Harnessed) => {
    h.items.push(trackerItem(1));
    await tickUntil(h, has("step.finished"));
    const probe = h.stepCalls.find((c) => c.kind === "probe")?.input as { base: unknown };
    return { cut: h.vcsCalls.find((c) => c.op === "ensure")?.args, base: probe.base };
  };

  test("a vcs with the remote's fetched copy of the base: the branch is cut from it and step kinds take it, never the local base", async () => {
    const h = harness({ workflow: "stepped" });
    withRemote(h, { main: "origin/main" });
    expect(await cutAndStep(h)).toEqual({ cut: ["lt-1", "norn/lt-1", "origin/main"], base: { branch: "main", ref: "origin/main" } });
  });

  test("without a remote copy the local base serves", async () => {
    const h = harness({ workflow: "stepped" });
    withRemote(h, {});
    expect(await cutAndStep(h)).toEqual({ cut: ["lt-1", "norn/lt-1", "main"], base: { branch: "main", ref: "main" } });
  });

  test("a base_ref the config names wins over the remote copy", async () => {
    const h = harness({ workflow: "stepped" });
    withRemote(h, { main: "origin/main" });
    h.env.config.baseRef = "upstream/trunk";
    expect(await cutAndStep(h)).toEqual({ cut: ["lt-1", "norn/lt-1", "upstream/trunk"], base: { branch: "main", ref: "upstream/trunk" } });
  });
});

describe("a slices step reads the plan from the story's slice files", () => {
  const sliceFile = (id: string, deps: string[], status = "planned") => ["---", `id: ${id}`, `depends_on: [${deps.join(", ")}]`, `status: ${status}`, "---", "## Goal", ""].join("\n");
  const sliced = () => {
    const h = harness({ workflow: "sliced", kernel: { sliceWorkflow: "checked" } });
    h.items.push(trackerItem(1));
    return h;
  };
  const write = async (h: Harnessed, path: string, text: string) => {
    const wrote = await writeStoryDoc(h.env, "lt-1", path, text);
    if (!wrote.ok) throw new Error(wrote.failure.message);
  };

  test("slices start as their dependencies end done, and the step ends done with the last", async () => {
    const h = sliced();
    await write(h, "slices/01-parse.md", sliceFile("lt-1/01", []));
    await write(h, "slices/02-render.md", sliceFile("lt-1/02", ["lt-1/01"]));
    await write(h, "slices/03-dropped.md", sliceFile("lt-1/03", [], "dropped"));
    const reports = await tickUntil(h, has("claim.release"), 40);
    const starts = reports.flatMap((r) => r.outcomes.map((o) => o.decision)).filter((d) => d.kind === "start_slices");
    expect(starts.map((d) => (d.kind === "start_slices" ? d.slices.map((x) => x.unit) : []))).toEqual([["lt-1/01"], ["lt-1/02"]]);
    for (const unit of ["lt-1", "lt-1/01", "lt-1/02"]) expect((await record(h, unit)).state?.ended).toBe("done");
  });

  test("no slice files ends the step stuck; a file that fails validation parks it, naming the file", async () => {
    const none = sliced();
    await tickUntil(none, has("slices.none"));
    expect((await record(none, "lt-1")).state?.ended).toBe("stuck");
    const bad = sliced();
    await write(bad, "slices/01-parse.md", sliceFile("lt-1/02", []));
    const d = await tickUntil(bad, has("slices.plan_invalid"));
    expect(JSON.stringify(d.at(-1)?.outcomes)).toContain("slices/01-parse.md has id");
    const missing = sliced();
    await write(missing, "slices/01-parse.md", sliceFile("lt-1/01", ["lt-1/04"]));
    expect(JSON.stringify((await tickUntil(missing, has("slices.plan_invalid"))).at(-1)?.outcomes)).toContain("lt-1/01 depends on lt-1/04");
  });

  test("a slice file a person wrote in the story's worktree is read back before the plan", async () => {
    const h = sliced();
    await h.files.write("/machine/repo/worktrees/lt-1/.agents/specs/lt-1/slices/01-parse.md", sliceFile("lt-1/01", []));
    await tickUntil(h, has("slices.start"));
    expect(await readStoryDoc(h.env, "lt-1", "slices/01-parse.md")).toMatchObject({ value: expect.stringContaining("id: lt-1/01") });
  });
});

describe("a person's rerun", () => {
  /** Record what `norn done` or `norn stuck` records for the unit's current run. */
  async function report(h: ReturnType<typeof harness>, verb: "done" | "stuck", outcome?: string) {
    const state = (await record(h, "lt-1")).state;
    const run = state?.run;
    if (!state || !run) throw new Error("no run on the record");
    const data = { kind: "run.reported" as const, run_id: run.id, verb, ...(outcome ? { outcome } : {}), step: state.step, attempt: state.attempt };
    const wrote = await h.env.journal.record("lt-1", { id: `report-${run.id}`, data });
    if (!wrote.ok) throw new Error(wrote.failure.message);
  }

  async function move(h: ReturnType<typeof harness>, to: string) {
    const state = (await record(h, "lt-1")).state;
    if (!state) throw new Error("no run state");
    const wrote = await h.env.journal.record("lt-1", { id: `move-${state.step}-${state.attempt}`, data: { kind: "step.moved", to, by: "a-person", step: state.step, attempt: state.attempt } });
    if (!wrote.ok) throw new Error(wrote.failure.message);
  }

  test("a stuck unit moved back to an earlier step runs that step on the next ticks", async () => {
    const h = harness({ workflow: "handed" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    await report(h, "done", "done");
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, "lt-1")).state).toMatchObject({ step: "review", attempt: 1 });
    await report(h, "stuck");
    await tickUntil(h, has("claim.release"));
    expect((await record(h, "lt-1")).state).toMatchObject({ step: "review", ended: "stuck" });

    await move(h, "build");
    const reports = await tickUntil(h, has("agent.start"));
    expect(lastRules(reports)).toEqual([["- claim.take", "lt-1 claim.pending"], ["lt-1 unit.move"], ["lt-1 agent.start"]]);
    const unit = await record(h, "lt-1");
    expect(unit.state).toMatchObject({ step: "build", attempt: 2 });
    expect(unit.state?.ended).toBeUndefined();
    expect(unit.receipts.at(-1)?.data).toMatchObject({ kind: "run.started", step: "build", attempt: 2 });
    const starts = h.launcher.of("start").map(([run]) => (run as { step: string }).step);
    expect(starts).toEqual(["build", "review", "build"]);
  });

  test("a rerun of a step whose agent is at work stops its session before the move, then starts the step again", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const handle = (await record(h, "lt-1")).state?.run?.session;
    h.sessions.byUnit.set("lt-1", session("working"));
    await move(h, "build");
    const stopped = await tickUntil(h, has("unit.move.stop"));
    // the session is stopped before the move is applied: the unit is still at its visit with the run on the record
    expect(h.launcher.of("stop")).toEqual([[handle]]);
    expect((await record(h, "lt-1")).state).toMatchObject({ step: "build", attempt: 1, run: { session: handle } });
    const reports = [...stopped, ...(await tickUntil(h, has("agent.start")))];
    expect(lastRules(reports).map((rs) => rs.filter((r) => r !== "- claim.renew"))).toEqual([["lt-1 unit.move.stop"], ["lt-1 unit.move"], ["lt-1 agent.start"]]);
    // committing the move stops the replaced run again, as every commit that takes a run off the record does
    expect(new Set(h.launcher.of("stop").flat())).toEqual(new Set([handle]));
    const unit = await record(h, "lt-1");
    expect(unit.state).toMatchObject({ step: "build", attempt: 2 });
    expect(unit.receipts.map((r) => r.data.kind)).toEqual(["round.started", "run.started", "run.started", "step.moved", "stop.sent", "run.started", "run.started"]);
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
