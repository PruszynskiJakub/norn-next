/**
 * What each configured plugin can do, as decide reads it. Decide branches on these and never on a
 * plugin's or provider's name, so a new tracker or harness with the same capabilities gets the same
 * decisions.
 */
import type { ForgeCapabilities, HarnessCapabilities, StoreCapabilities, TrackerCapabilities } from "@norn/plugin-api";
import type { Attendance } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import type { Same } from "./same.ts";

const closed = { additionalProperties: false } as const;

export const TrackerCapabilitiesSchema = Type.Object(
  { assign: Type.Boolean(), labels: Type.Boolean(), comment: Type.Boolean(), create: Type.Boolean(), close: Type.Boolean() },
  closed,
);
export const ForgeCapabilitiesSchema = Type.Object({ draft: Type.Boolean(), checks: Type.Boolean(), raw_urls: Type.Boolean() }, closed);
export const StoreCapabilitiesSchema = Type.Object(
  {
    shared: Type.Boolean(),
    claims: Type.Union([Type.Literal("local"), Type.Literal("distributed")]),
    mailbox: Type.Boolean(),
    artifacts: Type.Boolean(),
    takeover: Type.Optional(Type.Boolean()),
  },
  closed,
);
export const HarnessCapabilitiesSchema = Type.Object(
  {
    blockStop: Type.Boolean(),
    denyTool: Type.Boolean(),
    injectContext: Type.Boolean(),
    subagents: Type.Boolean(),
    limits: Type.Boolean(),
    paneInput: Type.Boolean(),
    promptMarks: Type.Optional(Type.Boolean()),
    resume: Type.Optional(Type.Boolean()),
  },
  closed,
);

/**
 * One executor a step can run an agent on: a harness and how the host can run it. `headless` runs
 * with nobody watching (auto mode needs it); `attended` opens where a person works beside it.
 */
export const ExecutorCapabilities = Type.Object(
  {
    ...HarnessCapabilitiesSchema.properties,
    headless: Type.Boolean(),
    attended: Type.Boolean(),
    /** a dialog in the agent's pane can be answered with keys from outside it; absent: it cannot */
    dialogKeys: Type.Optional(Type.Boolean()),
  },
  { ...closed, title: "ExecutorCapabilities" },
);
export type ExecutorCapabilities = Static<typeof ExecutorCapabilities>;

/**
 * The name an executor runs under in the runner an attendance picks (`deep@person`), when the config
 * gives it no runner of its own: one entry of `executors` per runner, so a run's record and handle name
 * both the executor and its runner, and decide reads a runner's presence as it reads any capability.
 */
export function launchTarget(executor: string, attendance: Attendance): string {
  return `${executor}@${attendance}`;
}

/** `tracker` and `forge` are null when none is configured; a store always is. */
export const KernelCapabilities = Type.Object(
  {
    tracker: Type.Union([TrackerCapabilitiesSchema, Type.Null()]),
    forge: Type.Union([ForgeCapabilitiesSchema, Type.Null()]),
    store: StoreCapabilitiesSchema,
    executors: Type.Record(Type.String({ minLength: 1 }), ExecutorCapabilities),
  },
  { ...closed, title: "KernelCapabilities" },
);
export type KernelCapabilities = Static<typeof KernelCapabilities>;

// The schemas restate plugin-api's interfaces so facts can be validated; these fail the type check if either drifts
export const CAPABILITY_SCHEMAS_MATCH: [
  Same<Static<typeof TrackerCapabilitiesSchema>, TrackerCapabilities>,
  Same<Static<typeof ForgeCapabilitiesSchema>, ForgeCapabilities>,
  Same<Static<typeof StoreCapabilitiesSchema>, StoreCapabilities>,
  Same<Static<typeof HarnessCapabilitiesSchema>, HarnessCapabilities>,
] = [true, true, true, true];
