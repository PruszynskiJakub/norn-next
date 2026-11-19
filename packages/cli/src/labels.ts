/**
 * The labels norn puts on tracker items, defined on the tracker before anything carries them: a
 * GitHub repository refuses an issue whose label it does not define, so a fresh repository's first
 * `story create` would fail. Defining is the tracker's `ensure_labels`, which makes only the missing
 * ones and never restyles a label a person made.
 */
import { DEFAULT_WORKFLOW_LABEL_PREFIX } from "@norn/kernel";
import type { TrackerLabel } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import { ulid } from "@norn/schema";
import { failure } from "./output.ts";

/** Every label norn creates has this colour. */
export const NORN_LABEL_COLOR = "5319E7";
/** GitHub refuses a label description longer than this. */
const DESCRIPTION_MAX = 100;
const clip = (s: string) => (s.length <= DESCRIPTION_MAX ? s : `${s.slice(0, DESCRIPTION_MAX - 1)}…`);
const label = (name: string, description: string): TrackerLabel => ({ name, color: NORN_LABEL_COLOR, description: clip(description) });

/** The kind, risk and priority labels the triage workflow sets, spelled as it spells them. */
const TRIAGE_LABELS: ReadonlyArray<[string, string]> = [
  ["norn:kind:bug", "Kind: something does not work as it should"],
  ["norn:kind:feature", "Kind: new or changed behaviour for users"],
  ["norn:kind:security", "Kind: a vulnerability or security hardening"],
  ["norn:kind:chore", "Kind: maintenance (dependencies, tooling, CI, refactors)"],
  ["norn:kind:docs", "Kind: documentation only"],
  ["norn:risk:low", "Risk: a two-way door with a small blast radius, easy to undo"],
  ["norn:risk:medium", "Risk: a two-way door that touches shared code or behaviour"],
  ["norn:risk:high", "Risk: a one-way door or a wide blast radius"],
  ["norn:priority:low", "Priority: can wait until there is room"],
  ["norn:priority:medium", "Priority: do it soon, in the normal flow"],
  ["norn:priority:high", "Priority: do it next; it blocks or hurts work now"],
  ["norn:priority:extreme", "Priority: drop other work (broken main, data loss, a security hole)"],
];

const workflowPrefix = (env: RuntimeEnv): string => env.config.kernel.intakeWorkflowLabelPrefix ?? DEFAULT_WORKFLOW_LABEL_PREFIX;

export function intakeLabel(env: RuntimeEnv): TrackerLabel {
  return label(env.config.intake.label, "norn takes in items with this label");
}

export function workflowLabel(env: RuntimeEnv, workflow: string): TrackerLabel {
  return label(`${workflowPrefix(env)}${workflow}`, `norn starts the story in the ${workflow} workflow`);
}

/** Every label norn uses: the intake label, one per workflow that loads, and the triage set. */
export function nornLabels(env: RuntimeEnv): TrackerLabel[] {
  const workflows = Object.entries(env.workflows).flatMap(([name, w]) => (w.ok ? [name] : [])).sort();
  return [intakeLabel(env), ...workflows.map((w) => workflowLabel(env, w)), ...TRIAGE_LABELS.map(([name, description]) => label(name, description))];
}

/** Define the labels on the tracker; a failure is a CliFailure naming what it could not do. */
export async function ensureLabels(env: RuntimeEnv, labels: readonly TrackerLabel[]): Promise<void> {
  const tracker = env.slots.tracker;
  if (!tracker.capabilities.labels) return;
  // a person's command has no record to replay from; ensure_labels is idempotent by what it makes
  const r = await tracker.perform({ kind: "ensure_labels", labels: [...labels] }, { receipt_id: `labels-${ulid()}` });
  if (!r.ok)
    throw failure(
      `the ${tracker.name} tracker cannot define the labels norn puts on items (${labels.map((l) => l.name).join(", ")}): ${r.failure.message}`,
      "create them on the tracker by hand, or fix its access (gh auth status), then norn doctor",
      "labels_undefined",
    );
}
