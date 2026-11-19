import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { ok, PLUGIN_API_VERSION, type StoreFactory } from "@norn/plugin-api";
import { localStoreFactory } from "@norn/store-local";
import { CliContext, configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const LOCK = `${machineDir(HOME, machineId(COMMON))}/plugins.lock`;
const TIDY = `${ROOT}/.agents/workflows/tidy.yaml`;
/** one agent step nobody starts on its own: the story parks and stays held by this machine */
const TIDY_YAML = ["name: tidy", "start: work", "steps:", "  work:", "    agent: Do the work.", "    outcomes: { done: $done }", ""].join("\n");
const CONFIG = `${LOCAL_CONFIG.replace("{ label: norn }", "{ label: norn, assignee: null }").replace("store: { use: local }", "store: { use: shared }")}plugins:\n  norn-store-shared: norn-store-shared@^1\nkernel: { workflow: tidy }\n`;
const LOCK_JSON = JSON.stringify({ format: 1, plugins: [{ name: "norn-store-shared", spec: "norn-store-shared@^1", version: "1.0.0", api: "^1.5" }] });
const KEPT = "refs/norn/v2/dropped/runs/lt-1/c0ffee";
/** git agrees to everything and every tool answers, so worktrees are made and doctor reaches the store */
const agrees: ExecScript = (argv) => (argv[1] === "--version" ? { stdout: `${argv[0]} 2.45.0\n` } : argv[0] === "git" ? { stdout: "" } : undefined);

/**
 * The local store as a shared one whose run data of the stories in `split` diverged from the
 * remote's; carrying a story on from the remote's record clears it and names the ref it keeps.
 */
function divergedStore(split: Set<string>, adopted: string[]): PluginImporter {
  const factory: StoreFactory = {
    configSchema: localStoreFactory.configSchema,
    create(ctx, config) {
      const store = localStoreFactory.create(ctx, config as Parameters<typeof localStoreFactory.create>[1]);
      return Object.assign(Object.create(store), {
        capabilities: { ...store.capabilities, shared: true },
        sync: async () => ok({ fetched: 0 }),
        flush: async () => ok({ pushed: false }),
        diverged: async (story: string) => ok(split.has(story)),
        adoptRemote: async (story: string) => {
          adopted.push(story);
          const was = split.delete(story);
          return ok(was ? { dropped: "c0ffee", kept_at: KEPT } : { dropped: null });
        },
      });
    },
  };
  return async (name) => {
    if (name !== "norn-store-shared") throw new Error(`Cannot find package '${name}'`);
    const api = `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`;
    return { plugin: { name: "shared", api, provides: { store: { shared: factory } } } };
  };
}

interface Clone {
  m: TestMachine;
  split: Set<string>;
  adopted: string[];
}

/** A clone whose ticks took lt-1 in and hold it, parked at its first step. */
async function heldStory(): Promise<Clone> {
  const split = new Set<string>();
  const adopted: string[] = [];
  const m = machine({ seed: { [PATHS.local]: CONFIG, [LOCK]: LOCK_JSON, [TIDY]: TIDY_YAML }, script: agrees, importer: divergedStore(split, adopted) });
  const env = await new CliContext(m.io).runtimeEnv();
  const made = await env.slots.tracker.perform({ kind: "create", title: "First", body: "", labels: ["norn"] }, { receipt_id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
  if (!made.ok) throw new Error(made.failure.message);
  for (let i = 0; i < 4; i++) await runCli(["tick", "--json"], m.io);
  const claim = await env.slots.store.claims.read("lt-1");
  if (!claim.ok || claim.value?.holder !== "me@box") throw new Error("this machine does not hold lt-1");
  return { m, split, adopted };
}

/** Move the claim of lt-1 to another machine, as its `story take --force` would. */
async function heldByBob(m: TestMachine): Promise<void> {
  const env = await new CliContext(m.io).runtimeEnv();
  const claim = await env.slots.store.claims.read("lt-1");
  if (!claim.ok) throw new Error(claim.failure.message);
  const took = await env.slots.store.claims.takeOver?.("lt-1", "bob@elsewhere", 3_600_000, claim.value?.version ?? null);
  if (!took?.ok) throw new Error("the claim did not move");
}

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
  do_instead?: string | null;
  code?: string;
}

async function storeCheck(m: TestMachine): Promise<Check | undefined> {
  const r = await runCli(["doctor", "--json"], m.io);
  return (json(r.stdout) as { checks: Check[] }).checks.find((c) => c.name === "store");
}

describe("a story whose run data here and on the remote diverged", () => {
  test("held here: doctor fails its store check, naming the take that carries it on", async () => {
    const { m, split } = await heldStory();
    expect(await storeCheck(m)).toMatchObject({ ok: true });
    split.add("lt-1");
    expect(await storeCheck(m)).toMatchObject({ ok: false, code: "store_diverged", do_instead: "norn story take lt-1 --force", error: expect.stringContaining("lt-1") });
  });

  test("held by another machine: doctor's store check passes and names the story the next tick carries on", async () => {
    const { m, split } = await heldStory();
    split.add("lt-1");
    await heldByBob(m);
    const check = await storeCheck(m);
    expect(check).toMatchObject({ ok: true, detail: expect.stringContaining("lt-1 keep run data here the remote never had") });
  });

  test("held here: take without --force refuses with store_diverged and drops nothing", async () => {
    const { m, split, adopted } = await heldStory();
    split.add("lt-1");
    const r = await runCli(["story", "take", "lt-1", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "store_diverged", do_instead: expect.stringContaining("norn story take lt-1 --force") });
    expect(adopted).toEqual([]);
  });

  test("held here: take --force carries it on from the remote's record and names the ref the dropped part is kept at", async () => {
    const { m, split, adopted } = await heldStory();
    split.add("lt-1");
    const r = await runCli(["story", "take", "lt-1", "--force", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ story: "lt-1", taken: false, holder: "me@box", dropped: { commit: "c0ffee", kept_at: KEPT } });
    expect(adopted).toEqual(["lt-1"]);
    expect(split.has("lt-1")).toBe(false);
  });

  test("held here: status lists it under Needs you with the take that carries it on, and the holder's wording", async () => {
    const { m, split } = await heldStory();
    split.add("lt-1");
    const md = await runCli(["status"], m.io);
    const needs = md.stdout.slice(md.stdout.indexOf("## Needs you"), md.stdout.indexOf("## Stories"));
    expect(needs).toContain("- lt-1: run data unsynced: this clone's run data of lt-1 and the remote's diverged");
    expect(needs).toContain("→ norn story take lt-1 --force");
    const body = json((await runCli(["status", "--json"], m.io)).stdout) as { stories: { key: string; unsynced?: unknown }[] };
    expect(body.stories.find((s) => s.key === "lt-1")?.unsynced).toEqual({ text: expect.stringContaining("no flush can publish it"), next: "norn story take lt-1 --force", waiting: true });
  });

  test("held by another machine: status says the next tick resolves it and never asks the person to take a live claim; the tick does", async () => {
    const { m, split, adopted } = await heldStory();
    split.add("lt-1");
    await heldByBob(m);
    const md = await runCli(["status"], m.io);
    expect(md.stdout).not.toContain("- lt-1: run data unsynced");
    expect(md.stdout).not.toContain("norn story take lt-1");
    const before = json((await runCli(["status", "--json"], m.io)).stdout) as { stories: { key: string; unsynced?: unknown }[] };
    expect(before.stories.find((s) => s.key === "lt-1")?.unsynced).toEqual({ text: expect.stringContaining("from before bob@elsewhere took the claim"), next: "norn tick", waiting: false });
    expect(adopted).toEqual([]);

    const tick = json((await runCli(["tick", "--json"], m.io)).stdout) as { problems: string[] };
    expect(adopted).toEqual(["lt-1"]);
    expect(tick.problems).toContain(`lt-1: run data this clone never published was dropped for the remote's record, as bob@elsewhere holds the claim; it is kept at ${KEPT}`);
    const after = json((await runCli(["status", "--json"], m.io)).stdout) as { stories: { key: string; unsynced?: unknown }[] };
    expect(after.stories.find((s) => s.key === "lt-1")?.unsynced).toBeUndefined();
  });
});
