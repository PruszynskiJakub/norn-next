import { describe, expect, test } from "bun:test";
import { manualClock, memoryFiles, memoryHost } from "@norn/conformance";
import { type BriefInputs, reduceSession } from "@norn/kernel";
import { fail, type Harness, type HarnessEvent, type LaunchRequest, ok, type PluginResult, readPromptMark, type Runner, type RunnerKey, type RunnerSplitRequest, type RunnerStartRequest } from "@norn/plugin-api";
import {
  type AgentRunRequest,
  answerFor,
  answerPromptId,
  appendEvents,
  claimReceived,
  decodeLaunchHandle,
  dialogInputId,
  HarnessLauncher,
  nudgePromptId,
  markDelivered,
  pendingInjections,
  readEvents,
  readSentPrompt,
  shellQuote,
  shimScript,
  WRITES_ENV,
} from "../../src/index.ts";

const START = "2026-11-17T09:00:00.000Z";
const SILENT_MS = 5 * 60_000;

interface FakeHarness extends Harness {
  installs: { worktree: string; hookCommand: string }[];
  launches: LaunchRequest[];
}

function fakeHarness(over: Partial<Harness["capabilities"]> = {}): FakeHarness {
  const installs: FakeHarness["installs"] = [];
  const launches: LaunchRequest[] = [];
  return {
    name: "fake",
    capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: true, promptMarks: true, ...over },
    installs,
    launches,
    install: async (target) => {
      installs.push(target);
      return { changed: [] };
    },
    uninstall: async () => ({ changed: [] }),
    launch: (req) => {
      launches.push(req);
      return { argv: ["agent", ...(req.headless ? ["-p"] : []), req.prompt], env: { AGENT_MODE: "x" } };
    },
    normalize: () => [],
    respond: () => ({ stdout: "", exit_code: 0 }),
    dialogKeys: (answer) => (/^\d$/.test(answer) ? [{ text: answer }, { key: "enter" }] : answer === "no" ? [{ key: "esc" }] : null),
  };
}

interface FakeRunner extends Runner {
  starts: RunnerStartRequest[];
  sent: { handle: string; text: string }[];
  pressed: { handle: string; keys: readonly RunnerKey[] }[];
  stopped: string[];
  closed: { handle: string; key: string }[];
  focused: string[];
  splits: RunnerSplitRequest[];
  labels: Array<[string, string, number]>;
  live: Map<string, string>;
}

/** A runner idempotent by key, the way a real one finds its pane or process again. */
function fakeRunner(caps: Runner["capabilities"]): FakeRunner {
  const live = new Map<string, string>();
  const starts: RunnerStartRequest[] = [];
  const sent: FakeRunner["sent"] = [];
  const pressed: FakeRunner["pressed"] = [];
  const stopped: string[] = [];
  const closed: FakeRunner["closed"] = [];
  const focused: string[] = [];
  const splits: RunnerSplitRequest[] = [];
  const labels: FakeRunner["labels"] = [];
  let made = 0;
  return {
    name: caps.paneInput ? "pane" : "bg",
    capabilities: caps,
    starts,
    sent,
    pressed,
    stopped,
    closed,
    focused,
    splits,
    labels,
    live,
    start: async (req) => {
      starts.push(req);
      const existing = live.get(req.key);
      if (existing) return ok({ handle: existing });
      const handle = `proc|${++made}`;
      live.set(req.key, handle);
      return ok({ handle });
    },
    alive: async (h) => ok([...live.values()].includes(h)),
    send: async (handle, text): Promise<PluginResult<void>> => {
      if (!caps.paneInput) return fail("invalid", "no pane");
      sent.push({ handle, text });
      return ok(undefined);
    },
    ...(caps.paneInput && {
      keys: async (handle: string, keys: readonly RunnerKey[]): Promise<PluginResult<void>> => {
        pressed.push({ handle, keys });
        return ok(undefined);
      },
      focus: async (handle: string): Promise<PluginResult<boolean>> => {
        focused.push(handle);
        return ok([...live.values()].includes(handle));
      },
      split: async (req: RunnerSplitRequest): Promise<PluginResult<{ handle: string }>> => {
        splits.push(req);
        return ok({ handle: `split|${splits.length}` });
      },
      label: async (workspace: string, text: string, ttlMs: number): Promise<PluginResult<boolean>> => {
        labels.push([workspace, text, ttlMs]);
        return ok(workspace === "gh-12");
      },
    }),
    stop: async (handle) => {
      stopped.push(handle);
      for (const [k, v] of live) if (v === handle) live.delete(k);
      return ok(undefined);
    },
    close: async (handle, key) => {
      closed.push({ handle, key });
      return ok(true);
    },
  };
}

const brief: BriefInputs = { step: "build", prompt: "Build it." } as unknown as BriefInputs;

function run(over: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return { unit: "gh-12/03", run_id: "01JRUN0000000000000000000A", step: "build", executor: "pane", attended: true, worktree: "/wt/gh-12-03", brief, ...over };
}

function setup(opts: { bgHarness?: Partial<Harness["capabilities"]> } = {}) {
  const files = memoryFiles();
  const clock = manualClock(START);
  const ctx = memoryHost({ files, now: clock.now, repo: { root: "/repo", dataDir: "/m" } });
  const paneHarness = fakeHarness();
  const bgHarness = fakeHarness(opts.bgHarness);
  const pane = fakeRunner({ attended: true, headless: false, paneInput: true });
  const bg = fakeRunner({ attended: false, headless: true, paneInput: false });
  const briefs: string[] = [];
  const launcher = new HarnessLauncher({
    ctx,
    executors: { pane: { harness: paneHarness, runner: pane }, bg: { harness: bgHarness, runner: bg } },
    hookCommand: ["/opt/my tools/norn", "hook"],
    silentAfterMs: SILENT_MS,
    renderBrief: async (r) => {
      briefs.push(r.run_id);
      return ok(`# Brief for ${r.unit}`);
    },
  });
  return { ctx, files, clock, launcher, paneHarness, bgHarness, pane, bg, briefs };
}

