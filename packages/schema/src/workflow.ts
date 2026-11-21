import { type Static, type TObject, type TOptional, type TSchema, type TUnknown, Type } from "@sinclair/typebox";
import {
  CounterName,
  Duration,
  Mode,
  NonEmpty,
  OUTCOME_NAME_PATTERN,
  OutcomeName,
  PosInt,
  StepName,
  StoredCounterName,
  TaggedUnion,
  Target,
} from "./common.ts";
import { Verdict } from "./criteria.ts";

/** What an agent's report of an outcome must come with: a findings file or an evidence folder. */
export const HandBack = Type.Union([Type.Literal("findings"), Type.Literal("evidence")]);
export type HandBack = Static<typeof HandBack>;

/**
 * What an agent step may write: `worktree` (the default), its unit's worktree; `docs`, only the
 * story's documents in its spec folder and the roots outside the worktree a write may land in. The
 * write guard holds it, so a `docs` step runs only on a harness that can deny a tool.
 */
export const StepWrites = Type.Union([Type.Literal("worktree"), Type.Literal("docs")]);
export type StepWrites = Static<typeof StepWrites>;

/** A signal as a step written with `by:` names it under `on:`: `<namespace>.<signal>`. */
const SignalSurfaceName = Type.String({ pattern: "^[^.\\s]+\\.[a-z][a-z0-9_-]*$" });

/**
 * The agent roles a step written with `by:` may name when its host registers none: the roles the
 * shipped pack registers that do a step (its supervisor does none).
 */
