import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { defineNornPlugin, ok } from "@norn/plugin-api";
import { packSdlcPlugin } from "@norn/pack-sdlc";
import { localStorePlugin } from "@norn/store-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { Type } from "@sinclair/typebox";
import { createRuntimeEnv, gatherFacts, loadPinned, stepsForgePlugin } from "../../src/index.ts";
import { has, harness, record, tickUntil, trackerItem } from "./support.ts";

describe("pinned workflows", () => {
  test("every shipped workflow reloads from the flat document a unit pins to the same hash", () => {
    const h = harness();
    const env = createRuntimeEnv({
      ctx: memoryHost(),
      plugins: [...h.plugins.filter((p) => p.name === "fakes"), localStorePlugin, packSdlcPlugin, vcsGitPlugin, stepsForgePlugin].map((p) =>
        p.name === "fakes" ? { ...p, provides: { ...p.provides, stepKinds: {}, packs: {} } } : p,
      ),
      config: { ...h.config, pack: "sdlc" },
      launcher: h.launcher,
      sessions: h.sessions,
    });
    if (!env.ok) throw new Error(env.failure.message);
    const loaded = Object.entries(env.value.workflows).flatMap(([name, load]) => (load.ok ? [[name, load.workflow] as const] : []));
    expect(loaded.map(([name]) => name)).toContain("story");
    for (const [name, wf] of loaded) expect([name, loadPinned(env.value, wf.pinned)?.pinned.hash]).toEqual([name, wf.pinned.hash]);
  });

  test("a unit keeps its pinned workflow after the pack's file changes", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const pinned = (await record(h, "lt-1")).state?.workflow;
    if (!pinned) throw new Error("the round pinned no workflow");
    const changed = { ...h.env, workflows: {} };
    const gathered = await gatherFacts(changed, h.tickIds[0] as string);
    if (!gathered.ok) throw new Error(gathered.failure.message);
    expect(Object.keys(gathered.value.workflows.byHash)).toEqual([pinned.hash]);
  });
});

describe("agent run facts", () => {
  test("a run whose session has sent no event is probed for its process, so a live one is told from a dead launch", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const handle = (await record(h, "lt-1")).state?.run?.session;
    h.launcher.aliveAnswer = true;
    const live = await gatherFacts(h.env, h.tickIds[0] as string, { readOnly: true });
    expect(live.ok && live.value.facts.stories[0]?.units[0]?.run_alive).toBe(true);
    expect(h.launcher.probed.at(-1)).toBe(handle as string);
    // a runner that cannot tell leaves it unsaid, never dead
    h.launcher.aliveAnswer = null;
    const unknown = await gatherFacts(h.env, h.tickIds[0] as string, { readOnly: true });
    expect(unknown.ok && unknown.value.facts.stories[0]?.units[0]).not.toHaveProperty("run_alive");
    // a session with events needs no probe: its events say how it is
    const probes = h.launcher.probed.length;
    h.sessions.byUnit.set("lt-1", { activity: "working", silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] });
    h.launcher.aliveAnswer = true;
    const seen = await gatherFacts(h.env, h.tickIds[0] as string, { readOnly: true });
    expect(seen.ok && seen.value.facts.stories[0]?.units[0]).not.toHaveProperty("run_alive");
    expect(h.launcher.probed).toHaveLength(probes);
  });
  test("a live run that has sent no event is read for a dialog in its pane; a dead one, or one with events, is not", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const unitOf = async () => {
      const g = await gatherFacts(h.env, h.tickIds[0] as string, { readOnly: true });
      return g.ok ? g.value.facts.stories[0]?.units[0] : undefined;
    };
    h.launcher.dialogAnswer = " Do you trust the files in this folder?\n\n ❯ No, exit\n   Yes, I trust this folder\n";
    h.launcher.aliveAnswer = true;
    expect((await unitOf())?.run_dialog).toBe("Do you trust the files in this folder? | ❯ No, exit | Yes, I trust this folder");
    h.launcher.aliveAnswer = false;
    const read = h.launcher.dialogsRead.length;
    expect(await unitOf()).not.toHaveProperty("run_dialog");
    expect(h.launcher.dialogsRead).toHaveLength(read);
    h.launcher.aliveAnswer = true;
    h.launcher.dialogAnswer = null;
    expect(await unitOf()).not.toHaveProperty("run_dialog");
  });
});

