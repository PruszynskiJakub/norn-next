import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, steppingClock } from "@norn/conformance";
import { type ForgeEffect, ok, type PluginResult, type StepKindInput, type Tracker, type Vcs, type VcsMergeOptions, type VcsMergeOutcome } from "@norn/plugin-api";
import { awaitMerge, openPr, stepsForgePlugin } from "../../src/index.ts";
import { memoryForge } from "../../../conformance/test/unit/reference/memory-forge.ts";

const ZERO = "0".repeat(40);
const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const WT = "/machine/repo/worktrees/gh-12";

/**
 * A vcs over a commit graph given as child → parents; it pushes into `pushed` and records every
 * merge. `remote` is each branch's remote copy as last fetched; `merge` answers a merge.
 */
function fakeVcs(refs: Record<string, string>, parents: Record<string, string[]>, opts: { push?: boolean; remote?: Record<string, string>; merge?: VcsMergeOutcome } = {}) {
  const pushed: string[] = [];
  const merges: { branch: string; from: string; opts?: VcsMergeOptions }[] = [];
  const reach = (from: string, to: string): boolean => from === to || (parents[from] ?? []).some((p) => reach(p, to));
  const vcs: Vcs = {
    name: "fake",
    capabilities: { worktrees: true, merge: true, push: opts.push ?? true },
    worktree: { path: (u) => `/wt/${u}`, ensure: async () => ok({ path: "/wt" }), remove: async () => ok(undefined) },
    head: async (ref) => ok(refs[ref] ?? null),
    isAncestor: async (a, b) => ok(reach(b, a)),
    mergeBase: async () => ok(null),
    merge: async (branch, from, o) => {
      merges.push({ branch, from, ...(o ? { opts: o } : {}) });
      return ok(opts.merge ?? { head: HEAD });
    },
    remoteHead: async (b) => ok(opts.remote?.[b] ?? null),
    push: async (b) => {
      pushed.push(b);
      return ok(undefined);
    },
    fetch: async () => ok(undefined),
  };
  return { vcs, pushed, merges };
}

const input = <C>(config: C, over: Partial<StepKindInput<C>> = {}): StepKindInput<C> => ({
  unit: "gh-12",
  story: "gh-12",
  step: "open-pr",
  config,
  worktree: WT,
  branch: "gh-12-login",
  base: { branch: "main", ref: "origin/main" },
  receipt_id: "01JD0000000000000000000001",
  ...over,
});

function tracker(): Tracker {
  return {
    name: "t",
    keyPrefix: "gh",
    capabilities: {} as Tracker["capabilities"],
    whoami: async () => ok("me"),
    intake: async () => ok([]),
    get: async (id) => ok(id === 12 ? { key: "gh-12", title: "Fix login", url: "https://example.test/12" } as never : null),
    perform: async () => ok({}) as never,
  };
}

/** The forge's effects as performed, so a test can read the body open-pr sent. */
function recorded(world: ReturnType<typeof memoryForge>) {
  const effects: ForgeEffect[] = [];
  const perform = world.forge.perform;
  world.forge.perform = (effect, meta) => {
    effects.push(effect);
    return perform(effect, meta);
  };
  return effects;
}

const value = <T>(r: PluginResult<T>): T => {
  if (!r.ok) throw new Error(`${r.failure.code}: ${r.failure.message}`);
  return r.value;
};

describe("norn-steps-forge", () => {
  test("provides open-pr and await-merge", () => {
    expect(Object.keys(stepsForgePlugin.provides.stepKinds ?? {}).sort()).toEqual(["await-merge", "open-pr"]);
  });
});

