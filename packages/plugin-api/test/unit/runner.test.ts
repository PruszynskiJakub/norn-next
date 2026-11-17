import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  createRunner,
  defineNornPlugin,
  type HostContext,
  hostProcesses,
  isHarnessEvent,
  ok,
  type Runner,
  type RunnerFactory,
  runnerProblems,
} from "../../src/index.ts";

const base: HostContext = {
  exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  files: { read: async () => null, write: async () => {}, create: async () => true, list: async () => [], remove: async () => {} },
  now: () => "2026-11-17T10:00:00.000Z",
  repo: { root: "/repo", dataDir: "/data" },
};

const withProcesses: HostContext = {
  ...base,
  spawn: async () => ({ pid: 42, started: "Tue Nov 17 10:00:00 2026" }),
  alive: async () => true,
  kill: async () => {},
};

function inertRunner(name = "inert"): Runner {
  return {
    name,
    capabilities: { attended: false, headless: true, paneInput: false },
    start: async (req) => ok({ handle: `${name}:${req.key}` }),
    alive: async () => ok(true),
    send: async () => ok(undefined),
    stop: async () => ok(undefined),
  };
}

describe("runner contract", () => {
  test("a runner fitting the contract has no problems", () => {
    expect(runnerProblems(inertRunner())).toEqual([]);
  });

  test("names a missing method and a non-boolean capability", () => {
    const { send: _s, stop: _t, ...half } = inertRunner();
    expect(runnerProblems(half)).toEqual(["lacks send, stop"]);
    expect(runnerProblems({ ...inertRunner(), capabilities: { attended: true, headless: "no" } })).toEqual(["capabilities headless, paneInput must be booleans"]);
    expect(runnerProblems(null)).toEqual(["is not an object"]);
  });

  test("createRunner validates the config and hands the host context to create", () => {
    const Config = Type.Object({ session: Type.String() }, { additionalProperties: false });
    let seen: HostContext | null = null;
    const factory: RunnerFactory<typeof Config> = { configSchema: Config, create: (c) => ((seen = c), inertRunner()) };
    expect(createRunner(factory, base, { session: "s" }).ok).toBe(true);
    expect(seen === base).toBe(true);
    expect(createRunner(factory, base, {})).toEqual({ ok: false, failure: { code: "invalid", message: "runner config: / must have required property 'session'", retryable: false } });
  });

  test("a runner that needs processes is refused on a host without them, before create runs", () => {
    let created = 0;
    const factory: RunnerFactory = { configSchema: Type.Object({}), needsProcesses: true, create: () => (created++, inertRunner()) };
    expect(createRunner(factory, base, {})).toEqual({
      ok: false,
      failure: { code: "invalid", message: "runner needs a host that starts processes; this host lacks spawn, alive, kill", retryable: false },
    });
    expect(created).toBe(0);
    const half = createRunner(factory, { ...base, spawn: withProcesses.spawn }, {});
    expect(!half.ok && half.failure.message).toBe("runner needs a host that starts processes; this host lacks alive, kill");
    expect(createRunner(factory, withProcesses, {}).ok).toBe(true);
    expect(created).toBe(1);
  });
});

describe("hostProcesses", () => {
  test("hands back the host's spawn, alive and kill bound to it, or names what is missing", async () => {
    const got = hostProcesses(withProcesses);
    expect(got.ok).toBe(true);
    if (got.ok) expect(await got.value.spawn(["x"], { cwd: "/", logPath: "/l" })).toEqual({ pid: 42, started: "Tue Nov 17 10:00:00 2026" });
    expect(hostProcesses(base)).toEqual({ ok: false, missing: ["spawn", "alive", "kill"] });
  });
});

describe("defineNornPlugin: runner slot", () => {
  const factory: RunnerFactory = { configSchema: Type.Object({}), create: () => inertRunner() };

  test("keeps a runner factory, frozen, beside the older slots", () => {
    const plugin = defineNornPlugin({ name: "norn-runner-inert", api: "^1.5", provides: { runners: { inert: factory } } });
    expect(plugin.provides.runners?.inert).toBe(factory);
    expect(Object.isFrozen(plugin.provides.runners)).toBe(true);
  });

  test("refuses a runner factory without a configSchema or create", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { runners: { x: { create: factory.create } as unknown as RunnerFactory } } })).toThrow(
      "norn plugin p: runner x needs a configSchema",
    );
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { runners: { x: { configSchema: factory.configSchema } as unknown as RunnerFactory } } })).toThrow(
      "norn plugin p: runner x lacks create",
    );
  });
});

describe("turn.started prompt_id (1.5)", () => {
  const env = { run_id: "r1", seq: 0, at: "2026-11-17T10:00:00.000Z" };
  test("is optional, and must be non-empty when given", () => {
    expect(isHarnessEvent({ ...env, type: "turn.started", source: "nudge", prompt_id: "n-1" })).toBe(true);
    expect(isHarnessEvent({ ...env, type: "turn.started", source: "person" })).toBe(true);
    expect(isHarnessEvent({ ...env, type: "turn.started", source: "nudge", prompt_id: "" })).toBe(false);
  });
});