describe("harness launcher start", () => {
  test("installs hooks with the quoted hook command, launches the marked brief and starts the runner keyed by the run id", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    expect(started.ok).toBe(true);
    expect(s.paneHarness.installs).toEqual([{ worktree: "/wt/gh-12-03", hookCommand: "'/opt/my tools/norn' hook fake" }]);
    const launch = s.paneHarness.launches[0] as LaunchRequest;
    expect(readPromptMark(launch.prompt)).toEqual({ source: "brief", id: "01JRUN0000000000000000000A" });
    expect(launch.prompt.startsWith("# Brief for gh-12/03")).toBe(true);
    expect(launch.env).toEqual({ NORN_UNIT: "gh-12/03", NORN_RUN_ID: "01JRUN0000000000000000000A" });
    expect(launch.headless).toBeUndefined();
    expect(s.pane.starts[0]).toMatchObject({
      key: "01JRUN0000000000000000000A",
      cwd: "/wt/gh-12-03",
      title: "gh-12/03 build",
      workspace: "gh-12",
      logPath: "/m/runtime/sessions/01JRUN0000000000000000000A.log",
      env: { AGENT_MODE: "x", NORN_UNIT: "gh-12/03", NORN_RUN_ID: "01JRUN0000000000000000000A" },
    });
    expect(Object.keys(s.pane.starts[0]?.env ?? {})).not.toContain("NORN_PROMPT_SOURCE");
    expect(await readSentPrompt(s.ctx, "gh-12/03", "01JRUN0000000000000000000A", "01JRUN0000000000000000000A")).toMatchObject({ source: "brief" });
    expect(started.ok && decodeLaunchHandle(started.value.handle)).toEqual({ executor: "pane", unit: "gh-12/03", run_id: "01JRUN0000000000000000000A", runner: "proc|1" });
  });

  test("a replayed start finds the first process: one runner process, the same handle", async () => {
    const s = setup();
    const first = await s.launcher.start(run());
    const again = await s.launcher.start(run());
    expect(again).toEqual(first);
    expect(s.pane.live.size).toBe(1);
    expect(s.pane.starts.map((r) => r.key)).toEqual(["01JRUN0000000000000000000A", "01JRUN0000000000000000000A"]);
  });

  test("a runner with no pane launches the harness headless", async () => {
    const s = setup();
    await s.launcher.start(run({ executor: "bg" }));
    expect(s.bgHarness.launches[0]?.headless).toBe(true);
    expect(s.bg.starts[0]?.argv.slice(0, 2)).toEqual(["agent", "-p"]);
  });

  test("a resume is passed to the harness", async () => {
    const s = setup();
    await s.launcher.start(run({ resume: "sess-9" }));
    expect(s.paneHarness.launches[0]?.resume).toBe("sess-9");
  });

  test("an agent launches on its step's model, else its executor's, and a resume keeps the model the run started on", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const withModel = new HarnessLauncher({
      ...s.launcher.opts,
      executors: { pane: { harness: s.paneHarness, runner: s.pane, model: "opus" }, bg: { harness: s.bgHarness, runner: s.bg, model: "opus" } },
    });
    await withModel.start(run());
    expect(s.paneHarness.launches[0]?.model).toBe("opus");
    const runId = "01JRUN0000000000000000000B";
    const started = await withModel.start(run({ executor: "bg", attended: false, run_id: runId, brief: { ...brief, model: "haiku" } }));
    expect(s.bgHarness.launches[0]?.model).toBe("haiku");
    if (!started.ok) throw new Error("start failed");
    await appendEvents(s.ctx, "gh-12/03", runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    s.bg.live.clear();
    expect(await withModel.answer(started.value.handle, "q1", "go left")).toEqual(ok(undefined));
    expect([s.bgHarness.launches[1]?.resume, s.bgHarness.launches[1]?.model]).toEqual(["sess-1", "haiku"]);
  });

  test("an executor with no model leaves the model to the harness", async () => {
    const s = setup();
    await s.launcher.start(run());
    expect(s.paneHarness.launches[0]?.model).toBeUndefined();
  });

  test("an unknown executor, a brief that cannot render and a failed runner start are refusals", async () => {
    const s = setup();
    expect(await s.launcher.start(run({ executor: "nope" }))).toMatchObject({ ok: false, failure: { code: "not_found" } });
    const broken = new HarnessLauncher({ ...s.launcher.opts, renderBrief: async () => fail("invalid", "no brief") });
    expect(await broken.start(run())).toMatchObject({ ok: false, failure: { message: "no brief" } });
    s.pane.start = async () => fail("unavailable", "herdr is down");
    expect(await s.launcher.start(run())).toMatchObject({ ok: false, failure: { message: "herdr is down" } });
  });
});

describe("harness launcher start of a docs-only step", () => {
  test("is refused on a harness that cannot deny a tool, before anything is installed or launched", async () => {
    const s = setup({ bgHarness: { denyTool: false } });
    const refused = await s.launcher.start(run({ executor: "bg", attended: false, writes: "docs" }));
    expect(refused).toMatchObject({ ok: false, failure: { code: "invalid", retryable: false } });
    expect(!refused.ok && refused.failure.message).toContain("writes: docs");
    expect(!refused.ok && refused.failure.message).toContain("run it on an executor whose harness can (by:)");
    expect([s.bgHarness.installs, s.bgHarness.launches, s.bg.starts]).toEqual([[], [], []]);
  });

  test("its launch, and a resume of it, carry the step's writes in the env, so the hook guard holds it with the record unreadable", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const runId = "01JRUN0000000000000000000B";
    const started = await s.launcher.start(run({ executor: "bg", attended: false, run_id: runId, writes: "docs" }));
    if (!started.ok) throw new Error("start failed");
    expect([s.bgHarness.launches[0]?.env[WRITES_ENV], s.bg.starts[0]?.env[WRITES_ENV]]).toEqual(["docs", "docs"]);
    await appendEvents(s.ctx, "gh-12/03", runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    s.bg.live.clear();
    expect(await s.launcher.answer(started.value.handle, "q1", "go left")).toEqual(ok(undefined));
    expect([s.bgHarness.launches[1]?.env[WRITES_ENV], s.bg.starts[1]?.env[WRITES_ENV]]).toEqual(["docs", "docs"]);
  });

  test("starts on a harness that denies a tool, and a step that writes its worktree starts on either", async () => {
    const s = setup({ bgHarness: { denyTool: false } });
    expect((await s.launcher.start(run({ writes: "docs" }))).ok).toBe(true);
    expect((await s.launcher.start(run({ executor: "bg", attended: false, run_id: "01JRUN0000000000000000000B" }))).ok).toBe(true);
  });
});

