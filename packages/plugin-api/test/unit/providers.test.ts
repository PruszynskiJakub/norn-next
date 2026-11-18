import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  createForge,
  createTracker,
  FORGE_EFFECT_KINDS,
  type Forge,
  type ForgeFactory,
  forgeProblems,
  type HostContext,
  ok,
  TRACKER_EFFECT_KINDS,
  type Tracker,
  type TrackerFactory,
  trackerProblems,
  validateChangeRequest,
  validateForgeEffect,
  validateForgeEffectOutcome,
  validateTrackerEffect,
  validateTrackerEffectOutcome,
  validateTrackerItem,
} from "../../src/index.ts";

const item = {
  id: 3,
  key: "lt-3",
  title: "Add login",
  body: "",
  open: true,
  assignees: ["me"],
  labels: ["norn"],
  updated_at: "2026-11-17T10:00:00.000Z",
};

const change = {
  id: 9,
  state: "open",
  draft: true,
  head_branch: "gh-1-add-login",
  base_branch: "main",
  head_sha: "0123456789abcdef0123456789abcdef01234567",
  title: "Add login",
};

describe("tracker contract schemas", () => {
  test("an item of any tracker's key validates; a stray field or a bad key does not", () => {
    expect(validateTrackerItem(item).ok).toBe(true);
    expect(validateTrackerItem({ ...item, url: "https://x/3" }).ok).toBe(true);
    expect(validateTrackerItem({ ...item, state: "open" }).ok).toBe(false);
    expect(validateTrackerItem({ ...item, key: "LT-3" }).ok).toBe(false);
    expect(validateTrackerItem({ ...item, id: 0 }).ok).toBe(false);
    expect(validateTrackerItem({ ...item, updated_at: "yesterday" }).ok).toBe(false);
  });

  test("every effect kind validates in its shape, and an unknown kind does not", () => {
    expect(TRACKER_EFFECT_KINDS).toEqual(["assign", "comment", "create", "close", "labels", "ensure_labels"]);
    const effects = [
      { kind: "assign", id: 1, user: "me" },
      { kind: "comment", id: 1, body: "hi" },
      { kind: "create", title: "T", body: "", labels: ["norn"] },
      { kind: "create", title: "T", body: "", labels: [], assignee: "me" },
      { kind: "close", id: 1 },
      { kind: "labels", id: 1, add: ["a"], remove: [] },
      { kind: "ensure_labels", labels: [{ name: "norn", color: "D93F0B", description: "pick me" }] },
    ];
    for (const e of effects) expect({ e, ok: validateTrackerEffect(e).ok }).toEqual({ e, ok: true });
    for (const e of [{ kind: "reopen", id: 1 }, { kind: "close" }, { kind: "assign", id: 1, user: "me", extra: 1 }, { kind: "ensure_labels", labels: [{ name: "x", color: "#D93F0B", description: "" }] }])
      expect({ e, ok: validateTrackerEffect(e).ok }).toEqual({ e, ok: false });
  });

  test("an outcome names its kind and whether it was replayed", () => {
    expect(validateTrackerEffectOutcome({ kind: "create", id: 4, key: "lt-4", replayed: false }).ok).toBe(true);
    expect(validateTrackerEffectOutcome({ kind: "ensure_labels", replayed: true }).ok).toBe(true);
    expect(validateTrackerEffectOutcome({ kind: "create", id: 4 }).ok).toBe(false);
    expect(validateTrackerEffectOutcome({ kind: "merge", replayed: false }).ok).toBe(false);
  });
});

describe("forge contract schemas", () => {
  test("a change request validates, merged with its merge commit; a stray state does not", () => {
    expect(validateChangeRequest(change).ok).toBe(true);
    expect(validateChangeRequest({ ...change, state: "merged", merge_sha: "abc", merged_at: "2026-11-17T10:00:00Z" }).ok).toBe(true);
    expect(validateChangeRequest({ ...change, state: "draft" }).ok).toBe(false);
    expect(validateChangeRequest({ ...change, number: 9 }).ok).toBe(false);
  });

  test("every effect kind validates, and an outcome carries the change after it", () => {
    expect(FORGE_EFFECT_KINDS).toEqual(["open", "update", "ready"]);
    for (const e of [
      { kind: "open", head: "a", base: "main", title: "T", body: "", draft: true },
      { kind: "update", id: 1, title: "T2" },
      { kind: "update", id: 1 },
      { kind: "ready", id: 1 },
    ])
      expect({ e, ok: validateForgeEffect(e).ok }).toEqual({ e, ok: true });
    expect(validateForgeEffect({ kind: "merge", id: 1 }).ok).toBe(false);
    expect(validateForgeEffect({ kind: "open", head: "a", base: "main", title: "T", body: "" }).ok).toBe(false);
    expect(validateForgeEffectOutcome({ kind: "ready", change: { ...change, draft: false }, replayed: false }).ok).toBe(true);
    expect(validateForgeEffectOutcome({ kind: "ready", replayed: false }).ok).toBe(false);
  });
});

