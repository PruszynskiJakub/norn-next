/**
 * The config a person writes. Norn's own keys are closed, so a typo is a config error rather than a
 * setting silently ignored; a slot's own keys (beside `use`) belong to the plugin that fills it, and
 * that plugin's factory validates them.
 */
import { Mode, NonEmpty, PosInt } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

const closed = { additionalProperties: false } as const;
const open = { additionalProperties: true } as const;
const Count = Type.Integer({ minimum: 0 });
/** a name a config key or a command line spells: an executor, a plugin, a pack */
const NAME_PATTERN = "^[a-z0-9][a-z0-9._-]*$";
const Name = Type.String({ pattern: NAME_PATTERN });

export const Duration = Type.String({ pattern: "^[1-9][0-9]*(ms|s|m|h|d)$" });

/** How long tick traces are kept: a duration, or `keep` for every trace, forever. */
export const TraceRetain = Type.Union([Duration, Type.Literal("keep")]);
export const TraceKnobs = Type.Object({ retain: Type.Optional(TraceRetain) }, closed);

/** `{use, ...its plugin's config}` */
export const Slot = Type.Object({ use: Name }, open);
export const Intake = Type.Object(
  {
    label: NonEmpty,
    /** `me` is whoever the tracker's `whoami` names; null takes items whoever they are assigned to */
    assignee: Type.Optional(Type.Union([NonEmpty, Type.Null()])),
  },
  closed,
);
export const TrackerSlot = Type.Object({ use: Name, intake: Intake }, open);
/** a runner by name, or `{use, ...its config}` */
export const RunnerChoice = Type.Union([Name, Slot]);
/** the agent's extra arguments; they replace the harness's defaults whole (claude's are `--permission-mode auto`) */
const AgentArgs = Type.Array(NonEmpty);
export const Executor = Type.Object({ harness: Name, runner: RunnerChoice, model: Type.Optional(NonEmpty), args: Type.Optional(AgentArgs) }, closed);

export const Counters = Type.Object(
  {
    check_fail: Type.Optional(PosInt),
    gate_reject: Type.Optional(PosInt),
    conflict: Type.Optional(PosInt),
    stale: Type.Optional(PosInt),
    agent_back: Type.Optional(PosInt),
  },
  closed,
);

/** The kernel's knobs; each absent one takes the kernel's default. */
export const KernelKnobs = Type.Object(
  {
    mode: Type.Optional(Mode),
    workflow: Type.Optional(Name),
    slice_workflow: Type.Optional(Name),
    intake_workflow_label_prefix: Type.Optional(NonEmpty),
    max_nudges: Type.Optional(Count),
    max_retries: Type.Optional(Count),
    silent_after: Type.Optional(Duration),
    deadline: Type.Optional(Type.Union([Duration, Type.Literal("none")])),
    claim_ttl: Type.Optional(Duration),
    claim_renew_before: Type.Optional(Duration),
    lock_stale: Type.Optional(Duration),
    counters: Type.Optional(Counters),
  },
  closed,
);

/** A check's command by the name a workflow's check step spells as `{checks.<name>}`. */
export const Checks = Type.Record(Name, NonEmpty, closed);

/** Where this machine keeps each workflow source, by the name the workflow gives it: an absolute path, or one relative to the repo's root. */
export const Sources = Type.Record(Type.String({ pattern: "^[a-z][a-z0-9_]*$" }), NonEmpty, closed);

export const CONFIG_FORMAT = 1;

/** The merged config every command runs on. */
export const NornConfig = Type.Object(
  {
    format: Type.Literal(CONFIG_FORMAT),
    tracker: TrackerSlot,
    forge: Slot,
    store: Slot,
    vcs: Slot,
    executors: Type.Record(Name, Executor, { minProperties: 1 }),
    /** the executor an agent step runs on when it names none; absent: the only executor */
    executor: Type.Optional(Name),
    /** the workflows' pack; one for now, as the runtime loads a single pack */
    packs: Type.Array(Name, { minItems: 1, maxItems: 1 }),
    /** non-bundled plugins by name: the spec `norn plugin add` installs */
    plugins: Type.Record(Name, NonEmpty),
    base: NonEmpty,
    /** the ref the base is measured at, such as `origin/main`; absent: the remote's fetched copy of `base`, else `base` */
    base_ref: Type.Optional(NonEmpty),
    /** who this machine claims as; absent: user@host */
    holder: Type.Optional(NonEmpty),
    kernel: Type.Optional(KernelKnobs),
    trace: Type.Optional(TraceKnobs),
    /** the commands a workflow's check step names as `{checks.<name>}`; the shipped test steps name `test` */
    checks: Type.Optional(Checks),
    /** where this machine keeps the sources a workflow names, which win over a workflow's own `path:` */
    sources: Type.Optional(Sources),
  },
  { ...closed, title: "NornConfig" },
);
export type NornConfig = Static<typeof NornConfig>;

const partial = (t: TSchema, keep: "open" | "closed") =>
  Type.Partial(t as ReturnType<typeof Type.Object>, keep === "open" ? open : closed);

/**
 * One file's share. Every key may be left to another layer, but a key a file does set must have the
 * right shape and be one norn knows; the merged result is then checked against NornConfig.
 */
export const ConfigLayer = Type.Object(
  {
    format: Type.Optional(Type.Literal(CONFIG_FORMAT)),
    tracker: Type.Optional(Type.Object({ use: Type.Optional(Name), intake: Type.Optional(partial(Intake, "closed")) }, open)),
    forge: Type.Optional(partial(Slot, "open")),
    store: Type.Optional(partial(Slot, "open")),
    vcs: Type.Optional(partial(Slot, "open")),
    executors: Type.Optional(
      Type.Record(
        Name,
        Type.Object(
          { harness: Type.Optional(Name), runner: Type.Optional(Type.Union([Name, partial(Slot, "open")])), model: Type.Optional(NonEmpty), args: Type.Optional(AgentArgs) },
          closed,
        ),
      ),
    ),
    executor: Type.Optional(Name),
    packs: Type.Optional(Type.Array(Name, { minItems: 1, maxItems: 1 })),
    plugins: Type.Optional(Type.Record(Name, NonEmpty)),
    base: Type.Optional(NonEmpty),
    base_ref: Type.Optional(NonEmpty),
    holder: Type.Optional(NonEmpty),
    kernel: Type.Optional(KernelKnobs),
    trace: Type.Optional(TraceKnobs),
    checks: Type.Optional(Checks),
    sources: Type.Optional(Sources),
  },
  { ...closed, title: "NornConfigLayer" },
);
export type ConfigLayer = Static<typeof ConfigLayer>;

/** What holds when no file says otherwise: the lowest layer, beneath the user's. */
export const CONFIG_DEFAULTS: ConfigLayer = {
  format: CONFIG_FORMAT,
  vcs: { use: "git" },
  packs: ["sdlc"],
  plugins: {},
  base: "main",
};