export const AGENT_ROLES = ["builder", "reviewer", "qa", "investigator", "writer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * Who stays beside an agent step's agent: the person (in a runner with presence), a supervisor, or
 * nobody. It picks the runner the agent runs in, from the config's `runners:`.
 */
export const ATTENDANCE = ["person", "agent", "none"] as const;
export const Attendance = Type.Union(ATTENDANCE.map((a) => Type.Literal(a)));
export type Attendance = Static<typeof Attendance>;

/** Full outcome edge: `{ to, counter?, means? }`. */
export const OutcomeEdge = Type.Object(
  {
    to: Target,
    counter: Type.Optional(StoredCounterName),
    means: Type.Optional(Type.String({ minLength: 1, description: "Shown to the agent in the brief" })),
    /** Reportable only when the worst verdict of the `--criteria` report is this one (agent steps) */
    verdict: Type.Optional(Verdict),
  },
  { additionalProperties: false },
);
export type OutcomeEdge = Static<typeof OutcomeEdge>;

/** An outcome maps to a bare target string or a full edge. */
export const OutcomeSpec = Type.Union([Target, OutcomeEdge]);
export type OutcomeSpec = Static<typeof OutcomeSpec>;

/** Open outcome map (agent steps): any outcome name → spec. */
function openOutcomes<S extends TSchema>(spec: S) {
  return Type.Record(OutcomeName, spec, { minProperties: 1, additionalProperties: false });
}

/** Closed outcome map: only the step type's fixed outcomes; at least one declared. Undeclared ones route to `$stuck`. */
function fixedOutcomes<const K extends string, S extends TSchema>(keys: readonly K[], spec: S) {
  const props = Object.fromEntries(keys.map((k) => [k, Type.Optional(spec)])) as unknown as {
    [P in K]: TOptional<S>;
  };
  return Type.Object(props, { minProperties: 1, additionalProperties: false });
}

/**
 * Named input kinds of an agent step. `{ file }` is relative to the spec folder. `record`:
 * each unit's receipts and evidence folders in the machine dir, and the record path to link
 * evidence by. `resolution`: one `git show --remerge-diff <sha>` per merge commit since the round's
 * latest approval, from the git summary the last routed update recorded. `base_side`: the commit a
 * base update (or a slice's integrate) could not merge, and per path it conflicted in, the commands that
 * show what that side changed there since the merge base. `signal`: the detail of the signal that routed
 * the story here, for the agent step right after it.
 */
export const InputKind = Type.Union([
  Type.Literal("spec"),
  Type.Literal("slice"),
  Type.Literal("slices"),
  Type.Literal("diff"),
  Type.Literal("handoff"),
  Type.Literal("last_check"),
  Type.Literal("last_findings"),
  Type.Literal("record"),
  Type.Literal("resolution"),
  Type.Literal("base_side"),
  Type.Literal("signal"),
]);
export type InputKind = Static<typeof InputKind>;
export const StepInput = Type.Union([
  InputKind,
  Type.String({
    pattern: `${OUTCOME_NAME_PATTERN.slice(0, -1)}\\??$`,
    description: "a name an earlier step produces, a source the workflow names, or findings, the open findings; a trailing ? makes it optional",
  }),
  Type.Object({ file: NonEmpty, label: Type.Optional(NonEmpty) }, { additionalProperties: false }),
]);
export type StepInput = Static<typeof StepInput>;

const common = {
  description: Type.Optional(Type.String()),
};

const EXIT_CODE_PATTERN = "^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$";

/** `update` merges the base into the story branch; story units only. */
export const GitAction = Type.Union([Type.Literal("integrate"), Type.Literal("push"), Type.Literal("open-pr"), Type.Literal("update")]);
export type GitAction = Static<typeof GitAction>;

/** The step types with routes of the given shape: a workflow's routes, or a shared file's, which may leave through an exit. */
function stepTypes<S extends TSchema>(outcome: S) {
  const AgentStep = Type.Object(
    {
      type: Type.Literal("agent"),
      ...common,
      skills: Type.Optional(Type.Array(NonEmpty, { uniqueItems: true, description: "Skills the agent uses, in the order the brief names them" })),
      instructions: Type.String({ minLength: 1, description: "The orientation: what the step is for" }),
      inputs: Type.Optional(Type.Array(StepInput, { uniqueItems: true })),
      agent: Type.Optional(Type.String({ minLength: 1, description: "Name from config.agents; default config.agent" })),
      model: Type.Optional(NonEmpty),
      attended: Type.Optional(Type.Boolean({ description: "Worked with a person; always started by a person" })),
      deadline: Type.Optional(Duration),
      nudges: Type.Optional(Type.Integer({ minimum: 0, description: "Max nudges in the same session" })),
      retries: Type.Optional(Type.Integer({ minimum: 0, description: "Max fresh-session retries after died" })),
      /** `required` makes `norn done --criteria <file>` mandatory */
      criteria: Type.Optional(Type.Literal("required")),
      /**
       * Outcome → what `norn done <outcome>` must come with: `findings` (`--findings <file>`) or
       * `evidence` (`--evidence <dir>`). Each key is an outcome the agent reports, never a route override.
       */
      hand_back: Type.Optional(
        Type.Record(OutcomeName, HandBack, { minProperties: 1, additionalProperties: false, description: "Outcome → what its norn done must come with" }),
      ),
      produces: Type.Optional(
        Type.Record(
          OutcomeName,
          Type.Object(
            {
              file: Type.String({ minLength: 1, pattern: "\\S", description: "The file, relative to the story's spec folder (`pr.md`)" }),
              on: Type.Optional(Type.Array(OutcomeName, { minItems: 1, uniqueItems: true, description: "The outcomes whose report needs the file" })),
            },
            { additionalProperties: false },
          ),
          { minProperties: 1, additionalProperties: false, description: "Name → the file the step writes for later steps, which list the name under inputs:" },
        ),
      ),
      writes: Type.Optional(Type.Union(StepWrites.anyOf, { description: "worktree (default): the unit's worktree; docs: only the story's documents in its spec folder" })),
      /**
       * Declared outcomes. May also override classified routes by naming
       * `silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`.
       */
      outcomes: openOutcomes(outcome),
    },
    { additionalProperties: false },
  );

  const CheckStep = Type.Object(
    {
      type: Type.Literal("check"),
      ...common,
      run: NonEmpty,
      timeout: Duration,
      /**
       * Exit code (1–255) → outcome name, for a check that ends in more than pass or fail; exit 0 is
       * always `pass` and any other exit `fail`. Each named outcome is declared in `outcomes`.
       */
      exits: Type.Optional(
        Type.Record(Type.String({ pattern: EXIT_CODE_PATTERN }), OutcomeName, {
          minProperties: 1,
          additionalProperties: false,
          description: "Exit code → outcome; exit 0 is pass, an undeclared one fail",
        }),
      ),
      /** `pass`, `fail` and the outcomes `exits` names; load-time validation refuses any other */
      outcomes: openOutcomes(outcome),
    },
    { additionalProperties: false },
  );

  const GateStep = Type.Object(
    {
      type: Type.Literal("gate"),
      ...common,
      prompt: Type.String({ minLength: 1, description: "What the person decides; shown in inbox" }),
      /** `stale`: tick-classified on a story gate when the base moved under the story */
      outcomes: fixedOutcomes(["approve", "reject", "stale"] as const, outcome),
    },
    { additionalProperties: false },
  );


  const GitStep = Type.Object(
    {
      type: Type.Literal("git"),
      ...common,
      action: GitAction,
      /** `clean` and `resolved` (the light path after a base update) only on `action: update` */
      outcomes: fixedOutcomes(["done", "conflict", "clean", "resolved"] as const, outcome),
    },
    { additionalProperties: false },
  );

  const SlicesStep = Type.Object(
    {
      type: Type.Literal("slices"),
      ...common,
      outcomes: fixedOutcomes(["done", "stuck"] as const, outcome),
    },
    { additionalProperties: false },
  );

  /**
   * Waits for the story's PR to merge: entered like a gate, but a person gives no decision there. The merge (or a PR closed unmerged) ends the wait through the story's lifecycle;
   * `stale` is tick-classified when the base moved under the story.
   */
  const MergeStep = Type.Object(
    {
      type: Type.Literal("merge"),
      ...common,
      outcomes: fixedOutcomes(["stale"] as const, outcome),
    },
    { additionalProperties: false },
  );
  return { AgentStep, CheckStep, GateStep, GitStep, SlicesStep, MergeStep };
}

/**
 * The step shapes as a file writes them: one head key says what happens (`agent: <orientation>`,
 * `check: <command>`, `gate: <decision>`, or a verb with no value), the loader reads each into the
 * model's `type`-tagged step. An agent step's outcome may be an object saying everything about the
 * outcome (`agentRoute`: its route, `means`, `verdict` and `produces`), and its step-level `produces:`
 * lists what every outcome produces unless the outcome lists its own; the older sibling maps (`means:`,
 * `verdict:`, `criteria:`, `hand_back:`, `produces:` as a map of files) still load. Any other step's
 * outcome is a route only.
 */
function fileStepTypes<R extends TSchema>(route: R, agentRoute: TSchema, onRoute: TSchema) {
  const routes = openOutcomes(route);
  /** What may interrupt a waiting step from outside: signal name → route, with the signal's parameters (`after:` for `timeout`). */
  const on = Type.Optional(
    Type.Record(OutcomeName, onRoute, { minProperties: 1, additionalProperties: false, description: "Signal → route: stale, unpushed, timeout, or one a plugin declares" }),
  );
  const model = stepTypes(route);
  const { type: _t, instructions: _i, agent: _a, outcomes: _o, ...agentKeys } = model.AgentStep.properties;
  const AgentStep = Type.Object(
    {
      agent: Type.String({ minLength: 1, pattern: "\\S", description: "The orientation: what the step is for" }),
      ...agentKeys,
      by: Type.Optional(Type.String({ minLength: 1, description: "Name from config.agents; default config.agent" })),
      produces: Type.Optional(Type.Union([agentKeys.produces, ProducesList], { description: "What every outcome produces unless it lists its own, or the older map of files" })),
      outcomes: openOutcomes(agentRoute),
      means: Type.Optional(Type.Record(OutcomeName, Type.String({ minLength: 1 }), { additionalProperties: false, description: "Outcome → what it means, shown to the agent in the brief" })),
      verdict: Type.Optional(Type.Record(OutcomeName, Verdict, { additionalProperties: false, description: "Outcome → the worst criteria verdict it may be reported with" })),
    },
    { additionalProperties: false },
  );
  const CheckStep = Type.Object(
    { check: NonEmpty, ...common, timeout: Duration, exits: model.CheckStep.properties.exits, outcomes: routes },
    { additionalProperties: false },
  );
  const GateStep = Type.Object(
    {
      gate: Type.String({ minLength: 1, pattern: "\\S", description: "What the person decides; shown in inbox" }),
      ...common,
      outcomes: fixedOutcomes(["approve", "reject", "stale"] as const, route),
      on,
    },
    { additionalProperties: false },
  );
  const verb = <K extends string>(head: K, outcomes: readonly string[], waits = false) =>
    Type.Object(
      { [head]: Type.Null({ description: "Takes no value" }), ...common, outcomes: fixedOutcomes(outcomes, route), ...(waits && { on }) } as {
        [P in K]: ReturnType<typeof Type.Null>;
      } & typeof common & { outcomes: TSchema },
      { additionalProperties: false },
    );
  // a step written with by: names a signal by its namespace (`vcs.stale`) and a step kind by value
  const onNamed = Type.Optional(
    Type.Record(SignalSurfaceName, onRoute, { minProperties: 1, additionalProperties: false, description: "Signal → route: vcs.stale, vcs.unpushed, norn.timeout, or one a plugin declares as <namespace>.<signal>" }),
  );
  const instruction = (description: string) => Type.String({ minLength: 1, pattern: "\\S", description });
  const AgentActorStep = Type.Object(
    {
      by: Type.Union(AGENT_ROLES.map((r) => Type.Literal(r)), { description: "The agent role that does the step" }),
      do: instruction("The agent's instruction: what the step is for"),
      ...common,
      with: Type.Optional(Type.Object({ skills: agentKeys.skills }, { additionalProperties: false, description: "How the agent works: the skills it uses" })),
      reads: agentKeys.inputs,
      produces: Type.Optional(ProducesList),
      allow: Type.Optional(
        Type.Array(Type.Union([Type.Literal("code:write"), Type.Literal("docs:write")]), { minItems: 1, uniqueItems: true, description: "What the step may write; docs:write alone keeps it to the story's documents" }),
      ),
      attended: Type.Optional(
        Type.Union(
          [
            Type.Literal("person", { description: "A person stays alongside the agent, in a runner with presence, and starts the step" }),
            Type.Literal("agent", { description: "A supervisor stays alongside the agent; it runs in the config's runners.agent" }),
            Type.Literal("none", { description: "Nobody stays alongside the agent (the default); it runs in the config's runners.none" }),
          ],
          { description: "Who stays alongside the agent, which picks its runner" },
        ),
      ),
      limits: Type.Optional(Type.Object({ deadline: agentKeys.deadline, nudges: agentKeys.nudges, retries: agentKeys.retries }, { additionalProperties: false })),
      outcomes: openOutcomes(agentRoute),
    },
    { additionalProperties: false },
  );
  const PersonStep = Type.Object(
    { by: Type.Literal("person"), do: instruction("What the person decides; shown in inbox"), ...common, outcomes: fixedOutcomes(["approve", "reject"] as const, route), on: onNamed },
    { additionalProperties: false },
  );
  const ShellStep = Type.Object(
    {
      by: Type.Literal("shell"),
      do: NonEmpty,
      ...common,
      with: Type.Optional(Type.Object({ exits: model.CheckStep.properties.exits }, { additionalProperties: false })),
      limits: Type.Object({ timeout: Duration }, { additionalProperties: false }),
      outcomes: routes,
    },
    { additionalProperties: false },
  );
  const KindStep = Type.Object(
    {
      by: Type.String({ pattern: "^(?!norn\\.)[^.\\s]+\\.[a-z][a-z0-9-]*$", description: "A step kind as <slot>.<kind> (forge.open-pr) or <plugin>.<kind>" }),
      ...common,
      with: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "The step kind's settings" })),
      outcomes: routes,
      on: onNamed,
    },
    { additionalProperties: false },
  );
  const EachStep = Type.Object(
    {
      by: Type.Literal("norn.each", { description: "Runs each slice of the story through the config's slice_workflow" }),
      ...common,
      reads: Type.Optional(Type.Tuple([Type.Literal("slices")])),
      outcomes: fixedOutcomes(["done", "stuck"] as const, route),
    },
    { additionalProperties: false },
  );
  return {
    AgentActorStep,
    PersonStep,
    ShellStep,
    KindStep,
    EachStep,
    AgentStep,
    CheckStep,
    GateStep,
    UpdateBranchStep: verb("update-branch", ["done", "conflict", "clean", "resolved"]),
    OpenPrStep: verb("open-pr", ["done", "conflict"]),
    IntegrateStep: verb("integrate", ["done", "conflict"]),
    PushStep: verb("push", ["done", "conflict"]),
    AwaitMergeStep: verb("await-merge", ["merged", "unpushed", "stale"], true),
    SlicesStep: verb("slices", ["done", "stuck"]),
  };
}

