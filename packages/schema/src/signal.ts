/**
 * A signal: a fact about the world outside a waiting step, gathered on a tick, that moves the step
 * along the route its `on:` block gives it. The `id` names the occurrence, so a level (the base is
 * stale) and an event (a reviewer asked for changes) both fire once per thing that happened.
 */
import { type Static, Type } from "@sinclair/typebox";
import { IsoTime, NonEmpty, OUTCOME_NAME_PATTERN } from "./common.ts";

const closed = { additionalProperties: false } as const;

/** A signal's name: the key it is routed by under `on:`, and the outcome its firing records. */
export const SignalName = Type.String({ pattern: OUTCOME_NAME_PATTERN, description: "A signal name: stale, unpushed, timeout, ..." });
export type SignalName = Static<typeof SignalName>;

export const Signal = Type.Object(
  {
    type: SignalName,
    /** who reported it: `vcs`, `clock`, or the plugin's name */
    source: NonEmpty,
    /** the occurrence: two reports with the same id are the same thing happening, on every tick and machine */
    id: NonEmpty,
    /** when the source saw it happen, if it knows */
    at: Type.Optional(IsoTime),
    /** small, for the next agent step's input; decide never reads it */
    detail: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { ...closed, title: "Signal" },
);
export type Signal = Static<typeof Signal>;

/** Which signal a firing took, as its receipt records it; a round fires each (type, id) once. */
export const SignalRef = Type.Object({ type: SignalName, source: NonEmpty, id: NonEmpty }, { ...closed, title: "SignalRef" });
export type SignalRef = Static<typeof SignalRef>;
