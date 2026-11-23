/**
 * What `norn workflow list`, `norn workflow show` and `norn skill list` print with `--json`: the
 * workflows a repo can start and the skills an agent there can use. `repo` is the checkout read, or
 * null outside a norn repo, where only the pack is listed and no repo override was read.
 */
import { type Static, Type } from "@sinclair/typebox";
import { NonEmpty } from "./common.ts";

const closed = { additionalProperties: false } as const;
const Text = Type.Union([NonEmpty, Type.Null()]);

/** Where a workflow comes from: the pack, the repo alone, or a repo file named like a pack workflow, which replaces it. */
export const WorkflowOrigin = Type.Union([Type.Literal("pack"), Type.Literal("repo"), Type.Literal("replaces-pack")], { title: "WorkflowOrigin" });
/** `held`: a repo file waiting for the person's confirmation; `invalid`: one that does not load. */
export const WorkflowState = Type.Union([Type.Literal("ok"), Type.Literal("held"), Type.Literal("invalid")], { title: "WorkflowState" });

const WorkflowEntryFields = {
  name: NonEmpty,
  /** when to pick it, from the file's `when:` */
  when: Text,
  description: Text,
  source: WorkflowOrigin,
  state: WorkflowState,
  /** the repo file, or null for the pack's own */
  file: Text,
  /** held: what changed and needs the person's confirmation */
  changes: Type.Optional(Type.Array(NonEmpty)),
  /** held: the command that confirms it */
  confirm: Type.Optional(NonEmpty),
  /** invalid: why it does not load */
  problem: Type.Optional(NonEmpty),
};

export const WorkflowListEntry = Type.Object(WorkflowEntryFields, { ...closed, title: "WorkflowListEntry" });
export type WorkflowListEntry = Static<typeof WorkflowListEntry>;

export const WorkflowList = Type.Object(
  { repo: Text, workflows: Type.Array(WorkflowListEntry) },
  { ...closed, $id: "https://norn.dev/schema/workflow-list.json", title: "WorkflowList" },
);
export type WorkflowList = Static<typeof WorkflowList>;

export const WorkflowShowStep = Type.Object(
  {
    name: NonEmpty,
    /** `agent`, `check`, `gate`, `slices` or a plugin step kind's name */
    kind: NonEmpty,
    /** the agent role an agent step names */
    role: Text,
    skills: Type.Array(NonEmpty),
    /** each outcome, the step it leads to, and the counter taking it bumps */
    outcomes: Type.Array(Type.Object({ outcome: NonEmpty, to: NonEmpty, counter: Text }, closed)),
  },
  { ...closed, title: "WorkflowShowStep" },
);
export type WorkflowShowStep = Static<typeof WorkflowShowStep>;

export const WorkflowShow = Type.Object(
  {
    repo: Text,
    ...WorkflowEntryFields,
    hash: NonEmpty,
    start: NonEmpty,
    steps: Type.Array(WorkflowShowStep),
    counters: Type.Array(Type.Object({ name: NonEmpty, max: Type.Integer({ minimum: 1 }), reset_on: Type.Array(NonEmpty) }, closed)),
    /** the steps a person decides */
    gates: Type.Array(NonEmpty),
  },
  { ...closed, $id: "https://norn.dev/schema/workflow-show.json", title: "WorkflowShow" },
);
export type WorkflowShow = Static<typeof WorkflowShow>;

/** Where a skill comes from: the pack, the repo's `.agents/skills/`, or a harness's own skills folder. */
export const SkillOrigin = Type.Union([Type.Literal("pack"), Type.Literal("repo"), Type.Literal("harness")], { title: "SkillOrigin" });

export const SkillListEntry = Type.Object(
  {
    name: NonEmpty,
    /** the description's "Use when" or "Use for" clause */
    use_when: Text,
    description: Text,
    source: SkillOrigin,
    /** the folder it was read from, or null for the pack's own */
    path: Text,
    /** source harness: the harness whose folder holds it */
    harness: Type.Optional(NonEmpty),
  },
  { ...closed, title: "SkillListEntry" },
);
export type SkillListEntry = Static<typeof SkillListEntry>;

export const SkillList = Type.Object(
  { repo: Text, skills: Type.Array(SkillListEntry) },
  { ...closed, $id: "https://norn.dev/schema/skill-list.json", title: "SkillList" },
);
export type SkillList = Static<typeof SkillList>;
