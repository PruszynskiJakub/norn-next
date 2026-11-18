import { PosInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const HeadlessConfig = Type.Object(
  {
    /** between TERM to the process group and KILL, in ms */
    kill_grace_ms: Type.Optional(PosInt),
  },
  { additionalProperties: false, title: "HeadlessRunnerConfig" },
);
export type HeadlessConfig = Static<typeof HeadlessConfig>;

export const DEFAULT_KILL_GRACE_MS = 3_000;