export const { AgentStep, CheckStep, GateStep, GitStep, SlicesStep, MergeStep } = stepTypes(OutcomeSpec);
export type AgentStep = Static<typeof AgentStep>;
export type CheckStep = Static<typeof CheckStep>;
export type GateStep = Static<typeof GateStep>;
export type GitStep = Static<typeof GitStep>;
export type SlicesStep = Static<typeof SlicesStep>;
export type MergeStep = Static<typeof MergeStep>;

export const Step = TaggedUnion("type", [AgentStep, CheckStep, GateStep, GitStep, SlicesStep, MergeStep]);
export type Step = Static<typeof Step>;
export type StepType = Step["type"];

const ResetEdge = Type.String({ pattern: "^[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$", description: "<step>.<outcome> whose edge resets the counter" });

export const CounterSpec = Type.Object(
  {
    max: PosInt,
    /**
     * Taking the edge `<step>.<outcome>` (or any edge of a list) resets this counter to 0,
     * journaled in the advance (trace, commit) and the classify receipt. E.g. `base_conflict_loop`
     * resets on `update.done`: each base move is a fresh attempt, only repeated failures on one move count.
     */
    reset_on: Type.Optional(Type.Union([ResetEdge, Type.Array(ResetEdge, { minItems: 1 })])),
  },
  { additionalProperties: false },
);
export type CounterSpec = Static<typeof CounterSpec>;

