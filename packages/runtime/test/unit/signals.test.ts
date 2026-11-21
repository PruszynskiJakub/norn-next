import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, type SignalWorld, scriptedExec, signalSourceContract } from "@norn/conformance";
import type { RunState } from "@norn/kernel";
import { type ChangeRequest, defineNornPlugin, fail, ok, type PluginResult, type SignalReadInput } from "@norn/plugin-api";
import type { Signal } from "@norn/schema";
import { type AgentRunRequest, clockSignalSource, collectSignals, gatherFacts, loadPinned, materializeInputs, reportRun, vcsSignalSources, waitingVisit } from "../../src/index.ts";
import { type Harnessed, has, harness, MINUTE, record, START, tickUntil, trackerItem } from "./support.ts";

const HOUR = 60 * MINUTE;

/** A plugin reporting the `ticked` signal from what the test answers, recording every ask. */
function ticker(asked: SignalReadInput[], answer: () => PluginResult<Signal | null> | Promise<PluginResult<Signal | null>>) {
  return defineNornPlugin({
    name: "ticker",
    api: "^1.19",
    provides: {
      signals: {
        ticked: {
          read: async (input) => {
            asked.push(input);
            return answer();
          },
        },
      },
    },
  });
}

async function gathered(h: Harnessed) {
  const r = await gatherFacts(h.env, h.tickIds[0] as string);
  if (!r.ok) throw new Error(r.failure.message);
  return { signals: r.value.facts.stories[0]?.signals ?? [], problems: r.value.problems };
}

async function stateOf(h: Harnessed): Promise<RunState> {
  const state = (await record(h, "lt-1")).state;
  if (!state) throw new Error("lt-1 has no state");
  return state;
}

describe("the waiting visit", () => {
  test("a gate waits from its park, a wait step from its run or from now before its run starts, and an ended unit is not waiting", async () => {
    const asked: SignalReadInput[] = [];
    const h = harness({ workflow: "signalled", plugins: [ticker(asked, () => ok(null))] });
    h.stepAnswers["await-thing"] = ["waiting"];
    h.items.push(trackerItem(1));
    const graph = () => {
      const load = h.env.workflows.signalled;
      if (!load?.ok) throw new Error("signalled does not load");
      return load.workflow.graph;
    };
    await tickUntil(h, has("round.start"));
    expect(waitingVisit(h.env, await stateOf(h), graph())).toBeNull();
    await tickUntil(h, has("step.poll"));
    const waiting = await stateOf(h);
    expect(waitingVisit(h.env, waiting, graph())).toEqual({ step: "wait", visit: "wait#1", since: waiting.run?.started_at as string });
    // the tick that starts the wait step's run reads its signals too
    expect(waitingVisit(h.env, { ...waiting, run: null }, graph())).toEqual({ step: "wait", visit: "wait#1", since: h.env.ctx.now() });
    h.stepAnswers["await-thing"] = ["ready"];
    await tickUntil(h, has("gate.park"));
    const parked = await stateOf(h);
    expect(waitingVisit(h.env, parked, graph())).toEqual({ step: "ready", visit: "ready#1", since: parked.parked?.since as string });
    expect(waitingVisit(h.env, { ...parked, ended: "stuck" }, graph())).toBeNull();
  });
});

describe("plugin signal sources", () => {
  test("a workflow routing a plugin's signal loads, and reloads from its pinned document to the same hash", () => {
    const h = harness({ workflow: "signalled", plugins: [ticker([], () => ok(null))] });
    const load = h.env.workflows.signalled;
    if (!load?.ok) throw new Error("signalled does not load");
    expect(load.workflow.graph.steps.ready?.signals?.map((x) => x.name)).toEqual(["timeout", "ticked"]);
    expect(loadPinned(h.env, load.workflow.pinned)?.pinned.hash).toBe(load.workflow.pinned.hash);
    // without the plugin, the signal is unknown and the workflow is refused by name
    expect(harness({ workflow: "signalled" }).env.workflows.signalled?.ok).toBe(false);
  });
  test("two plugins providing one signal are a refusal, never a pick", () => {
    const r = collectSignals([ticker([], () => ok(null)), { ...ticker([], () => ok(null)), name: "again" }]);
    expect(r.ok ? null : r.failure.message).toBe("signal ticked is provided by ticker and again");
  });
});

