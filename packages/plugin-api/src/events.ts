/**
 * The normalized harness event: the only thing a harness plugin hands the kernel about a session.
 * Every harness translates its native hooks into these, so one reducer classifies every agent.
 */
import { check, IsoTime, NonNegInt, TaggedUnion, type ValidationResult } from "@norn/schema";
import { type Static, type TProperties, Type } from "@sinclair/typebox";

/** Fields every event carries; `seq` orders events of one run, and `at` is when the harness saw it. */
const ENVELOPE = {
  run_id: Type.String({ minLength: 1 }),
  seq: NonNegInt,
  at: IsoTime,
};

function variant<K extends string, P extends TProperties>(type: K, props: P) {
  return Type.Object({ type: Type.Literal(type), ...ENVELOPE, ...props }, { additionalProperties: false });
}

const Id = Type.String({ minLength: 1 });

export const TurnSource = Type.Union([Type.Literal("brief"), Type.Literal("nudge"), Type.Literal("answer"), Type.Literal("person")]);
export type TurnSource = Static<typeof TurnSource>;
export const ToolKind = Type.Union([Type.Literal("shell"), Type.Literal("write"), Type.Literal("ask"), Type.Literal("subagent"), Type.Literal("other")]);
export type ToolKind = Static<typeof ToolKind>;
export const InputBy = Type.Union([Type.Literal("norn"), Type.Literal("pane")]);
export type InputBy = Static<typeof InputBy>;
export const LimitKind = Type.Union([Type.Literal("usage"), Type.Literal("rate")]);
export type LimitKind = Static<typeof LimitKind>;
export const ReportVerb = Type.Union([Type.Literal("done"), Type.Literal("ask"), Type.Literal("stuck")]);
export type ReportVerb = Static<typeof ReportVerb>;
export const EndReason = Type.Union([Type.Literal("exit"), Type.Literal("killed"), Type.Literal("crash")]);
export type EndReason = Static<typeof EndReason>;

const VARIANTS = [
  variant("session.started", { harness_session: Id, transcript: Type.Optional(Type.String()) }),
  /** `prompt_id`: the id of the prompt mark the turn's prompt carried (plugin API 1.5), for the host to check against what it sent */
  variant("turn.started", { source: TurnSource, prompt_id: Type.Optional(Id) }),
  variant("tool.requested", { id: Id, kind: ToolKind, tool: Type.String(), detail: Type.Optional(Type.String()) }),
  variant("tool.permission", { id: Id, prompt: Type.String() }),
  variant("tool.finished", { id: Id, ok: Type.Boolean() }),
  variant("subagent.started", { id: Id, background: Type.Boolean() }),
  variant("subagent.finished", { id: Id }),
  variant("input.requested", { id: Id, question: Type.String(), options: Type.Optional(Type.Array(Type.String())) }),
  variant("input.received", { id: Type.Optional(Id), by: InputBy }),
  variant("limit.hit", { kind: LimitKind, resets_at: Type.Optional(IsoTime) }),
  variant("context.compacted", {}),
  variant("turn.ended", {
    last_message: Type.Optional(Type.String()),
    /**
     * Set when the turn stopped on the agent's own or its provider's error rather than the agent
     * choosing to stop (plugin API 1.6): the run that ends there unreported names it, as the agent's
     * last words may say nothing of it.
     */
    error: Type.Optional(Type.String({ minLength: 1 })),
  }),
  variant("report.made", { verb: ReportVerb, outcome: Type.Optional(Type.String()) }),
  variant("session.ended", { reason: EndReason }),
  variant("hook.error", { hook: Type.String(), message: Type.String() }),
];

export const HarnessEvent = TaggedUnion("type", VARIANTS, {
  title: "HarnessEvent",
  description: "One normalized event a harness plugin reports about an agent session",
});
export type HarnessEvent = Static<typeof HarnessEvent>;
export type HarnessEventType = HarnessEvent["type"];
/** The event of one `type`, e.g. `HarnessEventOf<"tool.requested">`. */
export type HarnessEventOf<K extends HarnessEventType> = Extract<HarnessEvent, { type: K }>;

/** Every event type, in the order the contract lists them. */
export const HARNESS_EVENT_TYPES = VARIANTS.map((v) => v.properties.type.const) as HarnessEventType[];

/** Validate one value against the event contract; errors are JSON pointers into it. */
export function validateHarnessEvent(value: unknown): ValidationResult<HarnessEvent> {
  return check(HarnessEvent, value);
}

/** Whether `value` is a well-formed harness event. */
export function isHarnessEvent(value: unknown): value is HarnessEvent {
  return validateHarnessEvent(value).ok;
}
