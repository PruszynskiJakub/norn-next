/**
 * GR10, GR11 (gh-67): the labels norn uses — the intake label (GR1), one `norn:wf:<name>` per valid
 * workflow (W9) and the fixed triage set — planned against the labels the remote defines. Pure:
 * `norn init`, `norn upgrade` and `norn doctor` list the remote's labels and act on the plan.
 */
import type { RemoteProvider } from "@norn/schema";
import type { RemoteLabel } from "./ports.ts";
import { WF_LABEL } from "./policy.ts";

/** GR10: every label norn creates has this colour (hex, no `#`). */
export const NORN_LABEL_COLOR = "5319E7";
/** GitHub refuses a label description longer than this. */
const DESCRIPTION_MAX = 100;

/** A label norn wants on the remote: its name and the description it is created with. */
export interface LabelSpec {
  name: string;
  description: string;
}

const INTAKE_DESCRIPTION = "norn takes in issues assigned to you with this label";

/** GR11: the triage set, fixed and not configurable, in the order the sets are read. */
export const TRIAGE_LABELS: readonly LabelSpec[] = [
  { name: "norn:kind:bug", description: "Kind: something does not work as it should" },
  { name: "norn:kind:feature", description: "Kind: new or changed behaviour for users" },
  { name: "norn:kind:security", description: "Kind: a vulnerability or security hardening" },
  { name: "norn:kind:chore", description: "Kind: maintenance (dependencies, tooling, CI, refactors)" },
  { name: "norn:kind:docs", description: "Kind: documentation only" },
  { name: "norn:risk:low", description: "Risk: a two-way door with a small blast radius, easy to undo" },
  { name: "norn:risk:medium", description: "Risk: a two-way door that touches shared code or behaviour" },
  { name: "norn:risk:high", description: "Risk: a one-way door or a wide blast radius" },
  { name: "norn:priority:low", description: "Priority: can wait until there is room" },
  { name: "norn:priority:medium", description: "Priority: do it soon, in the normal flow" },
  { name: "norn:priority:high", description: "Priority: do it next; it blocks or hurts work now" },
  { name: "norn:priority:extreme", description: "Priority: drop other work (broken main, data loss, a security hole)" },
];

/** A workflow as the label plan sees it: `valid` when it passes W1/W5 validation. */
export interface WorkflowForLabel {
  name: string;
  description?: string;
  valid: boolean;
}

export interface LabelPlan {
  /** every label norn uses, in order: intake, workflows (by name), triage set */
  wanted: LabelSpec[];
  /** wanted labels the remote has (left as they are, B8) */
  existing: string[];
  /** wanted labels the remote lacks */
  missing: LabelSpec[];
  /** B10: `norn:wf:*` labels on the remote naming no workflow in the repo */
  unused: string[];
  /** B5: workflows that fail validation, so get no label */
  invalid: string[];
}

const clip = (s: string) => (s.length <= DESCRIPTION_MAX ? s : `${s.slice(0, DESCRIPTION_MAX - 1)}…`);

/** GR10: the labels norn uses against the names the remote defines (compared without case, as the providers do). */
export function planLabels(input: { intake: string; workflows: readonly WorkflowForLabel[]; remote: readonly string[] }): LabelPlan {
  const flows = [...input.workflows].sort((a, b) => a.name.localeCompare(b.name));
  const wanted: LabelSpec[] = [
    { name: input.intake, description: INTAKE_DESCRIPTION },
    ...flows.filter((w) => w.valid).map((w) => ({ name: `${WF_LABEL}${w.name}`, description: clip(w.description?.trim() || `The ${w.name} workflow (norn)`) })),
    ...TRIAGE_LABELS,
  ];
  const on = new Set(input.remote.map((n) => n.toLowerCase()));
  const named = new Set(flows.map((w) => `${WF_LABEL}${w.name}`.toLowerCase()));
  return {
    wanted,
    existing: wanted.filter((l) => on.has(l.name.toLowerCase())).map((l) => l.name),
    missing: wanted.filter((l) => !on.has(l.name.toLowerCase())),
    unused: input.remote.filter((n) => n.toLowerCase().startsWith(WF_LABEL) && !named.has(n.toLowerCase())),
    invalid: flows.filter((w) => !w.valid).map((w) => w.name),
  };
}

/** A double-quoted shell word: safe for any description. */
const quoted = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** B13: the command a person runs to create a label norn could not. */
export function labelCreateCommand(provider: RemoteProvider, label: RemoteLabel): string {
  return provider === "glab"
    ? `glab label create --name ${label.name} --color ${quoted(`#${label.color}`)} --description ${quoted(label.description)}`
    : `gh label create ${label.name} --color ${label.color} --description ${quoted(label.description)}`;
}

/** B10: the command a person runs to delete an unused label; norn never runs it. */
export function labelDeleteCommand(provider: RemoteProvider, name: string): string {
  return `${provider === "glab" ? "glab" : "gh"} label delete ${name}`;
}
