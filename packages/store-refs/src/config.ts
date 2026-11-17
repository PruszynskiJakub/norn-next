import type { StoreCapabilities } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";

export const RefsStoreConfig = Type.Object(
  {
    /** the remote every machine pushes claims, mailboxes and run data to; never `-`-led, so git cannot read it as an option */
    remote: Type.Optional(Type.String({ minLength: 1, pattern: "^[^-\\s][^\\s]*$" })),
  },
  { additionalProperties: false, title: "RefsStoreConfig" },
);
export type RefsStoreConfig = Static<typeof RefsStoreConfig>;

export const DEFAULT_REMOTE = "origin";

/** A namespace of its own, so the old store's `refs/norn/*` refs are never read or moved. */
export const REFS_NAMESPACE = "refs/norn/v2";

export const REFS_STORE_CAPABILITIES: Readonly<StoreCapabilities> = Object.freeze({ shared: true, claims: "distributed", mailbox: true, artifacts: true });
