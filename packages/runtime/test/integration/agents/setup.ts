/**
 * One machine as both sides build it: the tick host in the test process, and the `norn` stand-in
 * (norn-bin.ts) an agent process runs for its hooks and reports. Both read the same setup file, so
 * they resolve the same plugins and config over the same data dir, and read one clock: the test's
 * manual clock, written to a file on every move, so event times and tick times agree.
 */
import { readFileSync } from "node:fs";
import { forgeNonePlugin } from "@norn/forge-none";
import { createNodeHost } from "@norn/host-node";
import { DEFAULT_KERNEL_CONFIG, type KernelConfig } from "@norn/kernel";
import { defineNornPlugin, type HostContext, type NornPlugin } from "@norn/plugin-api";
import { headlessRunnerPlugin } from "@norn/runner-headless";
import { localStorePlugin } from "@norn/store-local";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import type { RuntimeConfig } from "../../../src/index.ts";
import { type AgentPlan, SCRIPTED, scriptedHarness } from "./scripted-harness.ts";

const NORN_BIN = new URL("./norn-bin.ts", import.meta.url).pathname;

export interface MachineSetup {
  repo: string;
  dataDir: string;
  trackerDir: string;
  /** holds the manual clock's time */
  clockFile: string;
  workflow: string;
  kernel?: Partial<KernelConfig>;
}

/** The `norn` an agent runs: the stand-in bin with this machine's setup file. */
export function nornCommand(setupPath: string): string[] {
  return ["bun", NORN_BIN, setupPath];
}

/**
 * The workflows these tests run, each short enough to read whole:
 * - e2e: an agent step and a check that takes a moment, then a gate;
 * - e2e-hang: the same, with a check that outlives its timeout.
 */
const WORKFLOWS: Record<string, string> = {
  "e2e.yaml": [
    "name: e2e",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    retries: 1",
    "    outcomes: { done: test }",
    "    means: { done: the thing is built }",
    "  test:",
    "    check: sleep 1 && sh check.sh",
    "    timeout: 1m",
    "    outcomes: { pass: ready, fail: build }",
    "  ready:",
    "    gate: Approve the thing.",
    "    outcomes: { approve: $done, reject: build }",
    "",
  ].join("\n"),
  "e2e-hang.yaml": [
    "name: e2e-hang",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    outcomes: { done: test }",
    "  test:",
    "    check: sleep 600",
    "    timeout: 1m",
    "    outcomes: { pass: ready, fail: triage }",
    "  ready:",
    "    gate: Approve the thing.",
    "    outcomes: { approve: $done, reject: $stuck }",
    "  triage:",
    "    gate: The check failed; look at it.",
    "    outcomes: { approve: $done, reject: $stuck }",
    "",
  ].join("\n"),
};

const packPlugin = defineNornPlugin({ name: "test-e2e-pack", api: "^1.5", provides: { packs: { e2e: { workflows: WORKFLOWS, shared: {}, skills: {} } } } });

/** The host both sides use: host-node over the machine's checkout, on the shared clock. */
export function hostOf(s: MachineSetup): HostContext {
  const host = createNodeHost({ root: s.repo, dataDir: s.dataDir });
  return { ...host, now: () => readFileSync(s.clockFile, "utf8").trim() };
}

export function configOf(s: MachineSetup): RuntimeConfig {
  return {
    tracker: { name: "local", config: { user: "me", dir: s.trackerDir } },
    forge: { name: "none" },
    store: { name: "local" },
    vcs: { name: "git" },
    // a short kill grace: a stopped check or agent goes within the test's patience
    executors: { claude: { name: SCRIPTED, runner: { name: "headless", config: { kill_grace_ms: 500 } } } },
    pack: "e2e",
    kernel: { ...DEFAULT_KERNEL_CONFIG, mode: "auto", workflow: s.workflow, ...s.kernel },
    intake: { label: "norn", assignee: "me" },
    base: "main",
    baseRef: "origin/main",
    holder: "a",
  };
}

/** The plugins both sides resolve; `next` picks each launch's plan, which only the tick side calls. */
export function pluginsOf(setupPath: string, next: (runId: string) => AgentPlan): { plugins: NornPlugin[]; harness: ReturnType<typeof scriptedHarness> } {
  const harness = scriptedHarness({ norn: nornCommand(setupPath), next });
  return { plugins: [localTrackerPlugin, forgeNonePlugin, vcsGitPlugin, localStorePlugin, headlessRunnerPlugin, packPlugin, harness.plugin], harness };
}
