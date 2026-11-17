import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { createVcs, defineNornPlugin, type HostContext, ok, type Vcs, type VcsFactory, vcsProblems } from "../../src/index.ts";

const ctx: HostContext = {
  exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  files: { read: async () => null, write: async () => {}, create: async () => true, list: async () => [], remove: async () => {} },
  now: () => "2026-11-17T10:00:00.000Z",
  repo: { root: "/repo", dataDir: "/data" },
};

function inertVcs(dataDir = "/data"): Vcs {
  return {
    name: "inert",
    capabilities: { worktrees: true, merge: true, push: false },
    worktree: {
      ensure: async (unit) => ok({ path: `${dataDir}/worktrees/${unit}` }),
      remove: async () => ok(undefined),
      path: (unit) => `${dataDir}/worktrees/${unit}`,
    },
    head: async () => ok(null),
    isAncestor: async () => ok(false),
    mergeBase: async () => ok(null),
    merge: async () => ok({ conflict: { files: ["a.ts"] } }),
    push: async () => ok(undefined),
    fetch: async () => ok(undefined),
  };
}

describe("vcs contract", () => {
  test("a vcs fitting the contract has no problems", () => {
    expect(vcsProblems(inertVcs())).toEqual([]);
  });

  test("names a missing method, a missing worktree part and a non-boolean capability", () => {
    const { merge: _m, fetch: _f, ...half } = inertVcs();
    expect(vcsProblems(half)).toEqual(["lacks merge, fetch"]);
    const v = inertVcs();
    expect(vcsProblems({ ...v, worktree: { ensure: v.worktree.ensure } })).toEqual(["worktree lacks remove, path"]);
    expect(vcsProblems({ ...v, worktree: undefined })).toEqual(["needs worktree"]);
    expect(vcsProblems({ ...v, capabilities: { worktrees: true, merge: "yes" } })).toEqual(["capabilities merge, push must be booleans"]);
    expect(vcsProblems(null)).toEqual(["is not an object"]);
  });

  test("createVcs validates the config, passes the host context and refuses half a vcs", () => {
    const Config = Type.Object({ remote: Type.String() }, { additionalProperties: false });
    let seen: HostContext | null = null;
    const factory: VcsFactory<typeof Config> = { configSchema: Config, create: (c) => ((seen = c), inertVcs(c.repo.dataDir)) };
    const made = createVcs(factory, ctx, { remote: "origin" });
    expect(made.ok && made.value.worktree.path("gh-1")).toBe("/data/worktrees/gh-1");
    expect(seen === ctx).toBe(true);
    expect(createVcs(factory, ctx, {})).toEqual({ ok: false, failure: { code: "invalid", message: "vcs config: / must have required property 'remote'", retryable: false } });
    const { head: _h, ...half } = inertVcs();
    expect(createVcs({ configSchema: Type.Object({}), create: () => half as Vcs }, ctx, {})).toEqual({
      ok: false,
      failure: { code: "invalid", message: "vcs lacks head", retryable: false },
    });
  });
});

describe("defineNornPlugin: vcs slot", () => {
  const factory: VcsFactory = { configSchema: Type.Object({}), create: () => inertVcs() };

  test("keeps a vcs factory, frozen, beside the older slots", () => {
    const plugin = defineNornPlugin({ name: "norn-vcs-inert", api: "^1.4", provides: { vcs: { inert: factory } } });
    expect(plugin.provides.vcs?.inert).toBe(factory);
    expect(Object.isFrozen(plugin.provides.vcs)).toBe(true);
  });

  test("refuses a vcs factory without a configSchema or create", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { vcs: { git: { create: factory.create } as unknown as VcsFactory } } })).toThrow(
      "norn plugin p: vcs git needs a configSchema",
    );
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { vcs: { git: { configSchema: factory.configSchema } as unknown as VcsFactory } } })).toThrow(
      "norn plugin p: vcs git lacks create",
    );
  });
});
