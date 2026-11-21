import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineNornPlugin, type Forge, type ForgeFactory, type Harness, type HarnessEvent, type Store, type StoreFactory, type Tracker, type TrackerFactory } from "../../src/index.ts";

/** A harness that satisfies the contract and does nothing; enough to exercise the plugin checks. */
function inertHarness(name = "inert"): Harness {
  return {
    name,
    capabilities: { blockStop: false, denyTool: false, injectContext: false, subagents: false, limits: false, paneInput: false },
    install: async () => ({ changed: [] }),
    uninstall: async () => ({ changed: [] }),
    launch: (req) => ({ argv: [name, req.prompt], env: { ...req.env } }),
    normalize: (input): HarnessEvent[] => [
      { type: "hook.error", run_id: input.run_id, seq: input.seq, at: input.at, hook: input.hook, message: "inert" },
    ],
    respond: () => ({ stdout: "", exit_code: 0 }),
  };
}

describe("defineNornPlugin", () => {
  test("returns a frozen plugin whose harness map is frozen too", () => {
    const h = inertHarness();
    const plugin = defineNornPlugin({ name: "norn-harness-inert", api: "^1", provides: { harness: { inert: h } } });
    expect(plugin.name).toBe("norn-harness-inert");
    expect(plugin.api).toBe("^1");
    expect(plugin.provides.harness?.inert).toBe(h);
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(Object.isFrozen(plugin.provides)).toBe(true);
    expect(Object.isFrozen(plugin.provides.harness)).toBe(true);
  });

  test("a later change to the spec does not reach the plugin", () => {
    const harness: Record<string, Harness> = { inert: inertHarness() };
    const plugin = defineNornPlugin({ name: "p", api: "^1.0", provides: { harness } });
    harness.other = inertHarness("other");
    expect(Object.keys(plugin.provides.harness ?? {})).toEqual(["inert"]);
  });

  test("a plugin may provide nothing yet", () => {
    const plugin = defineNornPlugin({ name: "empty", api: "^1", provides: {} });
    expect(plugin.provides).toEqual({});
  });

  test("refuses an API range the running API does not satisfy, naming both", () => {
    expect(() => defineNornPlugin({ name: "future", api: "^2", provides: {} })).toThrow(
      'norn plugin future: wants plugin API "^2", but this norn implements 1.24.0',
    );
    expect(() => defineNornPlugin({ name: "newer-minor", api: "^1.25", provides: {} })).toThrow(/implements 1\.24\.0/);
    expect(() => defineNornPlugin({ name: "loose", api: ">=1", provides: {} })).toThrow(/wants plugin API ">=1"/);
  });

  test("refuses a plugin without a name", () => {
    expect(() => defineNornPlugin({ name: "  ", api: "^1", provides: {} })).toThrow("norn plugin (unnamed): needs a non-empty name");
  });

  test("refuses a harness missing part of the contract", () => {
    const { respond: _r, normalize: _n, ...partial } = inertHarness();
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { harness: { half: partial as unknown as Harness } } })).toThrow(
      "norn plugin p: harness half lacks normalize, respond",
    );
    const nameless = { ...inertHarness(), capabilities: null } as unknown as Harness;
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { harness: { x: nameless } } })).toThrow(
      "norn plugin p: harness x needs a name and capabilities",
    );
  });
});

describe("defineNornPlugin: tracker and forge slots", () => {
  const configSchema = Type.Object({});
  const tracker: TrackerFactory = { configSchema, create: () => ({}) as Tracker };
  const forge: ForgeFactory = { configSchema, create: () => ({}) as Forge };

  test("keeps the factories, frozen, beside a harness", () => {
    const plugin = defineNornPlugin({ name: "p", api: "^1.1", provides: { tracker: { local: tracker }, forge: { none: forge } } });
    expect(plugin.provides.tracker?.local).toBe(tracker);
    expect(plugin.provides.forge?.none).toBe(forge);
    expect(Object.isFrozen(plugin.provides.tracker)).toBe(true);
    expect(Object.isFrozen(plugin.provides.forge)).toBe(true);
    expect(Object.keys(plugin.provides).sort()).toEqual(["forge", "tracker"]);
  });

  test("refuses a factory without a configSchema or create", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { tracker: { local: { create: tracker.create } as unknown as TrackerFactory } } })).toThrow(
      "norn plugin p: tracker local needs a configSchema",
    );
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { forge: { none: { configSchema } as unknown as ForgeFactory } } })).toThrow("norn plugin p: forge none lacks create");
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { forge: { "": forge } } })).toThrow("norn plugin p: provides a forge with an empty key");
  });
});

describe("defineNornPlugin: store slot", () => {
  const store: StoreFactory = { configSchema: Type.Object({}), create: () => ({}) as Store };

  test("keeps a store factory, frozen, and a plugin written against ^1.1 still loads", () => {
    const plugin = defineNornPlugin({ name: "p", api: "^1.2", provides: { store: { local: store } } });
    expect(plugin.provides.store?.local).toBe(store);
    expect(Object.isFrozen(plugin.provides.store)).toBe(true);
    expect(defineNornPlugin({ name: "old", api: "^1.1", provides: {} }).api).toBe("^1.1");
  });

  test("refuses a store factory without a configSchema or create", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { store: { local: { create: store.create } as unknown as StoreFactory } } })).toThrow(
      "norn plugin p: store local needs a configSchema",
    );
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { store: { refs: { configSchema: store.configSchema } as unknown as StoreFactory } } })).toThrow(
      "norn plugin p: store refs lacks create",
    );
  });
});
