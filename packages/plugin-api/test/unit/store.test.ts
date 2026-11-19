import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  artifactPathClash,
  createStore,
  type HostContext,
  isStoreId,
  isStoryUnit,
  isUnitId,
  normalizeArtifactPath,
  ok,
  parseUnitId,
  sliceUnitId,
  type Store,
  type StoreFactory,
  storeProblems,
  validateClaimRecord,
  validateStoredMessage,
  validateStoredReceipt,
  validateStoredState,
  validateUnitRecord,
} from "../../src/index.ts";

describe("unit ids", () => {
  test("a story key or a slice of one parses; anything else does not", () => {
    expect(parseUnitId("gh-12")).toEqual({ story: "gh-12", slice: null });
    expect(parseUnitId("lt-3/03")).toEqual({ story: "lt-3", slice: "03" });
    expect(parseUnitId("gh-12/123")).toEqual({ story: "gh-12", slice: "123" });
    for (const bad of ["", "gh-0", "GH-1", "gh-1/3", "gh-1/1234", "gh-1/03/01", "gh-1/", "/03", "gh-99999999999999999999", 12, null])
      expect({ bad, parsed: parseUnitId(bad) }).toEqual({ bad, parsed: null });
  });

  test("isUnitId, isStoryUnit and sliceUnitId agree with the parse", () => {
    expect(isUnitId("gh-1/01")).toBe(true);
    expect(isStoryUnit("gh-1")).toBe(true);
    expect(isStoryUnit("gh-1/01")).toBe(false);
    expect(sliceUnitId("gh-12", 3)).toBe("gh-12/03");
    expect(sliceUnitId("gh-12", "101")).toBe("gh-12/101");
    expect(() => sliceUnitId("gh-12/01", 3)).toThrow("not a story key");
    expect(() => sliceUnitId("gh-12", 1000)).toThrow("bad slice number");
  });

  test("store ids are file-name safe", () => {
    expect(isStoreId("01JD0000000000000000000001")).toBe(true);
    expect(isStoreId("msg.1_a-b")).toBe(true);
    for (const bad of ["", ".hidden", "a/b", "a b", "a\\b", "x".repeat(129), 7]) expect({ bad, ok: isStoreId(bad) }).toEqual({ bad, ok: false });
  });
});

describe("normalizeArtifactPath", () => {
  test("canonicalizes `.` and doubled slashes", () => {
    expect(normalizeArtifactPath("specs/a.md")).toBe("specs/a.md");
    expect(normalizeArtifactPath("specs/./a.md")).toBe("specs/a.md");
    expect(normalizeArtifactPath("./specs//a.md")).toBe("specs/a.md");
  });

  test("refuses absolute, escaping, empty and folder paths", () => {
    for (const bad of ["", "/etc/passwd", "../x", "specs/../a.md", "a/..", ".", "./", "specs/", "a\\b", "a\0b", 3])
      expect({ bad, path: normalizeArtifactPath(bad) }).toEqual({ bad, path: null });
  });
});

describe("artifactPathClash", () => {
  test("names the file a path would sit under, or the files a path would cover", () => {
    expect(artifactPathClash(["a"], "a/b")).toBe("a");
    expect(artifactPathClash(["x/y"], "x/y/z.md")).toBe("x/y");
    expect(artifactPathClash(["c/d"], "c")).toBe("c/d");
    expect(artifactPathClash(["c/d/e.md"], "c")).toBe("c/d/e.md");
  });

  test("the same path, a sibling or a shared prefix that is not a folder is no clash", () => {
    expect(artifactPathClash(["a"], "a")).toBeNull();
    expect(artifactPathClash(["ab/c.md", "a.md", "a-b"], "a")).toBeNull();
    expect(artifactPathClash(["a/b.md"], "a/c.md")).toBeNull();
    expect(artifactPathClash([], "a")).toBeNull();
  });
});

describe("store envelope schemas", () => {
  const at = "2026-11-17T10:00:00.000Z";

  test("a receipt, a state and a message carry any JSON as data", () => {
    expect(validateStoredReceipt({ seq: 1, id: "r1", at, data: { kind: "x", n: [1, null] } }).ok).toBe(true);
    expect(validateStoredReceipt({ seq: 2, id: "r2", at, data: null }).ok).toBe(true);
    expect(validateStoredReceipt({ seq: 0, id: "r1", at, data: 1 }).ok).toBe(false);
    expect(validateStoredReceipt({ seq: 1, id: "a/b", at, data: 1 }).ok).toBe(false);
    expect(validateStoredReceipt({ seq: 1, id: "r1", at, data: 1, extra: true }).ok).toBe(false);
    expect(validateStoredState({ version: 1, data: "x" }).ok).toBe(true);
    expect(validateStoredState({ version: 0, data: "x" }).ok).toBe(false);
    expect(validateStoredMessage({ id: "m1", from: "gh-1/01", at, data: { text: "hi" } }).ok).toBe(true);
    expect(validateStoredMessage({ id: "m1", from: "", at, data: 1 }).ok).toBe(false);
  });

  test("a claim names a story key, its holder and its times", () => {
    const claim = { story: "gh-1", holder: "machine-a", acquired_at: at, expires_at: at, version: 1 };
    expect(validateClaimRecord(claim).ok).toBe(true);
    expect(validateClaimRecord({ ...claim, story: "gh-1/01" }).ok).toBe(false);
    expect(validateClaimRecord({ ...claim, expires_at: "soon" }).ok).toBe(false);
  });

  test("a unit record has a state or null, and its receipts", () => {
    expect(validateUnitRecord({ state: null, receipts: [] }).ok).toBe(true);
    expect(validateUnitRecord({ state: { version: 2, data: {} }, receipts: [{ seq: 1, id: "r", at, data: 0 }] }).ok).toBe(true);
    expect(validateUnitRecord({ receipts: [] }).ok).toBe(false);
  });
});