describe("gathering signals", () => {
  test("a source is asked only for the story waiting at a step that routes its signal", async () => {
    const asked: SignalReadInput[] = [];
    const h = harness({ workflow: "signalled", plugins: [ticker(asked, () => ok(null))] });
    h.stepAnswers["await-thing"] = ["waiting"];
    h.items.push(trackerItem(1));
    await tickUntil(h, has("step.poll"));
    // the wait step routes only timeout, the probe before it nothing
    expect(asked).toEqual([]);
    h.stepAnswers["await-thing"] = ["ready"];
    await tickUntil(h, has("gate.park"));
    expect(asked.at(-1)).toMatchObject({ story: "lt-1", step: "ready", visit: "ready#1", branch: "norn/lt-1", base: { branch: "main", ref: "main" }, change: null });
  });

  test("timeout fires once the visit is older than after:, named by the visit, and a new visit waits afresh", async () => {
    const h = harness({ workflow: "signalled", plugins: [ticker([], () => ok(null))] });
    h.stepAnswers["await-thing"] = ["waiting"];
    h.items.push(trackerItem(1));
    await tickUntil(h, has("step.poll"));
    const since = (await stateOf(h)).run?.started_at as string;
    expect((await gathered(h)).signals).toEqual([]);
    h.clock.advance(HOUR);
    expect((await gathered(h)).signals).toEqual([{ type: "timeout", source: "clock", id: "wait#1", at: new Date(Date.parse(since) + HOUR).toISOString() }]);
    await tickUntil(h, has("step.signal"));
    await tickUntil(h, has("step.poll"));
    expect((await stateOf(h)).step).toBe("wait");
    expect((await gathered(h)).signals).toEqual([]);
    h.clock.advance(HOUR);
    expect((await gathered(h)).signals.map((s) => s.id)).toEqual(["wait#2"]);
  });

  test("a source that fails, throws or answers no valid signal of its name is left out and named; null is nothing", async () => {
    let answer: () => PluginResult<Signal | null> = () => ok(null);
    const h = harness({ workflow: "signalled", plugins: [ticker([], () => answer())] });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.park"));
    expect(await gathered(h)).toEqual({ signals: [], problems: [] });
    answer = () => fail("unavailable", "ticker is down");
    expect(await gathered(h)).toEqual({ signals: [], problems: ["lt-1: signal ticked from ticker: ticker is down"] });
    answer = () => {
      throw new Error("boom");
    };
    expect(await gathered(h)).toEqual({ signals: [], problems: ["lt-1: signal ticked from ticker threw: boom"] });
    answer = () => ok({ type: "stale", source: "ticker", id: "t1" });
    expect((await gathered(h)).problems).toEqual(["lt-1: signal ticked from ticker: answered a stale signal when asked for ticked"]);
    answer = () => ok({ type: "ticked", source: "ticker", id: "" });
    const invalid = await gathered(h);
    expect(invalid.signals).toEqual([]);
    expect(invalid.problems[0]).toStartWith("lt-1: signal ticked from ticker: answered no signal: /id");
    answer = () => ok({ type: "ticked", source: "ticker", id: "t1" });
    expect(await gathered(h)).toEqual({ signals: [{ type: "ticked", source: "ticker", id: "t1" }], problems: [] });
  });

  test("a local gathering asks no source", async () => {
    const asked: SignalReadInput[] = [];
    let answer: Signal | null = null;
    const h = harness({ workflow: "signalled", plugins: [ticker(asked, () => ok(answer))] });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.park"));
    answer = { type: "ticked", source: "ticker", id: "t1" };
    const before = asked.length;
    const r = await gatherFacts(h.env, h.tickIds[0] as string, { local: true });
    expect(r.ok && r.value.facts.stories[0]?.signals).toBeUndefined();
    expect(asked).toHaveLength(before);
  });
});

