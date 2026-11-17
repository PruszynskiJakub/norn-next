import { defineNornPlugin, type ForgeFactory, type HostContext } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { noneForge } from "./forge.ts";

export { noneForge } from "./forge.ts";
export { ChangeRecord, changesDir, recordPath } from "./record.ts";

export const PLUGIN_NAME = "norn-forge-none";

export const NoneForgeConfig = Type.Object({}, { additionalProperties: false });

export const noneForgeFactory: ForgeFactory<typeof NoneForgeConfig> = Object.freeze({
  configSchema: NoneForgeConfig,
  create: (ctx: HostContext) => noneForge(ctx),
});

export const forgeNonePlugin = defineNornPlugin({ name: PLUGIN_NAME, api: "^1.1", provides: { forge: { none: noneForgeFactory } } });