describe("the norn a launched agent runs", () => {
  const CLI = ["/opt/my tools/bun", "/src/cli/main.ts"];
  const withShim = (s: ReturnType<typeof setup>, over: Partial<HarnessLauncher["opts"]> = {}) =>
    new HarnessLauncher({ ...s.launcher.opts, hookCommand: [...CLI, "hook"], hostPath: "/usr/local/bin:/usr/bin", ...over });

  test("the launch env's PATH starts with a folder whose executable norn execs the launching CLI, the rest of the env kept", async () => {
    const s = setup();
    expect((await withShim(s).start(run())).ok).toBe(true);
    const launch = s.paneHarness.launches[0] as LaunchRequest;
    expect(launch.env).toEqual({ PATH: "/m/runtime/bin:/usr/local/bin:/usr/bin", NORN_UNIT: "gh-12/03", NORN_RUN_ID: "01JRUN0000000000000000000A" });
    expect(s.pane.starts[0]?.env).toMatchObject({ PATH: "/m/runtime/bin:/usr/local/bin:/usr/bin", AGENT_MODE: "x" });
    expect(s.files.executable("/m/runtime/bin/norn")).toBe(true);
    expect(await s.files.read("/m/runtime/bin/norn")).toBe(shimScript(CLI));
    expect(shimScript(CLI)).toContain(`exec '/opt/my tools/bun' /src/cli/main.ts "$@"\n`);
    expect(s.paneHarness.installs[0]?.hookCommand).toBe("'/opt/my tools/bun' /src/cli/main.ts hook fake");
  });

  test("the configured agent env goes with every launch, so a pane's shell and the agent's hooks find the same norn home", async () => {
    const s = setup();
    expect((await withShim(s, { agentEnv: { NORN_HOME_DIR: "/scratch/home" } }).start(run())).ok).toBe(true);
    expect(s.paneHarness.launches[0]?.env).toMatchObject({ NORN_HOME_DIR: "/scratch/home", PATH: "/m/runtime/bin:/usr/local/bin:/usr/bin" });
    expect(s.pane.starts[0]?.env).toMatchObject({ NORN_HOME_DIR: "/scratch/home" });
  });

  test("the shim is written once: an unchanged one is left, a host PATH that already holds its folder keeps it first and once", async () => {
    const s = setup();
    let writes = 0;
    const counted = s.files.writeExecutable;
    s.files.writeExecutable = async (path, data) => {
      writes++;
      await counted(path, data);
    };
    const launcher = withShim(s, { hostPath: "/usr/bin:/m/runtime/bin" });
    await launcher.start(run());
    await launcher.start(run({ run_id: "01JRUN0000000000000000000B", executor: "bg" }));
    expect(writes).toBe(1);
    expect(s.bgHarness.launches[0]?.env.PATH).toBe("/m/runtime/bin:/usr/bin");
  });

  test("no shim when it cannot help: a bare norn would exec itself, no host PATH is known, the host cannot make a file executable", async () => {
    const bare = setup();
    await withShim(bare, { hookCommand: ["norn", "hook"] }).start(run());
    const noPath = setup();
    await new HarnessLauncher({ ...noPath.launcher.opts, hookCommand: [...CLI, "hook"] }).start(run());
    const noExec = setup();
    const { writeExecutable: _, ...plain } = noExec.files;
    await withShim(noExec, { ctx: { ...noExec.ctx, files: plain } }).start(run());
    for (const s of [bare, noPath, noExec]) {
      expect(s.paneHarness.launches[0]?.env.PATH).toBeUndefined();
      expect(await s.files.read("/m/runtime/bin/norn")).toBeNull();
    }
  });

  test("a resumed launch takes the shim's PATH and the executor's args too", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const launcher = withShim(s, { executors: { pane: { harness: s.paneHarness, runner: s.pane }, bg: { harness: s.bgHarness, runner: s.bg, args: ["--permission-mode", "acceptEdits"] } } });
    const runId = "01JRUN0000000000000000000B";
    const started = await launcher.start(run({ executor: "bg", attended: false, run_id: runId }));
    if (!started.ok) throw new Error("start failed");
    expect(s.bgHarness.launches[0]?.args).toEqual(["--permission-mode", "acceptEdits"]);
    await appendEvents(s.ctx, "gh-12/03", runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    s.bg.live.clear();
    expect(await launcher.answer(started.value.handle, "q1", "go left")).toEqual(ok(undefined));
    const resumed = s.bgHarness.launches[1] as LaunchRequest;
    expect([resumed.resume, resumed.args, resumed.env.PATH]).toEqual(["sess-1", ["--permission-mode", "acceptEdits"], "/m/runtime/bin:/usr/local/bin:/usr/bin"]);
    expect(s.bg.starts[1]?.env.PATH).toBe("/m/runtime/bin:/usr/local/bin:/usr/bin");
  });

  test("an executor with no args leaves them to the harness's defaults", async () => {
    const s = setup();
    await s.launcher.start(run());
    expect(s.paneHarness.launches[0]?.args).toBeUndefined();
  });
});

