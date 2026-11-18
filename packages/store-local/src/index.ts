/**
 * Store "local": a unit's run data as files in the repo's machine folder, for one machine working
 * alone. Nothing is shared, and claims are decided by this machine's files.
 */
import { defineNornPlugin, type HostContext, type StoreFactory } from "@norn/plugin-api";
import { LocalStoreConfig } from "./config.ts";
import { createLocalStore } from "./store.ts";

export { LOCAL_STORE_CAPABILITIES, LocalStoreConfig, STORE_DIR } from "./config.ts";
export { decodeArtifactName, encodeArtifactName, type Layout, layout } from "./layout.ts";
export { DEFAULT_LOCK_TUNING, type LockTuning, withLock } from "./lock.ts";
export { ArchivedMarker, ClaimFile, MailboxFile } from "./records.ts";
export { createLocalStore, type LocalStoreOptions } from "./store.ts";

export const PLUGIN_NAME = "norn-store-local";

export const localStoreFactory: StoreFactory<typeof LocalStoreConfig> = Object.freeze({
  configSchema: LocalStoreConfig,
  create: (ctx: HostContext, config: LocalStoreConfig) => createLocalStore(ctx, config),
});

export const localStorePlugin = defineNornPlugin({ name: PLUGIN_NAME, api: "^1.2", provides: { store: { local: localStoreFactory } } });
