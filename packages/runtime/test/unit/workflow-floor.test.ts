/**
 * The floor every workflow file is checked against as the runtime loads it, under the person's
 * policy: a gate the policy grants to a stand-in is no person's step before a forge write.
 */
import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { forgeNonePlugin } from "@norn/forge-none";
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import { defineNornPlugin, type NornPlugin } from "@norn/plugin-api";
import { localStorePlugin } from "@norn/store-local";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { createRuntimeEnv, loadPinned, type RepoWorkflows, type RuntimeConfig, stepsForgePlugin } from "../../src/index.ts";

const SHIP = [
  "name: ship",
  "start: build",
  "steps:",
  "  build: { by: builder, do: Build it., outcomes: { done: ready } }",
  "  ready: { by: person, do: Approve to merge., outcomes: { approve: merge, reject: { to: build, max: 2 } } }",
  "  merge: { by: forge.await-merge, outcomes: { merged: $done, unpushed: build } }",
  "",
].join("\n");
const NO_GATE = "name: ship\nstart: build\nsteps:\n  build: { by: builder, do: Build it., outcomes: { done: merge } }\n  merge: { by: forge.await-merge, outcomes: { merged: $done, unpushed: build } }\n";

const pack = defineNornPlugin({ name: "norn-pack-tiny", api: "^1.4", provides: { packs: { tiny: { workflows: { "ship.yaml": SHIP }, shared: {}, skills: {} } } } });
const PLUGINS: NornPlugin[] = [localTrackerPlugin, forgeNonePlugin, localStorePlugin, vcsGitPlugin, stepsForgePlugin, pack];

const config = (gates: string[] = []): RuntimeConfig => ({
  tracker: { name: "local", config: { user: "me" } },
  forge: { name: "none" },
  store: { name: "local" },
  vcs: { name: "git" },
  executors: {},
  pack: "tiny",
  kernel: DEFAULT_KERNEL_CONFIG,
  intake: { label: "norn", assignee: "me" },
  base: "main",
  holder: "machine-a",
  standIn: { gates, attended: [] },
});

function envWith(c: RuntimeConfig, repoWorkflows?: RepoWorkflows) {
  const r = createRuntimeEnv({ ctx: memoryHost(), plugins: PLUGINS, config: c, launcher: {} as never, sessions: { facts: () => null }, ...(repoWorkflows && { repoWorkflows }) });
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}
const errorsOf = (env: ReturnType<typeof envWith>) => {
  const load = env.workflows.ship;
  return load?.ok ? [] : (load?.errors ?? []).map((e) => e.path);
};

describe("the floor under the person's policy", () => {
  test("a workflow with a person before its forge write loads; granting that gate to a stand-in refuses it, and a grant in another workflow does not", () => {
    expect(errorsOf(envWith(config()))).toEqual([]);
    expect(errorsOf(envWith(config(["ship.ready"])))).toEqual(["/steps/merge"]);
    expect(errorsOf(envWith(config(["story.ready"])))).toEqual([]);
  });

  test("a repo file that drops the gate is refused as the pack's would be", () => {
    expect(errorsOf(envWith(config(), { workflows: { "ship.yaml": NO_GATE }, shared: {} }))).toEqual(["/steps/merge"]);
  });

  test("a round's pinned revision still loads once its gate is granted, so the grant never takes its workflow away mid-round", () => {
    const before = envWith(config()).workflows.ship;
    if (!before?.ok) throw new Error("ship does not load");
    expect(loadPinned(envWith(config(["ship.ready"])), before.workflow.pinned)?.pinned.hash).toBe(before.workflow.pinned.hash);
  });
});
