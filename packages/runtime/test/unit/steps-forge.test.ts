import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, steppingClock } from "@norn/conformance";
import { type ForgeEffect, fail, ok, type PluginResult, type StepKindInput, type Tracker, type Vcs, type VcsMergeOptions, type VcsMergeOutcome } from "@norn/plugin-api";
import { awaitChecks, awaitMerge, checksText, openPr, stepsForgePlugin } from "../../src/index.ts";
import { memoryForge } from "../../../conformance/test/unit/reference/memory-forge.ts";

const ZERO = "0".repeat(40);
const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const WT = "/machine/repo/worktrees/gh-12";

/**
 * A vcs over a commit graph given as child → parents; it pushes into `pushed` and records every
 * merge. `remote` is each branch's remote copy as last fetched; `merge` answers a merge.
 */
function fakeVcs(
  refs: Record<string, string>,
  parents: Record<string, string[]>,
  opts: { push?: boolean; remote?: Record<string, string>; merge?: VcsMergeOutcome; pushRef?: PluginResult<{ pushed: boolean }> } = {},
) {
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
    pushRef: async (ref) => {
      if (opts.pushRef && !opts.pushRef.ok) return opts.pushRef;
      pushed.push(ref);
      return opts.pushRef ?? ok({ pushed: true });
    },
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
  test("provides open-pr, await-checks and await-merge", () => {
    expect(Object.keys(stepsForgePlugin.provides.stepKinds ?? {}).sort()).toEqual(["await-checks", "await-merge", "open-pr"]);
  });

  test("each works over the forge slot, so a workflow names it forge.open-pr, forge.await-checks, forge.await-merge", () => {
    expect(Object.values(stepsForgePlugin.provides.stepKinds ?? {}).map((k) => k.slot)).toEqual(["forge", "forge", "forge"]);
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

  test("an open change takes the re-described pr.md body when open-pr runs again", async () => {
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

  test("reads the PR body where the workflow's producer of pr_body writes it; with none, pr.md in the spec folder, and with no file norn's footer alone", async () => {
    expect(openPr.reads).toEqual([{ name: "pr_body", fallback: expect.stringContaining("pr.md") }]);
    const body = async (files: Record<string, string>, over: Partial<StepKindInput<object>>, config: { body_file?: string } = {}) => {
      const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
      const effects = recorded(world);
      const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
      value(await openPr.run(input(config, { slots: { forge: world.forge, vcs }, ...over }), memoryHost({ files: memoryFiles(files) })));
      return effects.map((e) => (e.kind === "open" ? e.body?.split("\n\n---")[0] : null));
    };
    const both = { [`${WT}/.agents/specs/gh-12/pr.md`]: "# Default\n", [`${WT}/.agents/specs/gh-12/body/pr.md`]: "# Produced\n", [`${WT}/docs/pr.md`]: "# Configured\n" };
    expect(await body(both, { reads: { pr_body: ".agents/specs/gh-12/body/pr.md" } })).toEqual(["# Produced"]);
    expect(await body(both, { reads: { pr_body: ".agents/specs/gh-12/body/pr.md" } }, { body_file: "docs/pr.md" })).toEqual(["# Configured"]);
    expect(await body(both, {})).toEqual(["# Default"]);
    expect(await body({}, {})).toEqual(["Delivered by norn (story gh-12)."]);
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

describe("open-pr's evidence links", () => {
  const EVIDENCE = "e".repeat(40);
  const REF = "refs/norn/evidence/gh-12";
  const KEPT = { commit: EVIDENCE, files: [{ name: "AC2.png", kept: "AC2.webp" }, { name: "AC1.md", kept: "AC1.md" }] };
  const BODY = "# Login fix\n\n![the settings page](evidence:AC2.png)\n\nSee [full output](evidence:AC1.md).\n";

  /** open-pr over a body, the forge's file URLs and the vcs's pushes in one log, so a test reads their order */
  async function opened(body: string, over: Partial<StepKindInput<object>>, opts: { local?: boolean; pushRef?: PluginResult<{ pushed: boolean }>; rawUrls?: boolean } = {}) {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const effects = recorded(world);
    const refs: Record<string, string> = { "gh-12-login": HEAD, ...(opts.local !== false ? { [EVIDENCE]: EVIDENCE } : {}) };
    const { vcs, pushed } = fakeVcs(refs, {}, opts.pushRef ? { pushRef: opts.pushRef } : {});
    const perform = world.forge.perform;
    world.forge.perform = (effect, meta) => {
      pushed.push(`forge ${effect.kind}`);
      return perform(effect, meta);
    };
    const forge = opts.rawUrls === false ? { ...world.forge, capabilities: { ...world.forge.capabilities, raw_urls: false } } : world.forge;
    const files = memoryFiles({ [`${WT}/.agents/specs/gh-12/pr.md`]: body });
    const r = await openPr.run(input({}, { slots: { forge, vcs }, ...over }), memoryHost({ files }));
    const sent = effects.map((e) => (e.kind === "open" || e.kind === "update" ? (e.body ?? "").split("\n\n---")[0] : null));
    return { r, sent, pushed };
  }

  test("an image link shows the kept file from the forge's raw URL at the evidence commit, a plain link opens its file page, the text kept", async () => {
    const { r, sent } = await opened(BODY, { evidence: KEPT });
    expect(value(r).outcome).toBe("done");
    expect(sent).toEqual([`# Login fix\n\n![the settings page](memory://files/${EVIDENCE}/AC2.webp?raw=true)\n\nSee [full output](memory://files/${EVIDENCE}/AC1.md).`]);
  });

  test("a name the latest report kept no file for reads as text, never a broken image or link", async () => {
    const body = "![](evidence:AC2.png)\n\n[the log](evidence:AC9.log)\n";
    const { sent, pushed } = await opened(body, { evidence: { commit: EVIDENCE, files: [{ name: "AC1.md", kept: "AC1.md" }] } });
    expect(sent).toEqual(["AC2.png (evidence not published)\n\nthe log: AC9.log (evidence not published)"]);
    expect(pushed).toEqual(["gh-12-login", "forge open"]);
  });

  test("with no evidence from the host every evidence link reads as text", async () => {
    const { sent } = await opened(BODY, {});
    expect(sent).toEqual(["# Login fix\n\nthe settings page: AC2.png (evidence not published)\n\nSee full output: AC1.md (evidence not published)."]);
  });

  test("the evidence ref is pushed before the forge opens or updates the change; with no link resolved nothing is pushed", async () => {
    expect((await opened(BODY, { evidence: KEPT })).pushed).toEqual(["gh-12-login", REF, "forge open"]);
    expect((await opened("# No evidence cited\n", { evidence: KEPT })).pushed).toEqual(["gh-12-login", "forge open"]);
  });

  test("a failed evidence push fails the step retryably and the forge performs nothing", async () => {
    const { r, pushed } = await opened(BODY, { evidence: KEPT }, { pushRef: fail("auth", "git push: permission denied") });
    expect(r.ok ? null : { code: r.failure.code, retryable: r.failure.retryable }).toEqual({ code: "auth", retryable: true });
    expect(r.ok ? "" : r.failure.message).toContain("permission denied");
    expect(pushed).toEqual(["gh-12-login"]);
  });

  test("an evidence commit the local repo lacks (the story taken to another machine) leaves every link as text, pushes nothing and opens the change", async () => {
    const { r, sent, pushed } = await opened(BODY, { evidence: KEPT }, { local: false });
    expect(value(r).outcome).toBe("done");
    expect(sent[0]).toContain("the settings page: AC2.png (evidence not published)");
    expect(sent[0]).not.toContain("evidence:");
    expect(pushed).toEqual(["gh-12-login", "forge open"]);
  });

  test("a forge that serves no raw URLs leaves every link as text and pushes nothing", async () => {
    const { sent, pushed } = await opened(BODY, { evidence: KEPT }, { rawUrls: false });
    expect(sent[0]).toContain("See full output: AC1.md (evidence not published).");
    expect(pushed).toEqual(["gh-12-login", "forge open"]);
  });
});

describe("await-merge", () => {
  async function opened(refs: Record<string, string>, parents: Record<string, string[]>) {
    const world = memoryForge({ now: steppingClock("2026-11-17T00:00:00.000Z") });
    const { vcs } = fakeVcs(refs, parents);
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    // the merge step's own receipt, as the host writes one per step run
    const poll = () => awaitMerge.run(input<Record<string, never>>({}, { step: "merge", receipt_id: "01JD0000000000000000000002", slots: { forge: world.forge, vcs } }), memoryHost());
    return { world, poll, vcs };
  }

  test("waits while the change holds the branch and the branch holds the base", async () => {
    // the reference forge reports every change at the zero commit
    const { poll } = await opened({ "gh-12-login": ZERO, "origin/main": BASE }, { [ZERO]: [BASE] });
    expect(value(await poll()).outcome).toBe("waiting");
  });

  test("a draft change waiting at merge is marked ready, once: a forge merges no draft", async () => {
    const { world, poll } = await opened({ "gh-12-login": ZERO, "origin/main": BASE }, { [ZERO]: [BASE] });
    const effects = recorded(world);
    expect(value(await world.forge.findChanges(["gh-12-login"]))["gh-12-login"]?.draft).toBe(true);
    expect(value(await poll()).outcome).toBe("waiting");
    expect(value(await world.forge.findChanges(["gh-12-login"]))["gh-12-login"]?.draft).toBe(false);
    expect(value(await poll()).outcome).toBe("waiting");
    expect(effects.map((e) => e.kind)).toEqual(["ready"]);
  });

  test("a draft change the branch has outgrown is not marked ready: its commits go through open-pr first", async () => {
    const { world, poll } = await opened({ "gh-12-login": HEAD, "origin/main": BASE }, { [HEAD]: [ZERO], [ZERO]: [BASE] });
    const effects = recorded(world);
    expect(value(await poll()).outcome).toBe("unpushed");
    expect(effects).toEqual([]);
  });

  test("merged once the change merged, even though the base moved with it", async () => {
    const { world, poll } = await opened({ "gh-12-login": ZERO, "origin/main": "9".repeat(40) }, {});
    await world.merge?.(1, "9".repeat(40));
    expect(value(await poll()).outcome).toBe("merged");
  });

  test("a change merged into a branch other than the story's base waits for a person: nothing reached the base", async () => {
    const { world } = await opened({ "gh-12-login": ZERO, "origin/release": BASE }, {});
    await world.merge?.(1, "9".repeat(40));
    const { vcs } = fakeVcs({ "gh-12-login": ZERO }, {});
    const elsewhere = await awaitMerge.run(input<Record<string, never>>({}, { step: "merge", base: { branch: "release", ref: "origin/release" }, slots: { forge: world.forge, vcs } }), memoryHost());
    expect(value(elsewhere)).toMatchObject({ outcome: "waiting", detail: { reason: "the change merged into main, not the story's base release" } });
  });

  test("a base the story lacks is never answered stale here: the host's stale signal decides that by the workflow's policy", async () => {
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

  test("commits past the change that touch only the story's spec folder keep it waiting; one touching code is unpushed", async () => {
    const { poll, vcs } = await opened({ "gh-12-login": HEAD, "origin/main": BASE }, { [HEAD]: [ZERO], [ZERO]: [BASE] });
    let paths = [".agents/specs/gh-12/notes.md"];
    vcs.changedPaths = async () => ok(paths);
    expect(value(await poll()).outcome).toBe("waiting");
    paths = [".agents/specs/gh-12/notes.md", "src/a.ts"];
    expect(value(await poll()).outcome).toBe("unpushed");
  });

  test("a closed change waits for a person, even with commits it lacks; without a vcs only the merge is watched", async () => {
    const { world, poll } = await opened({ "gh-12-login": HEAD, "origin/main": BASE }, {});
    await world.close?.(1);
    expect(value(await poll()).outcome).toBe("waiting");
    const bare = await awaitMerge.run(input<Record<string, never>>({}, { step: "merge", slots: { forge: world.forge } }), memoryHost());
    expect(value(bare).outcome).toBe("waiting");
  });
});

describe("await-checks", () => {
  const START = "2026-11-17T00:00:00.000Z";
  const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();

  async function opened(over: { checks?: boolean } = {}) {
    const world = memoryForge({ now: steppingClock(START) });
    const { vcs } = fakeVcs({ "gh-12-login": HEAD }, {});
    value(await openPr.run(input({}, { slots: { forge: world.forge, vcs } }), memoryHost()));
    const forge = over.checks === false ? { ...world.forge, capabilities: { ...world.forge.capabilities, checks: false } } : world.forge;
    const poll = (minutes = 0, config: { appear?: string; settle?: string } = {}) =>
      awaitChecks.run(input(config, { step: "checks", started_at: START, slots: { forge, vcs } }), memoryHost({ now: () => at(minutes) }));
    return { world, poll };
  }

  test("waits while the checks are pending, passes once they all passed", async () => {
    const { world, poll } = await opened();
    await world.setChecks?.(1, "pending");
    expect(value(await poll()).outcome).toBe("waiting");
    await world.setChecks?.(1, "success");
    expect(value(await poll()).outcome).toBe("pass");
  });

  test("fails on a failed check, naming each failed check and its link for the step that reworks it", async () => {
    const { world, poll } = await opened();
    await world.setChecks?.(1, "failure");
    const r = value(await poll());
    expect(r).toMatchObject({ outcome: "fail", detail: { change: 1, failed: [{ name: "test", url: "memory://changes/1/checks/test" }] } });
    const text = checksText("checks", r.outcome, r.detail) ?? "";
    expect(text).toContain("Check `checks` ended `fail`");
    expect(text).toContain("- test: memory://changes/1/checks/test");
  });

  test("stale when the change conflicts with its base, since no check runs on it until it takes the base", async () => {
    const { world, poll } = await opened();
    await world.setChecks?.(1, "pending");
    await world.setConflicts?.(1, true);
    expect(value(await poll()).outcome).toBe("stale");
  });

  test("no check at all waits for one to appear, then passes: the repo runs no CI", async () => {
    const { poll } = await opened();
    expect(value(await poll(4)).outcome).toBe("waiting");
    expect(value(await poll(5)).outcome).toBe("pass");
    expect(value(await poll(1, { appear: "1m" })).outcome).toBe("pass");
  });

  test("checks still pending past settle fail", async () => {
    const { world, poll } = await opened();
    await world.setChecks?.(1, "pending");
    expect(value(await poll(29)).outcome).toBe("waiting");
    const r = value(await poll(30));
    expect(r.outcome).toBe("fail");
    expect(checksText("checks", r.outcome, r.detail)).toContain("still pending after 30m");
    expect(value(await poll(10, { settle: "10m" })).outcome).toBe("fail");
  });

  test("a forge that runs no checks passes at once; no change, or no forge, fails the step", async () => {
    const { poll } = await opened({ checks: false });
    expect(value(await poll()).outcome).toBe("pass");
    const world = memoryForge({ now: steppingClock(START) });
    const none = await awaitChecks.run(input({}, { step: "checks", slots: { forge: world.forge } }), memoryHost());
    expect(none.ok ? null : none.failure.code).toBe("not_found");
    const noForge = await awaitChecks.run(input({}, { step: "checks" }), memoryHost());
    expect(noForge.ok ? null : noForge.failure.code).toBe("invalid");
  });

  test("a forge without a checks report is read through its summary alone", async () => {
    const { world, poll } = await opened();
    delete world.forge.checkReport;
    await world.setChecks?.(1, "failure");
    expect(value(await poll())).toMatchObject({ outcome: "fail", detail: { failed: [] } });
  });
});
