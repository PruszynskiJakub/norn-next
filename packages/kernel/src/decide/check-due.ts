/**
 * The check a reported run that may not keep code needs before its report applies, wherever that
 * report is applied: by the unit rules, or ahead of a person's round or move by the story rules.
 */
import type { DecisionOf } from "../model/actions.ts";
import type { UnitFacts } from "../model/facts.ts";
import { launchedRun } from "../model/launched.ts";
import type { RunState } from "../model/run-state.ts";
import type { CompiledStep } from "../workflow/graph.ts";
import type { DecideContext } from "./context.ts";

/**
 * A `done` from the run on the record with no `run.checked` yet. The run is the one live-run accepts
 * reports from, so a launch applied in the same pass as its report is checked too. Only the first
 * `before` receipts are read for the launch and the report, as only they apply next; the check's own
 * receipts are read wherever they are, since a check written behind a person's receipt still answers
 * a report before it. A check cut short runs again under the intent it wrote.
 */
export function checkDue(unit: UnitFacts, state: RunState, step: CompiledStep, ctx: DecideContext, before = unit.receipts.length): DecisionOf<"check_run"> | null {
  const head = unit.receipts.slice(0, before);
  const run = launchedRun(state, head);
  if (!run?.code) return null;
  const report = head.find((r) => r.data.kind === "run.reported" && r.data.run_id === run.id && r.data.verb === "done");
  if (report?.data.kind !== "run.reported") return null;
  const receipts = unit.receipts;
  if (receipts.some((r) => r.data.kind === "run.checked" && r.data.run_id === run.id)) return null;
  const outcome = report.data.outcome;
  const passes = outcome !== undefined && step.agent?.verdict[outcome] === "pass";
  const begun = receipts.find((r) => r.data.kind === "run.checking" && r.data.run_id === run.id);
  const intent = begun
    ? { id: begun.id, data: begun.data }
    : { id: ctx.nextId(), data: { kind: "run.checking" as const, run_id: run.id, step: state.step, attempt: state.attempt } };
  return { kind: "check_run", unit: unit.id, rule: "agent.check", run_id: run.id, code: run.code, passes, intent };
}