describe("open-pr", () => {
  test("pushes the branch and opens a draft change from pr.md, titled by the tracker, closing the story", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs, pushed } = fakeVcs({ "gh-12-login": HEAD }, {});
    const effects = recorded(world);
    const files = memoryFiles({ [`${WT}/.agents/specs/gh-12/pr.md`]: "# Login fix\n\nWhat changed.\n" });
    const ctx = memoryHost({ files });
    const r = value(await openPr.run(input({}, { slots: { forge: world.forge, vcs, tracker: tracker() } }), ctx));
    expect(r.outcome).toBe("done");
    expect(pushed).toEqual(["gh-12-login"]);
    const change = value(await world.forge.findChanges(["gh-12-login"]))["gh-12-login"];
    expect(change).toMatchObject({ state: "open", draft: true, base_branch: "main", title: "Fix login" });
    expect(effects.map((e) => (e.kind === "open" ? e.body : null))).toEqual(["# Login fix\n\nWhat changed.\n\n---\n\nCloses https://example.test/12\n\nDelivered by norn (story gh-12)."]);
  });

  test("a slice unit's open-pr reads its story's pr.md, and an open change takes the re-described body", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const effects = recorded(world);
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    const files = memoryFiles({ [`${WT}/.agents/specs/gh-12/pr.md`]: "# First\n" });
    const ctx = memoryHost({ files });
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), ctx));
    await files.write(`${WT}/.agents/specs/gh-12/pr.md`, "# Second\n\nMerge danger changed.\n");
    const again = value(await openPr.run(input({}, { unit: "gh-12/01-form", slots: { forge: world.forge, vcs }, receipt_id: "01JD0000000000000000000002" }), ctx));
    expect(again.detail).toMatchObject({ effect: "update" });
    expect(effects.map((e) => (e.kind === "open" || e.kind === "update" ? e.body?.split("\n\n---")[0] : null))).toEqual(["# First", "# Second\n\nMerge danger changed."]);
  });

  test("open is idempotent by receipt id: the same run again opens no second change", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    const ctx = memoryHost();
    const a = value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), ctx));
    const b = value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), ctx));
    expect((a.detail as { change: { id: number } }).change.id).toBe(1);
    expect(b.detail).toMatchObject({ change: { id: 1 }, replayed: true });
    // a new run with a new receipt updates the open change rather than opening another
    const c = value(await openPr.run(input({}, { slots: { forge: world.forge, vcs }, receipt_id: "01JD0000000000000000000002" }), ctx));
    expect(c.detail).toMatchObject({ change: { id: 1 }, effect: "update", replayed: false });
  });

  test("with no receipt id the key is derived from the head, so a repeat still replays", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    const bare = input({}, { slots: { forge: world.forge, vcs } });
    delete bare.receipt_id;
    value(await openPr.run(bare, memoryHost()));
    await world.close?.(1);
    const again = value(await openPr.run(bare, memoryHost()));
    expect(again.detail).toMatchObject({ change: { id: 1 }, replayed: true });
  });

  test("an already merged change is refused; no forge or no branch fails the step", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    await world.merge?.(1, HEAD);
    const merged = await openPr.run(input({}, { slots: { forge: world.forge, vcs }, receipt_id: "01JD0000000000000000000003" }), memoryHost());
    expect(merged.ok ? null : merged.failure.code).toBe("conflict");
    const none = await openPr.run(input({}), memoryHost());
    expect(none.ok ? null : none.failure.code).toBe("invalid");
    const noBranch = await openPr.run(input({}, { slots: { forge: world.forge }, branch: undefined }), memoryHost());
    expect(noBranch.ok ? null : noBranch.failure.code).toBe("invalid");
  });

  test("a vcs that does not push opens the change without pushing", async () => {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs, pushed } = fakeVcs({ "gh-12-login": HEAD }, {}, { push: false });
    expect(value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost())).outcome).toBe("done");
    expect(pushed).toEqual([]);
  });

  test("a person's push to the branch is merged in before the push, never forced, and the change shows the merge", async () => {
    const PERSON = "5".repeat(40);
    const MERGED = "6".repeat(40);
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs, pushed, merges } = fakeVcs({ "gh-12-login": HEAD }, {}, { remote: { "gh-12-login": PERSON }, merge: { head: MERGED } });
    const r = value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    expect(merges).toEqual([{ branch: "gh-12-login", from: PERSON, opts: { abortOnConflict: true } }]);
    expect(pushed).toEqual(["gh-12-login"]);
    expect(r.detail).toMatchObject({ head: MERGED, effect: "open" });
  });

  test("a remote copy the branch already holds is pushed over without a merge", async () => {
    const OLD = "5".repeat(40);
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs, pushed, merges } = fakeVcs({ "gh-12-login": HEAD }, { [HEAD]: [OLD] }, { remote: { "gh-12-login": OLD } });
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    expect(merges).toEqual([]);
    expect(pushed).toEqual(["gh-12-login"]);
  });

  test("a person's push that conflicts with the branch is refused for a person: nothing pushed, no change opened", async () => {
    const PERSON = "5".repeat(40);
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs, pushed } = fakeVcs({ "gh-12-login": HEAD }, {}, { remote: { "gh-12-login": PERSON }, merge: { conflict: { files: ["src/a.ts"] } } });
    const r = await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost());
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "conflict", retryable: false });
    expect(r.ok ? "" : r.failure.message).toContain("src/a.ts");
    expect(r.ok ? "" : r.failure.message).toContain("by hand");
    expect(pushed).toEqual([]);
    expect(value(await world.forge.findChanges(["gh-12-login"]))["gh-12-login"] ?? null).toBeNull();
  });
});

describe("await-merge", () => {
  async function opened(refs: Record<string, string>, parents: Record<string, string[]>) {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs(refs, parents);
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    const poll = () => awaitMerge.run(input<Record<string, never>>({}, { step: "merge", slots: { forge: world.forge, vcs } }), memoryHost());
    return { world, poll };
  }

  test("waits while the change holds the branch and the branch holds the base", async () => {
    // the reference forge reports every change at the zero commit
    const { poll } = await opened({ "gh-12-login": ZERO, "origin/main": BASE }, { [ZERO]: [BASE] });
    expect(value(await poll()).outcome).toBe("waiting");
  });

  test("merged once the change merged, even though the base moved with it", async () => {
    const { world, poll } = await opened({ "gh-12-login": ZERO, "origin/main": "9".repeat(40) }, {});
    await world.merge?.(1, "9".repeat(40));
    expect(value(await poll()).outcome).toBe("merged");
  });

  test("a base the story lacks is never answered stale here: the host's base_stale fact decides that by the workflow's policy", async () => {
    const { poll } = await opened({ "gh-12-login": ZERO, "origin/main": BASE }, {});
    expect(value(await poll()).outcome).toBe("waiting");
  });

  test("unpushed when the branch holds commits the change lacks, or no change holds it", async () => {
    const { poll } = await opened({ "gh-12-login": HEAD, "origin/main": BASE }, { [HEAD]: [ZERO], [ZERO]: [BASE] });
    expect(value(await poll()).outcome).toBe("unpushed");
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    const none = await awaitMerge.run(input<Record<string, never>>({}, { step: "merge", slots: { forge: world.forge, vcs } }), memoryHost());
    expect(value(none).outcome).toBe("unpushed");
  });

  test("a closed change waits for a person, even with commits it lacks; without a vcs only the merge is watched", async () => {
    const { world, poll } = await opened({ "gh-12-login": HEAD, "origin/main": BASE }, {});
    await world.close?.(1);
    expect(value(await poll()).outcome).toBe("waiting");
    const bare = await awaitMerge.run(input<Record<string, never>>({}, { step: "merge", slots: { forge: world.forge } }), memoryHost());
    expect(value(bare).outcome).toBe("waiting");
  });
});