/** When a waiting story counts as stale, the step `norn story update-branch` re-enters, and the check that re-verifies it. */
export const BaseSync = Type.Object(
  {
    /** `conflict` (default): a merge of the base would conflict; `behind`: the base has any commit the story lacks */
    stale: Type.Optional(Type.Union([Type.Literal("conflict"), Type.Literal("behind")])),
    /** step `norn story update-branch` re-enters; default: the first step with `action: update` */
    step: Type.Optional(StepName),
    /**
     * A check step norn runs on the merge of a base that moved under a story waiting at `ready` or a
     * merge step without a conflict, once per (story head, base sha); red takes the waiting step's
     * `stale` edge. Not with `stale: behind`, where any base move updates the story already.
     */
    verify: Type.Optional(StepName),
  },
  { additionalProperties: false },
);
export type BaseSync = Static<typeof BaseSync>;

export const Workflow = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    name: Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }),
    description: Type.Optional(Type.String()),
    /** How stories in this workflow run, unless `norn story edit` sets the story's own */
    mode: Type.Optional(Mode),
    /** Limits for every step that does not set its own; `stalled` only here */
    defaults: Type.Optional(
      Type.Object(
        {
          deadline: Type.Optional(Duration),
          nudges: Type.Optional(Type.Integer({ minimum: 0 })),
          retries: Type.Optional(Type.Integer({ minimum: 0 })),
          stalled: Type.Optional(Duration),
        },
        { additionalProperties: false },
      ),
    ),
    start: StepName,
    steps: Type.Record(StepName, Step, { minProperties: 1, additionalProperties: false }),
    counters: Type.Optional(Type.Record(StoredCounterName, CounterSpec, { additionalProperties: false })),
    base: Type.Optional(BaseSync),
    /** Places the steps read that are neither norn's nor the repo's code, by a name of the workflow's own */
    sources: Type.Optional(
      Type.Record(
        OutcomeName,
        Type.Object(
          {
            type: Type.Union([Type.Literal("folder"), Type.Literal("file")]),
            path: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "Relative to the repo's root; the config's sources binding wins" })),
            description: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
        { additionalProperties: false, description: "A source a step reads by name; one with no path is bound in the config's sources" },
      ),
    ),
  },
  {
    $id: "https://norn.dev/schema/workflow.json",
    title: "norn workflow",
    additionalProperties: false,
  },
);
export type Workflow = Static<typeof Workflow>;