describe("a signal's detail", () => {
  test("reaches the agent step the signal sent the story to, as an input", async () => {
    const h = harness({ workflow: "signalled", plugins: [ticker([], () => ok({ type: "ticked", source: "ticker", id: "t1", detail: { failed: ["lint"] } }))] });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.signal"));
    const finished = (await record(h, "lt-1")).receipts.findLast((r) => r.data.kind === "step.finished");
    expect(finished?.data).toMatchObject({ outcome: "ticked", signal: { type: "ticked", source: "ticker", id: "t1" }, detail: { failed: ["lint"] } });
    await tickUntil(h, has("agent.start"));
    const run = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const got = await materializeInputs(h.env, await record(h, "lt-1"), run.brief, run.worktree);
    if (!got.ok) throw new Error(got.failure.message);
    const input = got.value.inputs.find((i) => i.name === "signal");
    expect(input?.path).toBe(".agents/run/in/signal.md");
    expect(input?.text).toContain("`ready` was moved by the signal `ticked`, reported by ticker for occurrence `t1`.");
    expect(h.files.snapshot()[`${run.worktree}/.agents/run/in/signal.md`]).toContain('"lint"');
    // back at the gate, the same occurrence is still reported: it fired this round, so the gate waits for a person
    const reported = await reportRun(h.env, "lt-1", run.run_id, { verb: "done", outcome: "done" }, "r1");
    expect(reported.ok).toBe(true);
    await tickUntil(h, has("gate.park"));
    expect((await stateOf(h)).signals_fired).toEqual([{ type: "ticked", id: "t1" }]);
    // a later agent visit works from what the first made of the signal, so it no longer gets it
    const later = await materializeInputs(h.env, await record(h, "lt-1"), { ...run.brief, inputs: [] }, run.worktree);
    expect(later.ok && later.value.inputs.map((i) => i.name)).toEqual(["handoff"]);
  });
});

/** The vcs source over the fake vcs of a harness, the story at a gate routing `stale` and `unpushed`. */
function vcsWorld(signal: "stale" | "unpushed"): SignalWorld {
  const h = harness({ workflow: "pushed" });
  const load = h.env.workflows.pushed;
  if (!load?.ok) throw new Error("pushed does not load");
  let failing = false;
  let conflicts: string[] = [];
  const change: ChangeRequest = { id: 4, state: "open", draft: true, head_branch: "norn/lt-1", base_branch: "main", head_sha: "b2", title: "Story 1" };
  const vcs = h.env.slots.vcs;
  const ancestor = vcs.isAncestor.bind(vcs);
  // a story head ahead of the change contains its head; the fake vcs reads only a commit as its own ancestor
  vcs.isAncestor = async (a, b) => (failing ? fail("unavailable", "git is down") : signal === "unpushed" ? ok(true) : ancestor(a, b));
  vcs.conflicts = async () => ok(conflicts);
  h.heads["norn/lt-1"] = "b2";
  h.heads.main = "b2";
  const EFFECTS = new Set(["ensure", "remove", "merge", "deleteBranch", "push", "fetch"]);
  return {
    name: signal,
    source: vcsSignalSources(h.env, load.workflow.graph)[signal],
    input: () => ({ story: "lt-1", step: "ready", visit: "ready#1", since: START, change: structuredClone(change) }),
    ctx: h.ctx,
    happen: (on) => {
      if (signal === "stale") {
        h.heads.main = on ? "m2" : "b2";
        conflicts = on ? ["shared.txt"] : [];
      } else h.heads["norn/lt-1"] = on ? "c3" : "b2";
    },
    failing: (on) => {
      failing = on;
    },
    again: () => {
      if (signal === "stale") h.heads.main = "m3";
      else h.heads["norn/lt-1"] = "c4";
    },
    effects: () => ({ vcs: h.vcsCalls.filter((c) => EFFECTS.has(c.op)), files: h.files.snapshot(), exec: h.exec.calls.length }),
  };
}

signalSourceContract("the host's vcs source: stale", () => vcsWorld("stale"));
signalSourceContract("the host's vcs source: unpushed", () => vcsWorld("unpushed"));

signalSourceContract("the host's clock source: timeout", () => {
  let t = Date.parse(START);
  let failing = false;
  let visit = 3;
  let since = START;
  const files = memoryFiles();
  const exec = scriptedExec(() => undefined);
  return {
    name: "timeout",
    source: clockSignalSource,
    params: { after: "1h" },
    input: () => ({ story: "lt-1", step: "ready", visit: `ready#${visit}`, since }),
    ctx: memoryHost({ files, exec, now: () => (failing ? "not a time" : new Date(t).toISOString()) }),
    happen: (on) => {
      t = Date.parse(since) + (on ? 2 * HOUR : 30 * MINUTE);
    },
    failing: (on) => {
      failing = on;
    },
    again: () => {
      visit++;
      since = new Date(t).toISOString();
      t += 2 * HOUR;
    },
    effects: () => ({ files: files.snapshot(), exec: exec.calls.length }),
  };
});