describe("harness launcher nudge and answer", () => {
  test("with a pane, a nudge is recorded as sent and typed, marked with the id its decision gave it", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.nudge(started.value.handle, "carry on", nudgePromptId("01JINTENT/7"))).toEqual(ok(undefined));
    const typed = s.pane.sent[0];
    expect(typed?.handle).toBe("proc|1");
    const mark = readPromptMark(typed?.text ?? "");
    expect(mark).toEqual({ source: "nudge", id: "nudge-01JINTENT_7" });
    expect(await readSentPrompt(s.ctx, "gh-12/03", "01JRUN0000000000000000000A", mark?.id ?? "")).toMatchObject({ source: "nudge" });
  });

  test("a nudge replayed under its decision's id is the same prompt: once the hook saw it arrive it is not typed again", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    const id = nudgePromptId("01JINTENT7");
    await s.launcher.nudge(started.value.handle, "carry on", id);
    await claimReceived(s.ctx, "gh-12/03", "01JRUN0000000000000000000A", id);
    await s.launcher.nudge(started.value.handle, "carry on", id);
    expect(s.pane.sent).toHaveLength(1);
  });

  test("without a pane, a nudge replayed under its decision's id is queued once", async () => {
    const s = setup();
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    const id = nudgePromptId("01JINTENT7");
    await s.launcher.nudge(started.value.handle, "carry on", id);
    await s.launcher.nudge(started.value.handle, "carry on", id);
    expect((await pendingInjections(s.ctx, "gh-12/03", "01JRUN0000000000000000000A")).injections.map((p) => p.id)).toEqual([id]);
  });

  test("a replayed answer is typed again unless the hook already saw it arrive", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    const h = started.value.handle;
    await s.launcher.answer(h, "q/1", "left");
    await s.launcher.answer(h, "q/1", "left");
    expect(s.pane.sent).toHaveLength(2);
    const id = readPromptMark(s.pane.sent[0]?.text ?? "")?.id ?? "";
    expect(id).toBe("answer-q_1");
    expect(await readSentPrompt(s.ctx, "gh-12/03", "01JRUN0000000000000000000A", id)).toMatchObject({ source: "answer", input_id: "q/1" });
    await claimReceived(s.ctx, "gh-12/03", "01JRUN0000000000000000000A", id);
    await s.launcher.answer(h, "q/1", "left");
    expect(s.pane.sent).toHaveLength(2);
  });

  test("without a pane, a queued answer is delivered by the next hook that can carry context, and never dropped", async () => {
    const s = setup();
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.answer(started.value.handle, "q1", "go left")).toEqual(ok(undefined));
    expect(s.bg.sent).toEqual([]);
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const answerCtx = (pending: Awaited<ReturnType<typeof pendingInjections>>["injections"]) => ({
      worktree: "/wt/gh-12-03",
      protectedPaths: ["/m"],
      reported: false,
      needsReport: true,
      reportHint: "report with norn done",
      pending,
      capabilities: s.bgHarness.capabilities,
    });
    const ev = (e: Record<string, unknown>) => ({ run_id: runId, seq: 1, at: START, ...e }) as HarnessEvent;

    // a guard answer carries no context: the entry stays queued
    let pending = (await pendingInjections(s.ctx, unit, runId)).injections;
    const guard = answerFor([ev({ type: "tool.requested", id: "t1", kind: "read", tool: "Read" })], answerCtx(pending));
    expect(guard.delivers).toEqual([]);
    pending = (await pendingInjections(s.ctx, unit, runId)).injections;
    expect(pending.map((p) => p.id)).toEqual(["answer-q1"]);

    // the next context answer carries it, and only then is it marked delivered
    const next = answerFor([ev({ type: "turn.started", source: "person" })], answerCtx(pending));
    expect(structuredClone(next.answer)).toMatchObject({ kind: "context", text: expect.stringContaining("go left") });
    expect(next.delivers).toEqual(["answer-q1"]);
    expect(readPromptMark(next.answer?.kind === "context" ? next.answer.text : "")).toEqual({ source: "answer", id: "answer-q1" });
    await markDelivered(s.ctx, unit, runId, next.delivers);
    expect((await pendingInjections(s.ctx, unit, runId)).injections).toEqual([]);

    // a replay of the same answer queues nothing new
    await s.launcher.answer(started.value.handle, "q1", "go left");
    expect((await pendingInjections(s.ctx, unit, runId)).injections).toEqual([]);
  });

  test("without a pane, an answer to a session that ended resumes that session with the answer as its prompt", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    const h = started.value.handle;
    await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    await appendEvents(s.ctx, unit, runId, [{ type: "session.ended", run_id: runId, seq: 0, at: START, reason: "exit" }]);
    // a headless agent exits once its turn may end
    s.bg.live.clear();
    expect(await s.launcher.alive(h)).toBe(false);

    expect(await s.launcher.answer(h, "q1", "go left")).toEqual(ok(undefined));
    const resumed = s.bgHarness.launches[1] as LaunchRequest;
    expect([resumed.resume, resumed.headless, resumed.cwd]).toEqual(["sess-1", true, "/wt/gh-12-03"]);
    expect(readPromptMark(resumed.prompt)).toEqual({ source: "answer", id: "answer-q1" });
    expect(resumed.prompt).toContain("go left");
    expect(s.bg.starts[1]).toMatchObject({ key: `${runId}.answer-q1`, cwd: "/wt/gh-12-03", logPath: `/m/runtime/sessions/${runId}.log` });
    // nothing waits in the outbox for a hook that would never fire
    expect((await pendingInjections(s.ctx, unit, runId)).injections).toEqual([]);
    // the run's process is the resumed one, and its session reads as started again before its own hooks run
    expect(await s.launcher.alive(h)).toBe(true);
    expect(reduceSession((await readEvents(s.ctx, unit, runId)).events).ended).toBeUndefined();

    // a replayed delivery finds the resumed launch rather than starting a second agent
    expect(await s.launcher.answer(h, "q1", "go left")).toEqual(ok(undefined));
    expect(s.bg.starts).toHaveLength(2);
    expect(await s.launcher.stop(h)).toEqual(ok(undefined));
    expect(s.bg.stopped).toEqual(["proc|2", "proc|1"]);
    expect(await s.launcher.alive(h)).toBe(false);
  });

  test("a resumed launch installs the harness's hooks in the worktree again before it starts, as a cleaned worktree lost them", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    await appendEvents(s.ctx, unit, runId, [{ type: "session.ended", run_id: runId, seq: 0, at: START, reason: "exit" }]);
    s.bg.live.clear();
    expect(s.bgHarness.installs).toHaveLength(1);
    const launchesAtInstall: number[] = [];
    const install = s.bgHarness.install;
    s.bgHarness.install = async (target) => {
      launchesAtInstall.push(s.bgHarness.launches.length);
      return install(target);
    };
    expect(await s.launcher.answer(started.value.handle, "q1", "go left")).toEqual(ok(undefined));
    const first = s.bgHarness.installs[0];
    expect(s.bgHarness.installs).toEqual([first, first].filter((i) => i !== undefined));
    expect(s.bgHarness.installs[1]?.worktree).toBe("/wt/gh-12-03");
    // installed while only the first launch existed: the resume came after
    expect(launchesAtInstall).toEqual([1]);
    expect(s.bgHarness.launches).toHaveLength(2);
  });

  test("an answer to an ended session that cannot be resumed is refused, so it is never applied undelivered", async () => {
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    for (const [caps, session] of [
      [{ resume: false }, true],
      [{ resume: true }, false],
    ] as const) {
      const s = setup({ bgHarness: caps });
      const started = await s.launcher.start(run({ executor: "bg", attended: false }));
      if (!started.ok) throw new Error("start failed");
      if (session) await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
      s.bg.live.clear();
      expect(await s.launcher.answer(started.value.handle, "q1", "go left")).toMatchObject({ ok: false, failure: { code: "unavailable" } });
      expect(s.bg.starts).toHaveLength(1);
    }
  });

  test("without a pane, a nudge to a live session silent past the window stops it and resumes it with the nudge, as no hook would carry it", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    const h = started.value.handle;
    await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    s.clock.advance(SILENT_MS + 1000);
    expect(await s.launcher.alive(h)).toBe(true);

    const id = nudgePromptId("01JINTENT7");
    expect(await s.launcher.nudge(h, "carry on", id)).toEqual(ok(undefined));
    expect(s.bg.stopped).toEqual(["proc|1"]);
    const resumed = s.bgHarness.launches[1] as LaunchRequest;
    expect([resumed.resume, resumed.headless]).toEqual(["sess-1", true]);
    expect(readPromptMark(resumed.prompt)).toEqual({ source: "nudge", id });
    expect(resumed.prompt).toContain("carry on");
    expect((await pendingInjections(s.ctx, unit, runId)).injections).toEqual([]);
    expect(await s.launcher.alive(h)).toBe(true);

    // a replay finds the resumed launch: it neither stops it nor starts a second agent
    expect(await s.launcher.nudge(h, "carry on", id)).toEqual(ok(undefined));
    expect(s.bg.stopped).toEqual(["proc|1"]);
    expect(s.bg.starts).toHaveLength(2);
  });

  test("without a pane, a nudge to a live session with recent hook activity is queued for its next hook, the process left running", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    s.clock.advance(SILENT_MS + 1000);
    await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: s.clock.now(), harness_session: "sess-1" }]);
    const id = nudgePromptId("01JINTENT7");
    expect(await s.launcher.nudge(started.value.handle, "carry on", id)).toEqual(ok(undefined));
    expect(s.bg.stopped).toEqual([]);
    expect(s.bg.starts).toHaveLength(1);
    expect((await pendingInjections(s.ctx, unit, runId)).injections.map((p) => p.id)).toEqual([id]);
  });

  test("a nudge to a live silent session that cannot be resumed is refused and the process left running, so the nudge is not counted", async () => {
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    for (const [caps, session] of [
      [{ resume: false }, true],
      [{ resume: true }, false],
    ] as const) {
      const s = setup({ bgHarness: caps });
      const started = await s.launcher.start(run({ executor: "bg", attended: false }));
      if (!started.ok) throw new Error("start failed");
      if (session) await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
      s.clock.advance(SILENT_MS + 1000);
      expect(await s.launcher.nudge(started.value.handle, "carry on", nudgePromptId("01JINTENT7"))).toMatchObject({ ok: false, failure: { code: "unavailable" } });
      expect(s.bg.stopped).toEqual([]);
      expect(s.bg.starts).toHaveLength(1);
      expect((await pendingInjections(s.ctx, unit, runId)).injections).toEqual([]);
    }
  });

  test("a nudge with neither a pane nor context injection is refused, never dropped", async () => {
    const s = setup({ bgHarness: { injectContext: false } });
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.nudge(started.value.handle, "carry on", "nudge-1")).toMatchObject({ ok: false, failure: { code: "invalid" } });
  });

  test("a handle this launcher did not make is refused", async () => {
    const s = setup();
    expect(await s.launcher.nudge("h-01JRUN", "x", "nudge-1")).toMatchObject({ ok: false, failure: { code: "invalid" } });
    expect(await s.launcher.stop("h-01JRUN")).toMatchObject({ ok: false, failure: { code: "invalid" } });
  });
});