const ctx: HostContext = {
  exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  files: { read: async () => null, write: async () => {}, create: async () => true, list: async () => [], remove: async () => {} },
  now: () => "2026-11-17T10:00:00.000Z",
  repo: { root: "/repo", dataDir: "/data" },
};

function inertStore(over: Partial<Store> = {}): Store {
  return {
    name: "inert",
    capabilities: { shared: false, claims: "local", mailbox: false, artifacts: false },
    listUnits: async () => ok([]),
    readUnit: async () => ok({ state: null, receipts: [] }),
    appendReceipt: async () => ok({ seq: 1, replayed: false }),
    commitState: async () => ok({ version: 1 }),
    claims: { read: async () => ok(null), acquire: async () => ok({} as never), renew: async () => ok({} as never), release: async () => ok(null) },
    archive: async () => ok({ archived: [] }),
    ...over,
  };
}

describe("storeProblems and createStore", () => {
  test("a store fitting the contract has no problems and is made", () => {
    expect(storeProblems(inertStore())).toEqual([]);
    const factory: StoreFactory = { configSchema: Type.Object({}), create: () => inertStore() };
    expect(createStore(factory, ctx, {}).ok).toBe(true);
  });

  test("missing methods, claims and capabilities are named", () => {
    const { commitState: _c, claims: _k, ...half } = inertStore();
    expect(storeProblems(half)).toEqual(["lacks commitState", "needs claims"]);
    expect(storeProblems(inertStore({ claims: { read: async () => ok(null) } as unknown as Store["claims"] }))).toEqual(["claims lacks acquire, renew, release"]);
    expect(storeProblems({ ...inertStore(), capabilities: { shared: false, claims: "global", mailbox: 1 } })).toEqual([
      "capabilities mailbox, artifacts must be booleans",
      'capability claims must be "local" or "distributed"',
    ]);
    expect(storeProblems(null)).toEqual(["is not an object"]);
  });

  test("a capability and the part it names must agree both ways", () => {
    const caps = { shared: false, claims: "local" as const, mailbox: true, artifacts: false };
    expect(storeProblems(inertStore({ capabilities: caps }))).toEqual(["needs mailbox"]);
    const mailbox = { send: async () => ok({ replayed: false }), receive: async () => ok([]), ack: async () => ok(null) };
    expect(storeProblems(inertStore({ capabilities: caps, mailbox }))).toEqual([]);
    expect(storeProblems(inertStore({ mailbox }))).toEqual(["offers mailbox its capabilities deny"]);
  });

  test("the takeover capability and claims.takeOver agree both ways", () => {
    const takeOver = async () => ok({} as never);
    const claims = { ...inertStore().claims, takeOver };
    const caps = { shared: false, claims: "local" as const, mailbox: false, artifacts: false, takeover: true };
    expect(storeProblems(inertStore({ capabilities: caps, claims }))).toEqual([]);
    expect(storeProblems(inertStore({ capabilities: caps }))).toEqual(["claims lacks takeOver its capabilities offer"]);
    expect(storeProblems(inertStore({ claims }))).toEqual(["offers claims.takeOver its capabilities deny"]);
  });

  test("diverged and adoptRemote, when offered, are functions", () => {
    expect(storeProblems(inertStore({ diverged: "yes" as never, adoptRemote: 1 as never }))).toEqual(["diverged must be a function", "adoptRemote must be a function"]);
    expect(storeProblems(inertStore({ diverged: async () => ok(false), adoptRemote: async () => ok({ dropped: null }) }))).toEqual([]);
  });

  test("a shared store must sync and flush", () => {
    const caps = { shared: true, claims: "distributed" as const, mailbox: false, artifacts: false };
    expect(storeProblems(inertStore({ capabilities: caps }))).toEqual(["a shared store lacks sync", "a shared store lacks flush"]);
    expect(storeProblems(inertStore({ capabilities: caps, sync: async () => ok({ fetched: 0 }), flush: async () => ok({ pushed: false }) }))).toEqual([]);
  });

  test("a config the schema refuses never reaches create; a broken store is refused as invalid", () => {
    let called = false;
    const factory: StoreFactory = { configSchema: Type.Object({ remote: Type.Optional(Type.String()) }, { additionalProperties: false }), create: () => ((called = true), inertStore()) };
    expect(createStore(factory, ctx, { remot: "x" })).toEqual({ ok: false, failure: { code: "invalid", message: "store config: / unknown property 'remot'", retryable: false } });
    expect(called).toBe(false);
    const broken: StoreFactory = { configSchema: Type.Object({}), create: () => inertStore({ name: "" }) };
    expect(createStore(broken, ctx, {})).toEqual({ ok: false, failure: { code: "invalid", message: "store needs a name", retryable: false } });
  });
});
