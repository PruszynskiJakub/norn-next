/**
 * The schema of `SessionFacts`, the session reducer's output, so a unit's session can travel inside
 * validated facts. Pinned to the reducer's interface: the type check fails if either drifts.
 */
import { LimitKind, ReportVerb } from "@norn/plugin-api";
import { IsoTime, NonNegInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import type { SessionFacts } from "../session/view.ts";
import type { Same } from "./same.ts";

const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 1 });

export const SessionActivitySchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("working"),
  Type.Literal("awaiting_tools"),
  Type.Literal("awaiting_subagents"),
  Type.Literal("asking"),
  Type.Literal("permission"),
  Type.Literal("limited"),
  Type.Literal("turn_ended"),
  Type.Literal("reported"),
  Type.Literal("ended"),
]);

export const SessionFactsSchema = Type.Object(
  {
    activity: SessionActivitySchema,
    silent: Type.Boolean(),
    ask: Type.Optional(Type.Object({ id: Id, question: Type.String(), options: Type.Optional(Type.Array(Type.String())) }, closed)),
    permission: Type.Optional(Type.Object({ id: Id, prompt: Type.String(), call: Type.Optional(Type.Object({ id: Id, tool: Type.String() }, closed)) }, closed)),
    limit: Type.Optional(Type.Object({ kind: LimitKind, resets_at: Type.Optional(IsoTime) }, closed)),
    report: Type.Optional(Type.Object({ verb: ReportVerb, outcome: Type.Optional(Type.String()) }, closed)),
    last_message: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    last_event_at: Type.Optional(IsoTime),
    pending_tools: NonNegInt,
    subagents: NonNegInt,
    pane_answers: NonNegInt,
    errors: Type.Array(Type.String()),
  },
  { ...closed, title: "SessionFacts" },
);

export const SESSION_SCHEMA_MATCHES: Same<Static<typeof SessionFactsSchema>, SessionFacts> = true;
