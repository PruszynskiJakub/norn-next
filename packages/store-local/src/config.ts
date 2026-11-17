import type { StoreCapabilities } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";

export const LocalStoreConfig = Type.Object({}, { additionalProperties: false, title: "LocalStoreConfig" });
export type LocalStoreConfig = Static<typeof LocalStoreConfig>;

/** The folder under the repo's machine folder; a new name, so the old store's `runs/` is never read or written. */
export const STORE_DIR = "runs-v2";

export const LOCAL_STORE_CAPABILITIES: Readonly<StoreCapabilities> = Object.freeze({ shared: false, claims: "local", mailbox: true, artifacts: true });
