import { type Static, Type } from "@sinclair/typebox";

/** Words a step may not be named (W7). Step names also may not start with `$`. */
export const RESERVED_STEP_NAMES = [
  "done",
  "stuck",
  "ask",
  "exhausted",
  "silent",
  "died",
  "timeout",
  "stalled",
  "stale",
] as const;

/** Reserved workflow targets (W7). */
export const RESERVED_TARGETS = ["$done", "$stuck"] as const;
export type ReservedTarget = (typeof RESERVED_TARGETS)[number];

export const ULID_PATTERN = "^[0-9A-HJKMNP-TV-Z]{26}$";
export const STORY_KEY_PATTERN = "^(gh|gl)-[1-9][0-9]*$";
export const SLICE_NN_PATTERN = "^[0-9]{2,3}$";
export const SLICE_KEY_PATTERN = "^(gh|gl)-[1-9][0-9]*/[0-9]{2,3}$";
export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";
/** `<nn>-<slug>` folder of a slice unit, or `_story`. */
export const UNIT_DIR_PATTERN = "^(_story|[0-9]{2,3}-[a-z0-9]+(-[a-z0-9]+)*)$";
/** e.g. `30s`, `10m`, `1h30m`, `500ms`. */
export const DURATION_PATTERN = "^([0-9]+(ms|s|m|h|d))+$";
const IDENT = "[a-z][a-z0-9_-]*";
export const STEP_NAME_PATTERN = `^(?!(${RESERVED_STEP_NAMES.join("|")})$)${IDENT}$`;
export const OUTCOME_NAME_PATTERN = `^${IDENT}$`;
export const COUNTER_NAME_PATTERN = `^${IDENT}$`;
export const TARGET_PATTERN = `^(\\$done|\\$stuck|(?!(${RESERVED_STEP_NAMES.join("|")})$)${IDENT})$`;

export const Ulid = Type.String({ pattern: ULID_PATTERN, description: "ULID (ID2)" });
export const IsoTime = Type.String({ format: "date-time", description: "ISO-8601 timestamp, UTC" });
export const Duration = Type.String({ pattern: DURATION_PATTERN, description: "Duration like 30s, 10m, 1h30m" });
export const StoryKey = Type.String({ pattern: STORY_KEY_PATTERN, description: "Story key, e.g. gh-123 or gl-45" });
export const SliceKey = Type.String({ pattern: SLICE_KEY_PATTERN, description: "Slice key, e.g. gh-123/03" });
export const Slug = Type.String({ pattern: SLUG_PATTERN, maxLength: 48 });
export const UnitDir = Type.String({ pattern: UNIT_DIR_PATTERN, description: "_story or <nn>-<slug>" });
export const StepName = Type.String({ pattern: STEP_NAME_PATTERN });
export const OutcomeName = Type.String({ pattern: OUTCOME_NAME_PATTERN });
export const CounterName = Type.String({ pattern: COUNTER_NAME_PATTERN });
/** A step name or a reserved target (`$done`, `$stuck`). */
export const Target = Type.String({ pattern: TARGET_PATTERN });
export const NonEmpty = Type.String({ minLength: 1 });
export const PosInt = Type.Integer({ minimum: 1 });
export const NonNegInt = Type.Integer({ minimum: 0 });

export const RemoteProvider = Type.Union([Type.Literal("gh"), Type.Literal("glab")], {
  description: "Issue provider CLI: gh (GitHub) or glab (GitLab)",
});
export type RemoteProvider = Static<typeof RemoteProvider>;

export const Mode = Type.Union([Type.Literal("manual"), Type.Literal("auto")]);
export type Mode = Static<typeof Mode>;

/** Opaque process identity: PID plus OS start time, for liveness checks (K3). */
export const ProcessIdentity = Type.Object(
  {
    pid: PosInt,
    pid_start: Type.String({ minLength: 1, description: "Process start time as reported by the OS (opaque)" }),
  },
  { additionalProperties: false },
);
export type ProcessIdentity = Static<typeof ProcessIdentity>;

/** Who wrote a receipt or took an action. */
export const Actor = Type.Union([Type.Literal("agent"), Type.Literal("human"), Type.Literal("norn")]);
export type Actor = Static<typeof Actor>;

/**
 * Discriminated union compiled to `oneOf` + `discriminator`, so validation errors
 * point at the matching branch instead of every branch.
 */
export function TaggedUnion<T extends import("@sinclair/typebox").TObject[]>(
  propertyName: string,
  variants: [...T],
  options: { $id?: string; title?: string; description?: string } = {},
) {
  return Type.Unsafe<Static<import("@sinclair/typebox").TUnion<T>>>({
    ...options,
    type: "object",
    oneOf: variants,
    discriminator: { propertyName },
  });
}

/** R6.2: how a pane prompt takes a choice — the option's number, or arrow keys from `cursor` (0-based). */
export const PromptChoice = Type.Object({ numbered: Type.Boolean(), cursor: NonNegInt }, { additionalProperties: false });
export type PromptChoice = Static<typeof PromptChoice>;