describe("harness launcher answering a dialog in the agent's pane", () => {
  const UNIT = "gh-12/03";
  const RUN_ID = "01JRUN0000000000000000000A";
  const ev = (seq: number, body: Record<string, unknown>) => ({ run_id: RUN_ID, seq, at: START, ...body }) as HarnessEvent;
  const permissionOpen = [
    ev(0, { type: "session.started", harness_session: "s-1" }),
    ev(1, { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash", detail: "rm -rf build" }),
    ev(2, { type: "tool.permission", id: "perm-1", prompt: "Claude needs your permission to use Bash" }),
  ];
  const openPermission = () => reduceSession(permissionOpen).permission as NonNullable<ReturnType<typeof reduceSession>["permission"]>;

  test("an open permission gets the harness's keys for the answer pressed in its pane, once however often the answer is replayed", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    await appendEvents(s.ctx, UNIT, RUN_ID, permissionOpen);
    const id = dialogInputId(openPermission(), RUN_ID);
    expect(await s.launcher.answer(started.value.handle, id, "1", { dialog: true })).toEqual(ok(undefined));
    expect(await s.launcher.answer(started.value.handle, id, "1", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toEqual([{ handle: "proc|1", keys: [{ text: "1" }, { key: "enter" }] }]);
    // keys, never a prompt typed to the agent
    expect(s.pane.sent).toEqual([]);
  });

  test("a permission the pane no longer shows gets no keys: they would land in the agent's prompt", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    await appendEvents(s.ctx, UNIT, RUN_ID, [...permissionOpen, ev(3, { type: "tool.finished", id: "t1", ok: true })]);
    expect(await s.launcher.answer(started.value.handle, dialogInputId(openPermission(), RUN_ID), "1", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toEqual([]);
  });

  test("a refused permission is followed by a prompt telling the agent so, as a refusal ends its turn with no hook that closes the permission", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    await appendEvents(s.ctx, UNIT, RUN_ID, permissionOpen);
    const id = dialogInputId(openPermission(), RUN_ID);
    expect(await s.launcher.answer(started.value.handle, id, "no", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toEqual([{ handle: "proc|1", keys: [{ key: "esc" }] }]);
    expect(s.pane.sent).toHaveLength(1);
    const told = s.pane.sent[0] as { handle: string; text: string };
    expect(told.handle).toBe("proc|1");
    expect(readPromptMark(told.text)).toEqual({ source: "answer", id: answerPromptId(id) });
    expect(told.text).toContain("Bash(rm -rf build)");
    // the prompt starts a turn, and a new turn closes the permission, so the unit is not parked on it again
    const prompted = [...permissionOpen, ev(3, { type: "turn.started" })];
    expect(reduceSession(prompted).permission).toBeUndefined();
    // a replay neither presses nor types again
    expect(await s.launcher.answer(started.value.handle, id, "no", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toHaveLength(1);
    expect(s.pane.sent).toHaveLength(1);
  });

  test("a run this machine never launched is not probed and gets no keys: its pane id may name another agent's pane here", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    // the same run as another machine launched it: its record and its events stayed there
    const foreign = started.value.handle.replace(RUN_ID, "01JRUN0000000000000000000F");
    expect(await s.launcher.alive(foreign)).toBeNull();
    const pressed = await s.launcher.answer(foreign, dialogInputId(null, "01JRUN0000000000000000000F"), "1", { dialog: true });
    expect(pressed.ok ? null : pressed.failure.code).toBe("not_found");
    expect(s.pane.pressed).toEqual([]);
    expect(s.pane.sent).toEqual([]);
  });

  test("a run that has sent no event yet gets the keys for the dialog that holds it, until its first event", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    const trust = dialogInputId(null, RUN_ID);
    expect(await s.launcher.answer(started.value.handle, trust, "1", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toEqual([{ handle: "proc|1", keys: [{ text: "1" }, { key: "enter" }] }]);
  });

  // Claude Code 2.1's trust prompt: unnumbered, its cursor on the refusal, so a typed 1 is ignored and Enter exits
  const TRUST = ["❯ No, exit", "  Yes, I trust this folder"].join("\n");
  /** yes is placed only on a menu read off the pane, the way claude's harness places it */
  const placesYes = (answer: string, dialog?: string): readonly RunnerKey[] | null =>
    answer === "yes" ? (dialog === undefined ? [{ text: "1" }, { key: "enter" }] : dialog.includes("Yes, I trust") ? [{ key: "down" }, { key: "enter" }] : null) : null;

  test("yes on a pane herdr does not see blocked is placed on the menu the pane shows: it never presses Enter on the refusal the cursor starts on", async () => {
    const s = setup();
    s.paneHarness.dialogKeys = placesYes;
    // the runner sees no blocked agent, so it reads the pane only when asked to whatever it sees
    s.pane.dialog = async (_h, opts) => ok(opts?.anyStatus === true ? TRUST : null);
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.answer(started.value.handle, dialogInputId(null, RUN_ID), "yes", { dialog: true })).toEqual(ok(undefined));
    expect(s.pane.pressed).toEqual([{ handle: "proc|1", keys: [{ key: "down" }, { key: "enter" }] }]);
  });

  test("the dialog probe reads the pane of a run launched here, never one another machine launched: its pane id may name another agent's pane here", async () => {
    const s = setup();
    const asked: string[] = [];
    s.pane.dialog = async (h) => {
      asked.push(h);
      return ok(TRUST);
    };
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.dialog(started.value.handle)).toBe(TRUST);
    expect(await s.launcher.dialog(started.value.handle.replace(RUN_ID, "01JRUN0000000000000000000F"))).toBeNull();
    expect(asked).toEqual(["proc|1"]);
  });

  test("yes is refused, with nothing pressed, when the pane shows no option that says yes or cannot be read at all", async () => {
    for (const read of [async () => ok("❯ No, exit\n  Trust this folder"), async () => ok(null), async () => fail("unavailable", "herdr is down"), undefined]) {
      const s = setup();
      s.paneHarness.dialogKeys = placesYes;
      if (read) s.pane.dialog = read;
      const started = await s.launcher.start(run());
      if (!started.ok) throw new Error("start failed");
      const answered = await s.launcher.answer(started.value.handle, dialogInputId(null, RUN_ID), "yes", { dialog: true });
      expect(answered.ok ? null : answered.failure.code).toBe("invalid");
      expect(s.pane.pressed).toEqual([]);
    }
  });

  test("a runner that cannot press keys, a harness that names none, and an answer no option takes are refused", async () => {
    const s = setup({ bgHarness: {} });
    const bg = await s.launcher.start(run({ executor: "bg", attended: false }));
    const pane = await s.launcher.start(run({ run_id: "01JRUN0000000000000000000B" }));
    if (!bg.ok || !pane.ok) throw new Error("start failed");
    const noKeys = await s.launcher.answer(bg.value.handle, dialogInputId(null, RUN_ID), "1", { dialog: true });
    expect(noKeys.ok ? null : noKeys.failure.code).toBe("invalid");
    const notAnOption = await s.launcher.answer(pane.value.handle, dialogInputId(null, "01JRUN0000000000000000000B"), "maybe", { dialog: true });
    expect(notAnOption.ok ? null : notAnOption.failure.message).toContain("maybe");
    expect(s.launcher.modesOf("pane")?.dialogKeys).toBe(true);
    delete (s.paneHarness as Partial<Harness>).dialogKeys;
    const unnamed = await s.launcher.answer(pane.value.handle, dialogInputId(null, "01JRUN0000000000000000000B"), "1", { dialog: true });
    expect(unnamed.ok ? null : unnamed.failure.code).toBe("invalid");
    expect(s.launcher.modesOf("pane")?.dialogKeys).toBe(false);
    expect(s.launcher.modesOf("bg")?.dialogKeys).toBe(false);
    expect(s.pane.pressed).toEqual([]);
  });
});

describe("harness launcher stop and liveness", () => {
  test("stop reaches the runner with its own handle; alive asks the runner", async () => {
    const s = setup();
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.alive(started.value.handle)).toBe(true);
    expect(await s.launcher.stop(started.value.handle)).toEqual(ok(undefined));
    expect(s.pane.stopped).toEqual(["proc|1"]);
    expect(await s.launcher.alive(started.value.handle)).toBe(false);
    expect(await s.launcher.alive("not-ours")).toBeNull();
  });
});

describe("harness launcher close", () => {
  test("closes the first launch under the run id and every resume under its own key, and nothing of a run launched elsewhere", async () => {
    const s = setup({ bgHarness: { resume: true } });
    const unit = "gh-12/03";
    const runId = "01JRUN0000000000000000000A";
    const started = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!started.ok) throw new Error("start failed");
    const h = started.value.handle;
    await appendEvents(s.ctx, unit, runId, [{ type: "session.started", run_id: runId, seq: 0, at: START, harness_session: "sess-1" }]);
    s.clock.advance(SILENT_MS + 1000);
    const id = nudgePromptId("01JINTENT7");
    expect(await s.launcher.nudge(h, "carry on", id)).toEqual(ok(undefined));
    const resumeKey = s.bg.starts[1]?.key;
    expect(resumeKey).toStartWith(`${runId}.`);

    const elsewhere = setup({ bgHarness: { resume: true } });
    expect(await elsewhere.launcher.close(h)).toEqual(ok(false));
    expect(elsewhere.bg.closed).toEqual([]);

    expect(await s.launcher.close(h)).toEqual(ok(true));
    expect(s.bg.closed).toEqual([
      { handle: "proc|2", key: resumeKey as string },
      { handle: "proc|1", key: runId },
    ]);
  });
});

describe("harness launcher in front of a person", () => {
  test("focus brings a run's pane in front through its runner's own handle; a pane gone is false", async () => {
    const s = setup();
    expect([s.launcher.modesOf("pane")?.focus, s.launcher.modesOf("bg")?.focus]).toEqual([true, false]);
    const started = await s.launcher.start(run());
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.focus(started.value.handle)).toEqual(ok(true));
    expect(s.pane.focused).toEqual(["proc|1"]);
    await s.pane.stop("proc|1");
    expect(await s.launcher.focus(started.value.handle)).toEqual(ok(false));
  });

  test("focus is refused for a run whose runner has no pane, and for one launched on another machine", async () => {
    const s = setup();
    const bg = await s.launcher.start(run({ executor: "bg", attended: false }));
    if (!bg.ok) throw new Error("start failed");
    const r = await s.launcher.focus(bg.value.handle);
    expect(!r.ok && r.failure.message).toBe("gh-12/03 run 01JRUN0000000000000000000A runs in bg, which has no pane to bring in front");
    const started = await s.launcher.start(run({ run_id: "01JRUN0000000000000000000B" }));
    if (!started.ok) throw new Error("start failed");
    const other = await setup().launcher.focus(started.value.handle);
    expect(!other.ok && other.failure.message).toBe("gh-12/03 run 01JRUN0000000000000000000B was launched on another machine: its pane is there");
  });

  test("split and label go to the runners that have them; with none configured split is refused", async () => {
    const s = setup();
    expect(await s.launcher.split({ argv: ["norn", "status", "--watch"], cwd: "/repo", title: "norn" })).toEqual(ok({ handle: "split|1" }));
    expect(s.pane.splits).toEqual([{ argv: ["norn", "status", "--watch"], cwd: "/repo", title: "norn" }]);
    expect(await s.launcher.label("gh-12", "● approve", 30_000)).toEqual(ok(true));
    expect(await s.launcher.label("gh-9", "◐ running", 30_000)).toEqual(ok(false));
    expect(s.pane.labels).toEqual([
      ["gh-12", "● approve", 30_000],
      ["gh-9", "◐ running", 30_000],
    ]);
    const headless = new HarnessLauncher({ ...s.launcher.opts, executors: { bg: { harness: s.bgHarness, runner: s.bg } } });
    const r = await headless.split({ argv: ["norn"], cwd: "/repo", title: "norn" });
    expect(!r.ok && r.failure.message).toBe("no configured runner opens a pane a person sees (bg)");
    expect(await headless.label("gh-12", "x", 1)).toEqual(ok(false));
  });
});

describe("harness launcher output", () => {
  test("is the head of the log the run's process wrote: its first non-empty lines, joined", async () => {
    const s = setup();
    const started = await s.launcher.start(run({ executor: "bg" }));
    if (!started.ok) throw new Error("start failed");
    await s.files.write("/m/runtime/sessions/01JRUN0000000000000000000A.log", "\n  Error: invalid API key  \n\nrun claude login\n3\n4\n5\n6\n");
    expect(await s.launcher.output(started.value.handle)).toBe("Error: invalid API key | run claude login | 3 | 4 | 5");
  });

  test("a long head is cut, so a reason stays readable", async () => {
    const s = setup();
    const started = await s.launcher.start(run({ executor: "bg" }));
    if (!started.ok) throw new Error("start failed");
    await s.files.write("/m/runtime/sessions/01JRUN0000000000000000000A.log", `${"x".repeat(2000)}\n`);
    const head = await s.launcher.output(started.value.handle);
    expect(head?.length).toBe(600);
    expect(head?.endsWith("…")).toBe(true);
  });

  test("is null with no log, an empty one, a run launched elsewhere, or a handle not this launcher's", async () => {
    const s = setup();
    const started = await s.launcher.start(run({ executor: "bg" }));
    if (!started.ok) throw new Error("start failed");
    expect(await s.launcher.output(started.value.handle)).toBeNull();
    await s.files.write("/m/runtime/sessions/01JRUN0000000000000000000A.log", "\n \n");
    expect(await s.launcher.output(started.value.handle)).toBeNull();
    expect(await s.launcher.output("not-ours")).toBeNull();
    const elsewhere = await setup().launcher.output(started.value.handle);
    expect(elsewhere).toBeNull();
  });
});

describe("shellQuote", () => {
  test("keeps plain words and quotes the rest as one word each", () => {
    expect(shellQuote(["norn", "hook", "claude"])).toBe("norn hook claude");
    expect(shellQuote(["/a b/norn", "it's"])).toBe(`'/a b/norn' 'it'\\''s'`);
  });
});

describe("the pack's skills", () => {
  const SKILLS = { "norn-implement": { "SKILL.md": "# implement\n", "refs/tdd.md": "red, green\n" }, norn: { "SKILL.md": "# norn\n" } };
  const WT = "/wt/gh-12-03";

  function withSkills(skillsDir: string | undefined, files?: ReturnType<typeof memoryFiles>) {
    const s = setup();
    const ctx = files ? { ...s.ctx, files } : s.ctx;
    const harness = { ...fakeHarness(), ...(skillsDir !== undefined && { skillsDir }) };
    const launcher = new HarnessLauncher({ ...s.launcher.opts, ctx, executors: { pane: { harness, runner: s.pane } }, skills: SKILLS });
    return { ...s, files: files ?? s.files, launcher };
  }

  test("land in .agents/skills, each folder ignored by git, and the harness's folder links to each", async () => {
    const s = withSkills(".claude/skills");
    expect((await s.launcher.start(run())).ok).toBe(true);
    expect(await s.files.read(`${WT}/.agents/skills/norn-implement/SKILL.md`)).toBe("# implement\n");
    expect(await s.files.read(`${WT}/.agents/skills/norn-implement/refs/tdd.md`)).toBe("red, green\n");
    expect(await s.files.read(`${WT}/.agents/skills/norn/.gitignore`)).toEndWith("\n*\n");
    expect(s.files.links()).toEqual({
      [`${WT}/.claude/skills/norn`]: "../../.agents/skills/norn",
      [`${WT}/.claude/skills/norn-implement`]: "../../.agents/skills/norn-implement",
    });
    // the links are files to git, so the harness's folder ignores them by name
    expect(await s.files.read(`${WT}/.claude/skills/.gitignore`)).toEndWith("\n/.gitignore\n/norn-implement\n/norn\n");
  });

  test("a skill the repo keeps in .agents, or anything at a link's name, is left as it is", async () => {
    const s = withSkills(".claude/skills");
    await s.files.write(`${WT}/.agents/skills/norn/SKILL.md`, "# the repo's own norn skill\n");
    await s.files.write(`${WT}/.claude/skills/norn-implement/SKILL.md`, "# the repo's own, for claude only\n");
    expect((await s.launcher.start(run())).ok).toBe(true);
    expect(await s.files.read(`${WT}/.agents/skills/norn/SKILL.md`)).toBe("# the repo's own norn skill\n");
    expect(await s.files.read(`${WT}/.agents/skills/norn/.gitignore`)).toBeNull();
    expect(await s.files.read(`${WT}/.claude/skills/norn-implement/SKILL.md`)).toBe("# the repo's own, for claude only\n");
    // the repo's own skill in .agents is still linked for the agent; the name the repo filled is not
    expect(s.files.links()).toEqual({ [`${WT}/.claude/skills/norn`]: "../../.agents/skills/norn" });
  });

  test("norn's own copy is brought up to date on the next launch", async () => {
    const s = withSkills(".pi/skills");
    expect((await s.launcher.start(run())).ok).toBe(true);
    await s.files.write(`${WT}/.agents/skills/norn-implement/SKILL.md`, "# stale\n");
    expect((await s.launcher.start(run({ run_id: "01JRUN0000000000000000000B" }))).ok).toBe(true);
    expect(await s.files.read(`${WT}/.agents/skills/norn-implement/SKILL.md`)).toBe("# implement\n");
  });

  test("a harness reading .agents/skills itself needs no links, and a host without links gets copies", async () => {
    const direct = withSkills(".agents/skills");
    expect((await direct.launcher.start(run())).ok).toBe(true);
    expect(direct.files.links()).toEqual({});
    const plain = memoryFiles();
    const noLinks = { ...plain, symlink: undefined, readLink: undefined } as unknown as ReturnType<typeof memoryFiles>;
    const copied = withSkills(".claude/skills", noLinks);
    expect((await copied.launcher.start(run())).ok).toBe(true);
    expect(await plain.read(`${WT}/.claude/skills/norn/SKILL.md`)).toBe("# norn\n");
  });

  test("a harness with no skills folder gets none", async () => {
    const s = withSkills(undefined);
    expect((await s.launcher.start(run())).ok).toBe(true);
    expect((await s.files.list(WT)).length).toBe(0);
  });
});
