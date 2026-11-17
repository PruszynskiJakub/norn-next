/**
 * Store "refs": a story's run data, claim and mailbox as git refs, for a team sharing one remote.
 * Claims and the mailbox are pushed at once with `--force-with-lease`, so the remote decides who wins; run data
 * is written locally and published by `flush`.
 */
import { defineNornPlugin, type HostContext, type StoreFactory } from "@norn/plugin-api";
import { RefsStoreConfig } from "./config.ts";
import { createRefsStore } from "./store.ts";

export { parseCatFileBatch } from "./batch.ts";
export { DEFAULT_REMOTE, REFS_NAMESPACE, REFS_STORE_CAPABILITIES, RefsStoreConfig } from "./config.ts";
export { claimRef, mailboxRef, runRef, trackingRunRef } from "./layout.ts";
export { ArchivedMarker, ClaimFile, ReleasedClaim } from "./records.ts";
export { createRefsStore } from "./store.ts";

export const PLUGIN_NAME = "norn-store-refs";

export const refsStoreFactory: StoreFactory<typeof RefsStoreConfig> = Object.freeze({
  configSchema: RefsStoreConfig,
  create: (ctx: HostContext, config: RefsStoreConfig) => createRefsStore(ctx, config),
});

export const refsStorePlugin = defineNornPlugin({ name: PLUGIN_NAME, api: "^1.2", provides: { store: { refs: refsStoreFactory } } });