/** A route inside a shared file that leaves it: the `use` step routes the exit by name, as it routes an outcome. */
export const ExitEdge = Type.Object(
  {
    exit: OutcomeName,
    means: Type.Optional(Type.String({ minLength: 1, description: "Shown to the agent in the brief" })),
    verdict: Type.Optional(Verdict),
  },
  { additionalProperties: false },
);
export type ExitEdge = Static<typeof ExitEdge>;

/**
 * A route as a file writes it: a bare target or `{ to, counter, max }`. `max` bounds the counter
 * derived from the edge; the loader turns it into a counter, so the loaded workflow never holds it.
 */
const RouteEdge = Type.Object(
  { to: Target, counter: Type.Optional(CounterName), max: Type.Optional(PosInt) },
  { additionalProperties: false },
);
const FileRoute = Type.Union([Target, RouteEdge]);

/**
 * What an agent's report of an outcome comes with: a report norn takes with it (`criteria`,
 * `findings`, `evidence`), bare, or a file of the spec folder, given once in the step as
 * `{ name, file }` and named bare elsewhere in it. Which names are reports is the loader's check.
 */
export const ProducesEntry = Type.Union([
  OutcomeName,
  Type.Object(
    { name: OutcomeName, file: Type.String({ minLength: 1, pattern: "\\S", description: "The file, relative to the story's spec folder (`pr.md`)" }) },
    { additionalProperties: false },
  ),
]);
export type ProducesEntry = Static<typeof ProducesEntry>;
export const ProducesList = Type.Array(ProducesEntry, { uniqueItems: true });
export type ProducesList = Static<typeof ProducesList>;

