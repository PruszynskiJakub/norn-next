import { describe, expect, test } from "bun:test";
import { defineNornPlugin, type Harness, type NornPlugin, ok, type Runner, type RunnerFactory } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { type AgentLauncher, createRuntimeEnv, gatherFacts, HarnessLauncher, type RuntimeConfig } from "../../src/index.ts";
import { harness } from "./support.ts";

const runnerFactory = (name: string, caps: Runner["capabilities"], needsProcesses = false): RunnerFactory => ({
  configSchema: Type.Object({ size: Type.Optional(Type.Number()) }, { additionalProperties: false }),
  ...(needsProcesses ? { needsProcesses } : {}),
  create: () => ({ name, capabilities: caps, start: async () => ok({ handle: "x" }), alive: async () => ok(true), send: async () => ok(undefined), stop: async () => ok(undefined) }),
});

const runners: NornPlugin = defineNornPlugin({
  name: "fake-runners",
  api: "^1.5",
  provides: {
    runners: {
      pane: runnerFactory("pane", { attended: true, headless: false, paneInput: true }),
      bg: runnerFactory("bg", { attended: false, headless: true, paneInput: false }),
      spawning: runnerFactory("spawning", { attended: false, headless: true, paneInput: false }, true),
    },
  },
});

function build(config: (c: RuntimeConfig) => RuntimeConfig) {
  const h = harness();
  let handed: AgentLauncher | null = null;
  const env = createRuntimeEnv({
    ctx: h.ctx,
    plugins: [...h.plugins, runners],
    config: config(h.config),
    sessions: (l) => {
      handed = l;
      return h.sessions;
    },
  });
  return { h, env, handed: () => handed };
}

describe("executors as a harness in a runner", () => {
  test("with no launcher given, the runtime builds one from each executor's harness and runner", async () => {
    const { env, handed } = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "pane" } }, bot: { name: "fake" } }, runner: { name: "bg" } }));
    if (!env.ok) throw new Error(env.failure.message);
    expect(env.value.launcher).toBeInstanceOf(HarnessLauncher);
    expect(handed()).toBe(env.value.launcher);
    expect(env.value.launcher.modesOf?.("claude")).toEqual({ headless: false, attended: true, paneInput: false, dialogKeys: false, focus: false });
    expect(env.value.launcher.modesOf?.("bot")).toEqual({ headless: true, attended: false, paneInput: false, dialogKeys: false, focus: false });
    const gathered = await gatherFacts(env.value, "01JD5G00000000000000000000");
    if (!gathered.ok) throw new Error(gathered.failure.message);
    expect(gathered.value.facts.capabilities.executors.claude).toMatchObject({ headless: false, attended: true, paneInput: false });
    expect(gathered.value.facts.capabilities.executors.bot).toMatchObject({ headless: true, attended: false });
  });

  test("an executor's model is handed to the launcher with its harness and runner", () => {
    const { env } = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "pane" }, model: "opus" }, bot: { name: "fake", runner: { name: "bg" } } } }));
    if (!env.ok) throw new Error(env.failure.message);
    const executors = (env.value.launcher as HarnessLauncher).opts.executors;
    expect([executors.claude?.model, executors.bot?.model]).toEqual(["opus", undefined]);
  });

  test("an executor's args are handed to the launcher with its harness and runner", () => {
    const { env } = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "pane" }, args: ["--permission-mode", "plan"] }, bot: { name: "fake", runner: { name: "bg" } } } }));
    if (!env.ok) throw new Error(env.failure.message);
    const executors = (env.value.launcher as HarnessLauncher).opts.executors;
    expect([executors.claude?.args, executors.bot?.args]).toEqual([["--permission-mode", "plan"], undefined]);
  });

  test("an executor's facts carry whether its harness resumes a session, which decide reads before delivering an answer", async () => {
    const h = harness();
    const fake = h.plugins[0]?.provides.harness?.fake as Harness;
    const resumer: Harness = { ...fake, name: "resumer", capabilities: { ...fake.capabilities, resume: true } };
    const plugin = defineNornPlugin({ name: "resumer", api: "^1.5", provides: { harness: { resumer } } });
    const env = createRuntimeEnv({
      ctx: h.ctx,
      plugins: [...h.plugins, runners, plugin],
      config: { ...h.config, executors: { claude: { name: "fake" }, bot: { name: "resumer" } }, runner: { name: "bg" } },
      sessions: h.sessions,
    });
    if (!env.ok) throw new Error(env.failure.message);
    const gathered = await gatherFacts(env.value, "01JD5G00000000000000000000");
    if (!gathered.ok) throw new Error(gathered.failure.message);
    expect(gathered.value.facts.capabilities.executors.bot?.resume).toBe(true);
    expect(gathered.value.facts.capabilities.executors.claude?.resume).toBeUndefined();
  });

  test("an executor with no runner and no default runner is a refusal naming it", () => {
    const { env } = build((c) => ({ ...c, executors: { claude: { name: "fake" } } }));
    expect(env.ok ? null : env.failure.message).toBe('executor "claude" names no runner and the config has no default runner');
  });

  test("a runner no plugin provides, a config it refuses, or a host it cannot run on is a refusal", () => {
    const missing = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "tmux" } } } }));
    expect(missing.env.ok ? null : missing.env.failure.message).toBe('no configured plugin provides runner "tmux"');
    const bad = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "pane", config: { size: "big" } } } } }));
    expect(bad.env.ok ? null : bad.env.failure.code).toBe("invalid");
    const noProcs = build((c) => ({ ...c, executors: { claude: { name: "fake", runner: { name: "spawning" } } } }));
    expect(noProcs.env.ok ? null : noProcs.env.failure.message).toContain("lacks spawn, alive, kill");
  });

  test("a launcher given is used as it is", () => {
    const h = harness();
    const env = createRuntimeEnv({ ctx: h.ctx, plugins: h.plugins, config: h.config, launcher: h.launcher, sessions: h.sessions });
    expect(env.ok && env.value.launcher).toBe(h.launcher);
  });
});
