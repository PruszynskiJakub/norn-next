/**
 * The config a person writes. Norn's own keys are closed, so a typo is a config error rather than a
 * setting silently ignored; a slot's own keys (beside `use`) belong to the plugin that fills it, and
 * that plugin's factory validates them.
 */
import { CAPABILITIES } from "@norn/plugin-api";
import { Mode, NonEmpty, OUTCOME_NAME_PATTERN, PosInt } from "@norn/schema";
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
/**
 * An executor: a harness and the model it runs, on this machine and its accounts. Its runner is the one
 * `runners` picks for each step's attendance, unless it names one of its own, which then runs every step.
 */
export const Executor = Type.Object({ harness: Name, runner: Type.Optional(RunnerChoice), model: Type.Optional(NonEmpty), args: Type.Optional(AgentArgs) }, closed);

/**
 * The runner an executor without one of its own runs in, by who stays beside the step's agent: the
 * person (a runner with presence, such as herdr), a supervisor, or nobody. Absent: headless for agent and
 * none, and none for person, so an attended step parks until one is set.
 */
export const Runners = Type.Object({ person: Type.Optional(RunnerChoice), agent: Type.Optional(RunnerChoice), none: Type.Optional(RunnerChoice) }, closed);
export const DEFAULT_RUNNERS = { agent: "headless", none: "headless" } as const;

/**
 * An agent role, or a workflow's step as `<workflow>.<step>`, to the executor it runs on, or a list
 * tried in order: the first that can run the step does. A step's binding outranks its role's.
 */
export const Bind = Type.Record(Name, Type.Union([Name, Type.Array(Name, { minItems: 1, uniqueItems: true })]), closed);

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

/**
 * Where this machine keeps each workflow source, by the name the workflow gives it: an absolute path,
 * or one relative to the repo's root. The key takes the workflow's own pattern for a source name, so
 * every source a workflow may name can be bound.
 */
export const Sources = Type.Record(Type.String({ pattern: OUTCOME_NAME_PATTERN }), NonEmpty, closed);

/** A workflow's step, as `<workflow>.<step>`: the workflow's name and the step's. */
const StepRef = Type.String({ pattern: "^[a-z0-9][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$" });
const StepRefs = Type.Array(StepRef, { uniqueItems: true });

/**
 * What the person lets stand in for them: the `attended: agent` steps whose questions a supervisor may
 * answer (`attended`) and the gates a supervisor may decide (`gates`). Granted in the user's own file only: a
 * repo file, which an agent in its step can change, may narrow a list and never widen it.
 */
export const Policy = Type.Object(
  {
    stand_in: Type.Optional(Type.Object({ attended: Type.Optional(StepRefs), gates: Type.Optional(StepRefs) }, closed)),
    /** the capabilities any step may be granted, which caps every role's; absent: every one */
    allow: Type.Optional(Type.Array(Type.Union(CAPABILITIES.map((c) => Type.Literal(c)), { title: "capability" }), { uniqueItems: true })),
  },
  closed,
);
export type Policy = Static<typeof Policy>;
/** The keys a repo file can only narrow, and the user's file alone grants. */
export const POLICY_KEY = "policy";

/**
 * QA's evidence files: `publish` keeps them on a ref of the remote that only norn reads and links them
 * from the pull request body, which makes them as visible as the repo. False keeps nothing and pushes
 * nothing, so the body names the files as text.
 */
export const EvidenceKnobs = Type.Object({ publish: Type.Optional(Type.Boolean()) }, closed);

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
    /** the executor an agent step runs on when it names none and `bind` binds neither its step nor its role; absent: the only executor */
    executor: Type.Optional(Name),
    /** the runner each attendance picks for an executor without its own */
    runners: Type.Optional(Runners),
    /** which executors each agent role, or one workflow's step, runs on */
    bind: Type.Optional(Bind),
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
    /** what the person lets stand in for them; the user's file grants it, a repo file only narrows it */
    policy: Type.Optional(Policy),
    /** whether QA's evidence is published with the pull request */
    evidence: Type.Optional(EvidenceKnobs),
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
    runners: Type.Optional(
      Type.Object({ person: Type.Optional(Type.Union([Name, partial(Slot, "open")])), agent: Type.Optional(Type.Union([Name, partial(Slot, "open")])), none: Type.Optional(Type.Union([Name, partial(Slot, "open")])) }, closed),
    ),
    bind: Type.Optional(Bind),
    packs: Type.Optional(Type.Array(Name, { minItems: 1, maxItems: 1 })),
    plugins: Type.Optional(Type.Record(Name, NonEmpty)),
    base: Type.Optional(NonEmpty),
    base_ref: Type.Optional(NonEmpty),
    holder: Type.Optional(NonEmpty),
    kernel: Type.Optional(KernelKnobs),
    trace: Type.Optional(TraceKnobs),
    checks: Type.Optional(Checks),
    sources: Type.Optional(Sources),
    policy: Type.Optional(Policy),
    evidence: Type.Optional(EvidenceKnobs),
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
  evidence: { publish: true },
};
