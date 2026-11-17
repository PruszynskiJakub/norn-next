import { defineNornPlugin, type RunnerFactory } from "@norn/plugin-api";
import { HerdrConfig } from "./config.ts";
import { createHerdrRunner } from "./runner.ts";

export const herdrRunnerFactory: RunnerFactory<typeof HerdrConfig> = {
  configSchema: HerdrConfig,
  create: (ctx, config) => createHerdrRunner(ctx, config),
};

export const herdrRunnerPlugin = defineNornPlugin({ name: "norn-runner-herdr", api: "^1.5", provides: { runners: { herdr: herdrRunnerFactory } } });