describe("a local gathering", () => {
  test("reads the stories from this machine's record alone: no fetch, no tracker or forge call, no intake", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    h.items.push(trackerItem(2));
    const remote: string[] = [];
    const { tracker, forge, vcs } = h.env.slots;
    const spied = {
      ...h.env,
      slots: {
        ...h.env.slots,
        tracker: { ...tracker, get: (id: number) => (remote.push("tracker.get"), tracker.get(id)), intake: (q: Parameters<typeof tracker.intake>[0]) => (remote.push("tracker.intake"), tracker.intake(q)) },
        forge: { ...forge, findChanges: (b: string[]) => (remote.push("forge.findChanges"), forge.findChanges(b)) },
        vcs: { ...vcs, capabilities: { ...vcs.capabilities, push: true }, fetch: () => (remote.push("vcs.fetch"), vcs.fetch()) },
      },
    };
    const local = await gatherFacts(spied, h.tickIds[0] as string, { readOnly: true, local: true });
    if (!local.ok) throw new Error(local.failure.message);
    expect(remote).toEqual([]);
    expect(local.value.facts.stories.map((s) => [s.key, s.item, s.change])).toEqual([["lt-1", null, null]]);
    expect(local.value.facts.intake).toEqual([]);
    await gatherFacts(spied, h.tickIds[0] as string, { readOnly: true });
    expect(remote).toEqual(["forge.findChanges", "vcs.fetch", "tracker.get", "tracker.intake"]);
  });
});