/** What an agent step's outcome object says of the outcome beside its route. */
const outcomeFields = {
  means: Type.Optional(Type.String({ minLength: 1, description: "Shown to the agent in the brief" })),
  verdict: Type.Optional(Verdict),
  produces: Type.Optional(ProducesList),
};
/** An agent step's outcome as a file writes it: a bare target, or the route with everything about the outcome. */
const AgentRoute = Type.Union([Target, Type.Object({ ...RouteEdge.properties, ...outcomeFields }, { additionalProperties: false })]);
/** An outcome of a shared file's agent step may leave the file instead; its bound sits on the `use` step's route. */
const SharedExitOutcome = Type.Object({ exit: OutcomeName, ...outcomeFields }, { additionalProperties: false });
/**
 * A route under `on:`: a route as under `outcomes:`, whose edge may also carry the signal's parameters.
 * Open, since a plugin's signal declares its own parameters, which only the loader knows to check.
 */
const signalParams = { after: Type.Optional(Duration) };
const OnEdge = Type.Object({ ...RouteEdge.properties, ...signalParams }, { additionalProperties: true });
const OnExit = Type.Object({ exit: OutcomeName, ...signalParams }, { additionalProperties: true });
const fileSteps = (route: TSchema, agentRoute: TSchema, onRoute: TSchema) => Object.values(fileStepTypes(route, agentRoute, onRoute)) as TObject[];
const FileSteps = fileSteps(FileRoute, AgentRoute, Type.Union([Target, OnEdge]));
// A shared file's route may also leave it through an exit, which its `use` step routes by name
const SharedSteps = fileSteps(
  Type.Union([FileRoute, Type.Object({ exit: OutcomeName }, { additionalProperties: false })]),
  Type.Union([AgentRoute, SharedExitOutcome]),
  Type.Union([Target, OnEdge, OnExit]),
);

// As written in a shared file: a declared (dotless) counter, and a `max` the loader turns into a derived counter
const SharedModelEdge = Type.Object(
  { ...OutcomeEdge.properties, counter: Type.Optional(CounterName), max: Type.Optional(PosInt) },
  { additionalProperties: false },
);
const SharedModelSteps = stepTypes(Type.Union([Target, SharedModelEdge, ExitEdge]));

