/**
 * The story's slices step. Decide reads the slice plan the host parsed from the slice files' front
 * matter (never their text) and the slices' run states: it starts every slice whose dependencies are
 * done, ends the step `done` once every slice is, and `stuck` when no slice can move without a person
 * (no slices, every active one stuck, or none startable). The step's own route decides what follows.
 */
import type { Decision, SliceStart } from "../model/actions.ts";
import type { SlicePlan, StoryFacts, UnitFacts } from "../model/facts.ts";
import type { RunState } from "../model/run-state.ts";
import type { DecideContext } from "./context.ts";
import { applyWith, loadProblem, park } from "./story-unit.ts";

type PlannedSlice = SlicePlan["slices"][number];

export function decideSlices(story: StoryFacts, u: UnitFacts, state: RunState, ctx: DecideContext): Decision {
  const finish = (outcome: "done" | "stuck", rule: string, detail: string): Decision =>
    applyWith(u, state, { kind: "step.finished", step_kind: "slices", outcome, detail, step: state.step, attempt: state.attempt }, rule, ctx);
  const plan = story.plan;
  if (plan?.invalid) return park(u.id, u, state, "slices.plan_invalid", "stuck", `the slice files failed validation: ${plan.invalid}`, ctx);
  if (!plan?.slices.length) return finish("stuck", "slices.none", "no slice files");

  const unitOf = (id: string) => story.units.find((x) => x.id === id);
  const isDone = (s: PlannedSlice) => unitOf(s.unit)?.state?.ended === "done";
  const done = new Set(plan.slices.filter(isDone).map((s) => s.unit));
  if (done.size === plan.slices.length) return finish("done", "slices.done", `${done.size} slice(s) done`);

  const started = (s: PlannedSlice) => {
    const x = unitOf(s.unit);
    return x !== undefined && (x.state !== null || x.corrupt !== undefined || x.receipts.length > 0);
  };
  const pending = plan.slices.filter((s) => !started(s));
  const startable = pending.filter((s) => s.depends_on.every((d) => done.has(d)));
  const active = plan.slices.filter((s) => started(s) && !done.has(s.unit));

  if (startable.length) {
    const slices: SliceStart[] = [];
    for (const s of startable) {
      const name = s.workflow ?? ctx.config.sliceWorkflow;
      const load = ctx.workflows.byName[name];
      const problem = loadProblem(name, load);
      if (problem || !load?.ok) return park(u.id, u, state, "slices.workflow_invalid", "workflow", `slice ${s.unit}: ${problem ?? `workflow ${name} is not loaded`}`, ctx);
      slices.push({ unit: s.unit, workflow: name, hash: load.workflow.pinned.hash });
    }
    return { kind: "start_slices", unit: u.id, rule: "slices.start", slices };
  }

  // a running or parked slice still moves; only slices that ended stuck or corrupt cannot without a person
  const stuck = active.filter((s) => {
    const x = unitOf(s.unit);
    return x?.corrupt !== undefined || (x?.receipts.length === 0 && (x.state?.ended === "stuck" || x.state?.ended === "corrupt"));
  });
  if (active.length && stuck.length === active.length) {
    const named = stuck.map((s) => {
      const x = unitOf(s.unit);
      return x?.corrupt !== undefined || x?.state?.ended === "corrupt" ? `${s.unit} corrupt` : `${s.unit} stuck: ${x?.state?.ended_reason ?? "?"}`;
    });
    return finish("stuck", "slices.slice_stuck", named.join("; "));
  }
  if (!active.length) {
    const waits = pending.map((s) => `${s.unit} waits for ${s.depends_on.filter((d) => !done.has(d)).join(", ")}`);
    return finish("stuck", "slices.blocked", `no slice can start: ${waits.join("; ")}`);
  }
  return { kind: "noop", unit: u.id, rule: "slices.wait", reason: `${done.size}/${plan.slices.length} slice(s) done` };
}