const ctx: HostContext = {
  exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  files: { read: async () => null, write: async () => {}, create: async () => true, list: async () => [], remove: async () => {} },
  now: () => "2026-11-17T10:00:00.000Z",
  repo: { root: "/repo", dataDir: "/data" },
};

function inertTracker(keyPrefix = "lt"): Tracker {
  return {
    name: "inert",
    keyPrefix,
    capabilities: { assign: false, labels: false, comment: false, create: false, close: false },
    whoami: async () => ok("me"),
    intake: async () => ok([]),
    get: async () => ok(null),
    perform: async (e) => ok({ kind: e.kind, replayed: false }),
  };
}

function inertForge(): Forge {
  return {
    name: "none",
    capabilities: { draft: false, checks: false, raw_urls: false },
    findChanges: async (branches) => ok(Object.fromEntries(branches.map((b) => [b, null]))),
    checks: async () => ok("none"),
    perform: async () => ({ ok: false, failure: { code: "invalid", message: "no forge", retryable: false } }),
  };
}

const PrefixConfig = Type.Object({ prefix: Type.Optional(Type.String()) }, { additionalProperties: false });

describe("createTracker and createForge", () => {
  const trackerFactory: TrackerFactory<typeof PrefixConfig> = { configSchema: PrefixConfig, create: (_ctx, config) => inertTracker(config.prefix ?? "lt") };

  test("a valid config makes the tracker the factory returns, with the host context passed in", () => {
    let seen: HostContext | null = null;
    const r = createTracker({ configSchema: PrefixConfig, create: (c) => ((seen = c), inertTracker()) }, ctx, {});
    expect(r.ok && r.value.keyPrefix).toBe("lt");
    expect(seen === ctx).toBe(true);
  });

  test("a config the schema refuses never reaches create", () => {
    let called = false;
    const r = createTracker({ configSchema: PrefixConfig, create: () => ((called = true), inertTracker()) }, ctx, { prefx: "x" });
    expect(r).toEqual({ ok: false, failure: { code: "invalid", message: "tracker config: / unknown property 'prefx'", retryable: false } });
    expect(called).toBe(false);
  });

  test("a tracker with a bad key prefix or a missing method is refused as invalid", () => {
    const bad = createTracker(trackerFactory, ctx, { prefix: "Bad-Prefix" });
    expect(bad.ok ? null : bad.failure.message).toBe('tracker keyPrefix "Bad-Prefix" must match ^[a-z][a-z0-9]{0,7}$');
    const { get: _g, ...half } = inertTracker();
    expect(trackerProblems(half)).toEqual(["lacks get"]);
    expect(trackerProblems({ ...inertTracker(), capabilities: { assign: true } })).toEqual(["capabilities labels, comment, create, close must be booleans"]);
    expect(trackerProblems(null)).toEqual(["is not an object"]);
  });

  test("a factory that throws comes back as a failure, not a throw", () => {
    const r = createForge(
      {
        configSchema: Type.Object({}),
        create: () => {
          throw new Error("boom");
        },
      },
      ctx,
      {},
    );
    expect(r).toEqual({ ok: false, failure: { code: "invalid", message: "forge: create threw (boom)", retryable: false } });
  });

  test("a forge fitting the contract is made; one lacking a method is refused", () => {
    const factory: ForgeFactory = { configSchema: Type.Object({}), create: () => inertForge() };
    expect(createForge(factory, ctx, {}).ok).toBe(true);
    const { checks: _c, ...half } = inertForge();
    expect(forgeProblems(half)).toEqual(["lacks checks"]);
    expect(forgeProblems({ ...inertForge(), name: "" })).toEqual(["needs a name"]);
  });
});