/** A shared file's steps in the loaded model's form, the way the loader checks them before flattening; never published. */
export const WorkflowSharedModel = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    start: StepName,
    steps: Type.Record(
      StepName,
      TaggedUnion("type", [SharedModelSteps.AgentStep, SharedModelSteps.CheckStep, SharedModelSteps.GateStep, SharedModelSteps.GitStep, SharedModelSteps.SlicesStep, SharedModelSteps.MergeStep]),
      { minProperties: 1, additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/**
 * `like: <step>` copies a step of the same file; each key it writes replaces the copied value whole.
 * Its keys are checked loosely here: the full check runs on the copy, once the target fills it in.
 */
function likeStep(variants: TObject[]) {
  const keys = [...new Set(variants.flatMap((v) => Object.keys(v.properties)))];
  const loose = Object.fromEntries(keys.map((k) => [k, Type.Optional(Type.Unknown())])) as Record<string, TOptional<TUnknown>>;
  return Type.Object({ like: StepName, ...loose }, { additionalProperties: false });
}
const LikeStep = likeStep(FileSteps);

export const SharedName = Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "A file in `.agents/workflows/shared/`, without `.yaml`" });

/** `use: <name>` brings in the steps of `shared/<name>.yaml`; `outcomes` routes each of its exits. */
export const UseStep = Type.Object(
  {
    use: SharedName,
    outcomes: Type.Optional(
      Type.Record(OutcomeName, Type.Union([Target, RouteEdge]), {
        additionalProperties: false,
      }),
    ),
  },
  { additionalProperties: false },
);
export type UseStep = Static<typeof UseStep>;

/** A workflow file as written, before its `use` and `like` steps are filled in; the loaded, flat form is `Workflow`. */
export const WorkflowSource = Type.Object(
  {
    ...Workflow.properties,
    steps: Type.Record(StepName, Type.Union([...FileSteps, UseStep, LikeStep]), { minProperties: 1, additionalProperties: false }),
    // a dotted name is derived from its edge, so a declared one never clashes with it
    counters: Type.Optional(Type.Record(CounterName, CounterSpec, { additionalProperties: false })),
    signals: Type.Optional(
      Type.Object(
        {
          "vcs.stale": Type.Optional(
            Type.Object(
              { when: BaseSync.properties.stale, verify: BaseSync.properties.verify },
              { additionalProperties: false, description: "when: conflict (default) or behind; verify: the check step run on a base move without a conflict" },
            ),
          ),
        },
        { additionalProperties: false, description: "A signal's settings for the whole workflow, written once" },
      ),
    ),
    entries: Type.Optional(
      Type.Object({ "update-branch": Type.Optional(StepName) }, { additionalProperties: false, description: "A way back in → the step it enters: update-branch is what norn story update-branch re-enters" }),
    ),
  },
  {
    $id: "https://norn.dev/schema/workflow-source.json",
    title: "workflow file as written (norn)",
    additionalProperties: false,
  },
);
export type WorkflowSource = Static<typeof WorkflowSource>;

/** A file in `.agents/workflows/shared/`: steps a workflow brings in with `use:`, entered at `start`. */
export const WorkflowShared = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    start: StepName,
    steps: Type.Record(StepName, Type.Union([...SharedSteps, LikeStep]), { minProperties: 1, additionalProperties: false }),
  },
  {
    $id: "https://norn.dev/schema/workflow-shared.json",
    title: "shared workflow steps (norn)",
    additionalProperties: false,
  },
);
export type WorkflowShared = Static<typeof WorkflowShared>;

/** Classified outcomes the tick may decide per step type. */
export const CLASSIFIED_OUTCOMES = {
  agent: ["silent", "died", "timeout", "stalled", "ask", "exhausted"],
  check: ["pass", "fail", "exhausted"],
  gate: ["approve", "reject", "stale", "unpushed", "exhausted"],
  git: ["done", "conflict", "clean", "resolved", "stuck", "exhausted"],
  slices: ["done", "stuck", "exhausted"],
  merge: ["stale", "unpushed", "exhausted"],
} as const satisfies Record<StepType, readonly string[]>;

export function outcomeEdge(spec: OutcomeSpec): OutcomeEdge {
  return typeof spec === "string" ? { to: spec } : spec;
}
