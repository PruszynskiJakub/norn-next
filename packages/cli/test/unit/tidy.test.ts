import { describe, expect, test } from "bun:test";
import { type HostContext, ok, PLUGIN_API_VERSION, type Vcs } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, envOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const BRANCH = `norn/${UNIT}`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

/** A vcs whose refs are a map: a branch is held by a ref at the same head. Every effect is recorded. */
function fakeVcs(ctx: HostContext, heads: Record<string, string>, calls: string[]): Vcs {
  const path = (unit: string) => `${ctx.repo.dataDir}/worktrees/${unit.replace("/", "-")}`;
  return {
    name: "fake",
    capabilities: { worktrees: true, merge: false, push: false },
    worktree: {
      ensure: async (unit) => ok({ path: path(unit) }),
      remove: async (unit) => {
        calls.push(`remove ${unit}`);
        await ctx.files.remove(`${path(unit)}/.git`);
        return ok(undefined);
      },
      path,
    },
    head: async (ref) => ok(heads[ref] ?? null),
    isAncestor: async (a, b) => ok(a === b),
    mergeBase: async () => ok(null),
    merge: async () => ok({ head: "" }),
    deleteBranch: async (branch) => {
      calls.push(`deleteBranch ${branch}`);
      delete heads[branch];
      return ok(undefined);
    },
    push: async () => ok(undefined),
    fetch: async () => ok(undefined),
  };
}

const PLUGIN = "norn-plugin-fake";

function configured(heads: Record<string, string>, calls: string[]): TestMachine {
  const plugin = {
    plugin: {
      name: "fake",
      api: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
      provides: { vcs: { fake: { configSchema: Type.Object({}), create: (ctx: HostContext) => fakeVcs(ctx, heads, calls) } } },
    },
  };
  const importer: PluginImporter = async (name) => {
    if (name !== PLUGIN) throw new Error(`Cannot find package '${name}'`);
    return plugin as unknown as Record<string, unknown>;
  };
  const lock = JSON.stringify({ format: 1, plugins: [{ name: PLUGIN, spec: `${PLUGIN}@^1`, version: "1.0.0", api: "^1.8" }] });
  const config = `${LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box")}vcs: { use: fake }\nplugins:\n  ${PLUGIN}: ${PLUGIN}@^1\n`;
  return machine({ seed: { [configPaths(HOME, ROOT).local]: config, [`${machineDir(HOME, machineId(COMMON))}/plugins.lock`]: lock }, importer });
}

/** A story that ended stuck, its worktree still on disk. */
async function stuckStory(m: TestMachine): Promise<void> {
  await seedUnit(m, { step: AGENT_STEP, run: null, extra: { ended: "stuck", ended_reason: "gave up" } });
  const env = await envOf(m);
  await env.ctx.files.write(`${env.slots.vcs.worktree.path(UNIT)}/.git`, "gitdir");
}

describe("norn tidy", () => {
  test("removes an ended story's worktree and its branch, whose commits the base holds, and lists them", async () => {
    const calls: string[] = [];
    const m = configured({ [BRANCH]: "b1", main: "b1" }, calls);
    await stuckStory(m);
    const r = await runCli(["tidy", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toEqual({ dry_run: false, removed: [{ story: UNIT, unit: UNIT, worktree: true, branch: BRANCH }], kept: [], closed: [] });
    expect(calls).toEqual([`remove ${UNIT}`, `deleteBranch ${BRANCH}`]);
    expect((await runCli(["tidy"], m.io)).stdout).toBe("Nothing to tidy.\n");
  });

  test("a dry run lists the same and removes nothing; a branch with commits nowhere else is kept with the reason", async () => {
    const calls: string[] = [];
    const m = configured({ [BRANCH]: "s9", main: "b1" }, calls);
    await stuckStory(m);
    const r = await runCli(["tidy", "--dry-run"], m.io);
    expect(r.stdout).toBe(`Nothing to remove.\n\nKept:\n\n- ${UNIT}: its head s9 is on neither the base (main) nor a remote copy\n`);
    expect(calls).toEqual([]);
  });

  test("a step agent may not tidy", async () => {
    const m = withEnv(configured({}, []), runEnv());
    const r = await runCli(["tidy", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout).code).toBe("person_only");
  });
});
