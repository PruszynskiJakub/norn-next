import { NonEmpty, PosInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const HerdrConfig = Type.Object(
  {
    /** the herdr binary */
    bin: Type.Optional(NonEmpty),
    /** a named herdr session (`--session <name>`); absent: the person's default session */
    session: Type.Optional(NonEmpty),
    /** how long a start waits for the agent to take the pane's foreground, in ms */
    start_wait_ms: Type.Optional(PosInt),
  },
  { additionalProperties: false, title: "HerdrRunnerConfig" },
);
export type HerdrConfig = Static<typeof HerdrConfig>;

export const DEFAULT_HERDR_BIN = "herdr";
export const DEFAULT_START_WAIT_MS = 10_000;
