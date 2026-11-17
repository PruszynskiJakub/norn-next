import { defineNornPlugin, hostProcesses, type RunnerFactory } from "@norn/plugin-api";
import { HeadlessConfig } from "./config.ts";
import { createHeadlessRunner } from "./runner.ts";

export const headlessRunnerFactory: RunnerFactory<typeof HeadlessConfig> = {
  configSchema: HeadlessConfig,
  needsProcesses: true,
  create: (ctx, config) => {
    const procs = hostProcesses(ctx);
    // createRunner refuses such a host first; this guards a caller that calls create directly
    if (!procs.ok) throw new Error(`the headless runner needs ${procs.missing.join(", ")} from the host`);
    return createHeadlessRunner(ctx, procs.value, config);
  },
};

export const headlessRunnerPlugin = defineNornPlugin({ name: "norn-runner-headless", api: "^1.5", provides: { runners: { headless: headlessRunnerFactory } } });