describe("vcs facts", () => {
  test("unpushed: the story branch moved past its open change's head", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    h.heads["norn/lt-1"] = "b2";
    h.changes["norn/lt-1"] = { id: 4, state: "open", draft: true, head_branch: "norn/lt-1", base_branch: "main", head_sha: "b2", title: "Story 1" };
    const same = await gatherFacts(h.env, h.tickIds[0] as string);
    expect(same.ok && same.value.facts.stories[0]?.unpushed).toBe(false);
    h.heads["norn/lt-1"] = "c3";
    const moved = await gatherFacts(h.env, h.tickIds[0] as string);
    // the fake vcs reads only a commit as its own ancestor, so a moved head no longer contains the change's
    expect(moved.ok && moved.value.facts.stories[0]?.unpushed).toBe(false);
    h.env.slots.vcs.isAncestor = async () => ({ ok: true, value: true });
    const ahead = await gatherFacts(h.env, h.tickIds[0] as string);
    expect(ahead.ok && ahead.value.facts.stories[0]?.unpushed).toBe(true);
  });

  test("unpushed counts no commit that touches only the story's spec folder, when the vcs can name the paths", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    h.heads["norn/lt-1"] = "c3";
    h.changes["norn/lt-1"] = { id: 4, state: "open", draft: true, head_branch: "norn/lt-1", base_branch: "main", head_sha: "b2", title: "Story 1" };
    h.env.slots.vcs.isAncestor = async () => ({ ok: true, value: true });
    const asked: string[][] = [];
    let paths = [".agents/specs/lt-1/notes.md", ".agents/specs/lt-1/pr.md"];
    h.env.slots.vcs.changedPaths = async (a, b) => {
      asked.push([a, b]);
      return { ok: true, value: paths };
    };
    const specOnly = await gatherFacts(h.env, h.tickIds[0] as string);
    expect(specOnly.ok && specOnly.value.facts.stories[0]?.unpushed).toBe(false);
    expect(asked).toEqual([["b2", "c3"]]);
    // another story's spec folder is code to this one
    paths = [".agents/specs/lt-1/notes.md", ".agents/specs/lt-10/spec.md"];
    const other = await gatherFacts(h.env, h.tickIds[0] as string);
    expect(other.ok && other.value.facts.stories[0]?.unpushed).toBe(true);
  });

  test("base_stale under stale: conflict: a clean base move is not stale, a conflicting one is, and a clean one that fails base.verify is", async () => {
    const h = harness({ workflow: "based" });
    const verified: string[] = [];
    let verdict: { outcome: string; detail?: Record<string, unknown> } = { outcome: "verified" };
    const verifier = defineNornPlugin({
      name: "verifier",
      api: "^1.4",
      provides: {
        stepKinds: {
          "verify-base": {
            name: "verify-base",
            configSchema: Type.Object({ command: Type.String(), timeout_ms: Type.Optional(Type.Integer()) }),
            outcomes: ["verified", "broken"],
            mode: "wait",
            run: async (input) => {
              verified.push(`${input.unit} ${(input.config as { command: string }).command}`);
              return ok(verdict);
            },
          },
        },
      },
    });
    const built = createRuntimeEnv({ ctx: h.ctx, plugins: [...h.plugins, verifier], config: h.config, launcher: h.launcher, sessions: h.sessions });
    if (!built.ok) throw new Error(built.failure.message);
    const env = built.value;
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.park"));
    const stale = async () => {
      const r = await gatherFacts(env, h.tickIds[0] as string);
      return r.ok ? r.value.facts.stories[0]?.base_stale : "failed";
    };
    h.heads["norn/lt-1"] = "s1";
    h.heads.main = "s1";
    expect(await stale()).toBe(false);
    // the base moved: the fake vcs reads only a commit as its own ancestor
    h.heads.main = "b2";
    let conflicts: string[] = [];
    env.slots.vcs.conflicts = async () => ok(conflicts);
    expect(await stale()).toBe(false);
    expect(verified).toEqual(["lt-1 bun test"]);
    conflicts = ["shared.txt"];
    expect(await stale()).toBe(true);
    conflicts = [];
    verdict = { outcome: "broken" };
    expect(await stale()).toBe(true);
    // the pair tested once answers waiting, its outcome kept as `tested`
    verdict = { outcome: "waiting", detail: { tested: "broken" } };
    expect(await stale()).toBe(true);
    verdict = { outcome: "waiting", detail: { tested: "verified" } };
    expect(await stale()).toBe(false);
    // a vcs that cannot try a merge leaves the fact out rather than guess
    delete env.slots.vcs.conflicts;
    expect(await stale()).toBeUndefined();
  });

  test("base.verify runs the command the config's checks name for the verify step, and a name it lacks leaves base_stale unsaid", async () => {
    const run = async (workflow: string) => {
      const h = harness({ workflow, checks: { test: "npm test" } });
      const verified: string[] = [];
      const verifier = defineNornPlugin({
        name: "verifier",
        api: "^1.4",
        provides: {
          stepKinds: {
            "verify-base": {
              name: "verify-base",
              configSchema: Type.Object({ command: Type.String(), timeout_ms: Type.Optional(Type.Integer()) }),
              outcomes: ["verified", "broken"],
              mode: "wait",
              run: async (input) => {
                verified.push((input.config as { command: string }).command);
                return ok({ outcome: "verified" });
              },
            },
          },
        },
      });
      const built = createRuntimeEnv({ ctx: h.ctx, plugins: [...h.plugins, verifier], config: h.config, launcher: h.launcher, sessions: h.sessions });
      if (!built.ok) throw new Error(built.failure.message);
      h.items.push(trackerItem(1));
      await tickUntil(h, has("gate.park"));
      h.heads["norn/lt-1"] = "s1";
      h.heads.main = "b2";
      built.value.slots.vcs.conflicts = async () => ok([]);
      const r = await gatherFacts(built.value, h.tickIds[0] as string);
      if (!r.ok) throw new Error(r.failure.message);
      return { verified, stale: r.value.facts.stories[0]?.base_stale, problems: r.value.problems };
    };
    const named = await run("based");
    expect(named.verified).toEqual(["npm test"]);
    expect(named.stale).toBe(false);
    const missing = await run("misbased");
    expect(missing.verified).toEqual([]);
    expect(missing.stale).toBeUndefined();
    expect(missing.problems.some((p) => p.includes("base.verify test") && p.includes("checks.nope") && p.includes("the base move is not verified"))).toBe(true);
  });

  test("a story with no branch yet, or one that ended, has no vcs facts", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const r = await gatherFacts(h.env, h.tickIds[0] as string);
    const story = r.ok ? r.value.facts.stories[0] : undefined;
    expect([story?.base_stale, story?.unpushed]).toEqual([undefined, undefined]);
  });
});
