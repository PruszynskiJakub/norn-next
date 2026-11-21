import { describe, expect, test } from "bun:test";
import { type ChangeRequest, fail, type Forge, type HostContext, ok, PLUGIN_API_VERSION, type Vcs } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { outcomeReceiptId } from "@norn/kernel";
import { configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, envOf, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const BRANCH = `norn/${UNIT}`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
const refusal = (r: { exit: number; stdout: string }) => ({ exit: r.exit, code: json(r.stdout).code });

/**
 * A repo as the fake vcs and forge see it: each ref's head, the commits each ref holds, the commits
 * whose merge conflicts (and on which paths), and the story's change.
 */
interface World {
  heads: Record<string, string>;
  holds: Record<string, Set<string>>;
  conflicts: Record<string, string[]>;
  /** whether the vcs offers the trial merge; without it the update relies on the merge's abort */
  trial: boolean;
  change: Omit<ChangeRequest, "head_sha"> | null;
  /** the change's head as the forge reports it: the remote branch, once pushed */
  remote: string;
  /** commits the clone lacks: no head, and git fails on asking whether a ref holds them */
  missing?: string[];
  calls: string[];
}

function world(over: Partial<World> = {}): World {
  return {
    heads: { [BRANCH]: "s1", main: "b2" },
    holds: { [BRANCH]: new Set(["b1", "s1"]), main: new Set(["b1", "b2"]) },
    conflicts: {},
    trial: true,
    change: { id: 7, state: "open", draft: false, head_branch: BRANCH, base_branch: "main", title: "Login" },
    remote: "s1",
    calls: [],
    ...over,
  };
}

function fakeVcs(ctx: HostContext, w: World): Vcs {
  const path = (unit: string) => `${ctx.repo.dataDir}/worktrees/${unit.replace("/", "-")}`;
  const has = (commit: string, ref: string) => w.heads[ref] === commit || (w.holds[ref]?.has(commit) ?? false);
  const vcs: Vcs = {
    name: "fake",
    capabilities: { worktrees: true, merge: true, push: true },
    worktree: {
      ensure: async (unit, branch, base) => {
        w.calls.push(`ensure ${unit} ${branch} ${base}`);
        await ctx.files.write(`${path(unit)}/.git`, "gitdir");
        return ok({ path: path(unit) });
      },
      remove: async (unit) => {
        w.calls.push(`remove ${unit}`);
        await ctx.files.remove(`${path(unit)}/.git`);
        return ok(undefined);
      },
      path,
    },
    head: async (ref) => (w.missing?.includes(ref) ? ok(null) : ok(w.heads[ref] ?? ([...Object.values(w.holds)].some((s) => s.has(ref)) || w.remote === ref ? ref : null))),
    isAncestor: async (a, b) => (w.missing?.includes(a) ? fail("unknown", `git merge-base: ${a} is no commit (exit 128)`) : ok(has(a, b))),
    mergeBase: async () => ok(null),
    merge: async (branch, from, opts) => {
      w.calls.push(`merge ${branch} ${from}${opts?.abortOnConflict ? " abort-on-conflict" : ""}`);
      const files = w.conflicts[from];
      if (files) return ok({ conflict: { files } });
      const head = `${w.heads[branch]}+${from}`;
      w.holds[branch]?.add(w.heads[branch] as string).add(from);
      w.heads[branch] = head;
      return ok({ head });
    },
    push: async (branch) => {
      w.calls.push(`push ${branch}`);
      w.remote = w.heads[branch] as string;
      return ok(undefined);
    },
    fetch: async () => {
      w.calls.push("fetch");
      return ok(undefined);
    },
  };
  if (w.trial) vcs.conflicts = async (_into, from) => ok(w.conflicts[from] ?? []);
  return vcs;
}

function fakeForge(w: World): Forge {
  return {
    name: "fake",
    capabilities: { draft: true, checks: false, raw_urls: false },
    findChanges: async (branches) => ok(Object.fromEntries(branches.map((b) => [b, b === BRANCH && w.change ? { ...w.change, head_sha: w.remote } : null]))),
    checks: async () => ok("none"),
    perform: async () => {
      throw new Error("the update performs no forge effect");
    },
  };
}

const PLUGIN = "norn-plugin-fake";
const PATHS = configPaths(HOME, ROOT);
const LOCK = `${machineDir(HOME, machineId(COMMON))}/plugins.lock`;

/** The local config with the vcs and the forge from one fake plugin that reads and moves `w`. */
function configured(w: World): TestMachine {
  const plugin = {
    plugin: {
      name: "fake",
      api: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
      provides: {
        vcs: { fake: { configSchema: Type.Object({}), create: (ctx: HostContext) => fakeVcs(ctx, w) } },
        forge: { fake: { configSchema: Type.Object({}), create: () => fakeForge(w) } },
      },
    },
  };
  const importer: PluginImporter = async (name) => {
    if (name !== PLUGIN) throw new Error(`Cannot find package '${name}'`);
    return plugin as unknown as Record<string, unknown>;
  };
  const lock = JSON.stringify({ format: 1, plugins: [{ name: PLUGIN, spec: `${PLUGIN}@^1`, version: "1.0.0", api: "^1.8" }] });
  const config = `${LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box").replace("forge: { use: none }", "forge: { use: fake }")}vcs: { use: fake }\nplugins:\n  ${PLUGIN}: ${PLUGIN}@^1\n`;
  return machine({ seed: { [PATHS.local]: config, [LOCK]: lock }, importer });
}

const ended = { step: AGENT_STEP, run: null, extra: { ended: "done" as const } };
const updateBranch = (m: TestMachine, ...args: string[]) => runCli(["story", "update-branch", UNIT, ...args, "--json"], m.io);

async function holderOf(m: TestMachine): Promise<string | null> {
  const c = await (await envOf(m)).slots.store.claims.read(UNIT);
  if (!c.ok) throw new Error(c.failure.message);
  return c.value?.holder ?? null;
}

const worktreeOf = (m: TestMachine): string | undefined => Object.keys(m.files.snapshot()).find((p) => p.endsWith(`/worktrees/${UNIT}/.git`));

describe("story update-branch", () => {
  test("merges the base into a finished story's branch, pushes it, records branch.updated and gives the claim up", async () => {
    const w = world();
    const m = configured(w);
    await seedUnit(m, ended);
    const r = await updateBranch(m, "--reason", "the base moved");
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ story: UNIT, branch: BRANCH, updated: true, base: "main", base_sha: "b2", merged: true, from: "s1", head: "s1+b2", pushed: true, claim_taken: true, replayed: false, problems: [] });
    expect(w.calls).toEqual([`ensure ${UNIT} ${BRANCH} main`, "fetch", `merge ${BRANCH} b2 abort-on-conflict`, `push ${BRANCH}`]);
    expect(w.remote).toBe("s1+b2");
    // the intent goes on the record before the merge, the outcome after the push, under the act protocol's ids
    const receipts = await receiptsOf(m);
    expect(receipts.map((x) => x.data)).toEqual([
      { kind: "branch.update", base: "main", base_sha: "b2", from: "s1", merge: true, by: "me@box", reason: "the base moved" },
      { kind: "branch.updated", base: "main", base_sha: "b2", merged: true, from: "s1", head: "s1+b2", pushed: true, by: "me@box", reason: "the base moved" },
    ]);
    expect(receipts[1]?.id).toBe(outcomeReceiptId(receipts[0]?.id as string));
    expect(json(r.stdout)).toMatchObject({ receipt_id: receipts[1]?.id, resumed: false });
    expect(await holderOf(m)).toBeNull();
    // the worktree stays for the tick that applies the record, whose finish removes it again
    expect(worktreeOf(m)).toBeDefined();
    const view = json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout);
    expect(view.branch_updates).toEqual([{ at: expect.any(String), base: "main", base_sha: "b2", merged: true, head: "s1+b2", pushed: true, by: "me@box", reason: "the base moved" }]);
    expect((await runCli(["story", "view", UNIT], m.io)).stdout).toContain("## Branch updated");
  });

  test("a branch that holds its base and is at its change's head is left alone, nothing recorded", async () => {
    const w = world({ heads: { [BRANCH]: "s1", main: "b1" } });
    const m = configured(w);
    await seedUnit(m, ended);
    const r = await updateBranch(m);
    expect(json(r.stdout)).toMatchObject({ updated: false, head: "s1" });
    expect(w.calls.filter((c) => c.startsWith("merge") || c.startsWith("push"))).toEqual([]);
    expect(await receiptsOf(m)).toEqual([]);
    expect(await holderOf(m)).toBeNull();
  });

  test("commits on the change the branch lacks are taken in before the base, so the push goes through", async () => {
    const w = world({ remote: "p1" });
    const m = configured(w);
    await seedUnit(m, ended);
    const r = await updateBranch(m);
    expect(json(r.stdout)).toMatchObject({ updated: true, took: "p1", from: "s1", head: "s1+p1+b2" });
    expect(w.calls.filter((c) => c.startsWith("merge"))).toEqual([`merge ${BRANCH} p1 abort-on-conflict`, `merge ${BRANCH} b2 abort-on-conflict`]);
  });

  for (const trial of [true, false]) {
    test(`a conflict ${trial ? "found by the trial merge" : "the merge stopped on and aborted"} is refused with its paths, the branch as it was and the worktree made for it removed`, async () => {
      const w = world({ trial, conflicts: { b2: ["src/a.ts", "src/b.ts"] } });
      const m = configured(w);
      await seedUnit(m, ended);
      const r = await updateBranch(m);
      expect(r.exit).toBe(ExitCode.refused);
      const body = json(r.stdout);
      expect(body).toMatchObject({ code: "conflict", details: { files: ["src/a.ts", "src/b.ts"], base: "main", base_sha: "b2" } });
      expect(body.error).toContain("src/a.ts, src/b.ts");
      expect(body.do_instead).toBe(`norn story round ${UNIT} --workflow story --at update, whose update step resolves the conflict (the norn-merge skill)`);
      expect(w.heads[BRANCH]).toBe("s1");
      expect(w.calls.some((c) => c.startsWith("push"))).toBe(false);
      expect(w.calls.filter((c) => c.startsWith("merge"))).toEqual(trial ? [] : [`merge ${BRANCH} b2 abort-on-conflict`]);
      expect(w.calls.at(-1)).toBe(`remove ${UNIT}`);
      expect(worktreeOf(m)).toBeUndefined();
      // a trial refuses before the intent; a merge that stopped leaves the intent for the next run to finish
      expect((await receiptsOf(m)).map((x) => x.data.kind)).toEqual(trial ? [] : ["branch.update"]);
      expect(await holderOf(m)).toBeNull();
    });
  }

  test("a base conflict after the change's head was taken in says the branch moved, and the next run finishes under the same intent", async () => {
    const w = world({ trial: false, remote: "p1", conflicts: { b2: ["src/a.ts"] } });
    const m = configured(w);
    await seedUnit(m, ended);
    const r = await updateBranch(m);
    expect(r.exit).toBe(ExitCode.refused);
    const body = json(r.stdout);
    expect(body).toMatchObject({ code: "conflict", details: { files: ["src/a.ts"], moved_to: "s1+p1" } });
    expect(body.error).toContain("keeps what it took in before the base");
    expect(w.calls.some((c) => c.startsWith("push"))).toBe(false);
    const [intent] = await receiptsOf(m);
    expect(intent?.data).toMatchObject({ kind: "branch.update", from: "s1", took: "p1", merge: true });
    delete w.conflicts.b2;
    const again = await updateBranch(m);
    expect(json(again.stdout)).toMatchObject({ updated: true, resumed: true, from: "s1", took: "p1", head: "s1+p1+b2", merged: true, pushed: true });
    const receipts = await receiptsOf(m);
    expect(receipts.map((x) => x.data.kind)).toEqual(["branch.update", "branch.updated"]);
    expect(receipts[1]?.id).toBe(outcomeReceiptId(intent?.id as string));
  });

  test("an update cut short after its push is recorded by the next run, never read as nothing to update", async () => {
    // the branch holds the base and the forge has seen the push, as a crash between the push and the outcome leaves it
    const w = world({ heads: { [BRANCH]: "s1+b2", main: "b2" }, holds: { [BRANCH]: new Set(["b1", "s1", "b2"]), main: new Set(["b1", "b2"]) }, remote: "s1+b2" });
    const m = configured(w);
    await seedUnit(m, ended);
    const env = await envOf(m);
    const wrote = await env.journal.record(UNIT, { id: "01JDDDDDDDDDDDDDDDDDDDDDDD", data: { kind: "branch.update", base: "main", base_sha: "b2", from: "s1", merge: true, by: "me@box" } });
    if (!wrote.ok) throw new Error(wrote.failure.message);
    const r = await updateBranch(m);
    expect(json(r.stdout)).toMatchObject({ updated: true, resumed: true, merged: true, from: "s1", head: "s1+b2", pushed: true });
    expect(w.calls.filter((c) => c.startsWith("merge"))).toEqual([]);
    expect((await receiptsOf(m)).at(-1)).toMatchObject({ id: outcomeReceiptId("01JDDDDDDDDDDDDDDDDDDDDDDD"), data: { kind: "branch.updated", merged: true, from: "s1" } });
  });

  test("a change's head the clone lacks is not taken in, and asks git nothing about it", async () => {
    const w = world({ remote: "p9", missing: ["p9"] });
    const m = configured(w);
    await seedUnit(m, ended);
    const r = await updateBranch(m);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ updated: true, merged: true, head: "s1+b2" });
    expect(json(r.stdout).took).toBeUndefined();
  });

  test("a round under way, receipts waiting, a story not started, a slice and a step agent are refused", async () => {
    const w = world();
    const going = configured(w);
    await seedUnit(going, { step: AGENT_STEP });
    const r = await updateBranch(going);
    expect(refusal(r)).toEqual({ exit: ExitCode.refused, code: "round_unfinished" });
    expect(json(r.stdout).do_instead).toContain(`norn story round ${UNIT} --workflow <name> --force`);
    const m = configured(w);
    expect(refusal(await updateBranch(m))).toEqual({ exit: ExitCode.refused, code: "unknown_story" });
    await seedUnit(m, ended);
    expect(refusal(await runCli(["story", "update-branch", `${UNIT}/01`, "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "not_a_story" });
    expect(refusal(await updateBranch(withEnv(m, runEnv())))).toEqual({ exit: ExitCode.refused, code: "person_only" });
    const env = await envOf(m);
    const pending = await env.journal.record(UNIT, { id: "01JCCCCCCCCCCCCCCCCCCCCCCC", data: { kind: "mode.changed", mode: "auto", by: "me@box" } });
    if (!pending.ok) throw new Error(pending.failure.message);
    expect(refusal(await updateBranch(m))).toEqual({ exit: ExitCode.refused, code: "pending" });
    expect(w.calls).toEqual([]);
  });

  test("a story with no change, a merged one or a closed one is refused", async () => {
    const none = world({ change: null });
    const m = configured(none);
    await seedUnit(m, ended);
    expect(refusal(await updateBranch(m))).toEqual({ exit: ExitCode.refused, code: "no_change" });
    for (const [state, code] of [
      ["merged", "change_merged"],
      ["closed", "change_closed"],
    ] as const) {
      const w = world();
      if (w.change) w.change.state = state;
      const t = configured(w);
      await seedUnit(t, ended);
      expect(refusal(await updateBranch(t))).toEqual({ exit: ExitCode.refused, code });
      expect(w.calls).toEqual([]);
    }
  });

  test("another holder's claim is refused; this machine's own is kept after the update", async () => {
    const w = world();
    const m = configured(w);
    await seedUnit(m, ended);
    const env = await envOf(m);
    const other = await env.slots.store.claims.acquire(UNIT, "someone@else", 60_000);
    if (!other.ok) throw new Error(other.failure.message);
    const r = await updateBranch(m);
    expect(json(r.stdout)).toMatchObject({ code: "claim_held", do_instead: `update it on the machine of someone@else, or norn story take ${UNIT} --force first` });
    expect(w.calls).toEqual([]);
    await env.slots.store.claims.release(UNIT, "someone@else");
    const mine = await env.slots.store.claims.acquire(UNIT, "me@box", 60_000);
    if (!mine.ok) throw new Error(mine.failure.message);
    expect(json((await updateBranch(m)).stdout)).toMatchObject({ updated: true, claim_taken: false });
    expect(await holderOf(m)).toBe("me@box");
  });

  test("a tick running in the repo holds the update off", async () => {
    const w = world();
    const m = configured(w);
    await seedUnit(m, ended);
    const env = await envOf(m);
    await env.ctx.files.write(`${env.ctx.repo.dataDir}/tick.lock`, `${JSON.stringify({ tick_id: "t1", at: env.ctx.now() })}\n`);
    const r = await updateBranch(m);
    expect(refusal(r)).toEqual({ exit: ExitCode.busy, code: "tick_running" });
    expect(w.calls).toEqual([]);
  });
});
