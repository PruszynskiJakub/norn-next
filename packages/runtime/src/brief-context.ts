/**
 * Everything the kernel's renderBrief needs beyond the decision's BriefInputs, gathered from the
 * unit's record and its pinned workflow: the outcomes `done` may report at the step, the handoff
 * path, and the rework text (a red check's output tail, review findings) when the run reworks one.
 * Shared by the launcher (the brief a launch sends) and `brief(unit)` (what `norn brief` prints), so
 * both say the same.
 */
import type { BriefInputs, BriefRenderInput, CompiledStep, KernelReceipt, LoadedWorkflow, RunState, UnitJournal } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import { reportableOutcomes } from "./live-run.ts";
import { readStepRun } from "./step-runs.ts";
import { loadPinned } from "./workflows.ts";

/** The workflow a brief names, by its hash: the pack's when it still loads to it, else the unit's pinned copy. */
function workflowOf(env: RuntimeEnv, state: RunState | null, brief: BriefInputs): LoadedWorkflow | null {
  const load = env.workflows[brief.workflow];
  if (load?.ok && load.workflow.pinned.hash === brief.hash) return load.workflow;
  if (state && state.workflow.hash === brief.hash) return loadPinned(env, state.workflow);
  return null;
}

/** The text of what sent the work back, from the receipt the brief names. */
async function reworkText(env: RuntimeEnv, unit: string, receipt: KernelReceipt | undefined): Promise<string | undefined> {
  if (!receipt) return undefined;
  const d = receipt.data;
  switch (d.kind) {
    case "check.finished": {
      const head = `Check \`${d.step ?? "check"}\` exited ${d.exit} (\`${d.outcome}\`).`;
      const record = await readStepRun(env.ctx, unit);
      const tail = record && record.run_id === d.run_id ? record.output?.trimEnd() : undefined;
      return tail ? `${head} The end of its output:\n\n\`\`\`\n${tail}\n\`\`\`` : head;
    }
    case "gate.decided":
      return `\`${d.step ?? "the gate"}\` was decided \`${d.outcome}\` by ${d.by}${d.reason ? `: ${d.reason}` : "."}`;
    case "run.reported":
      return `\`${d.step ?? "a step"}\` reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${d.text ? `: ${d.text}` : "."}`;
    case "step.finished":
      return `\`${d.step ?? d.step_kind}\` ended \`${d.outcome}\`.`;
    default:
      return undefined;
  }
}

function agentStep(workflow: LoadedWorkflow, step: string): CompiledStep | null {
  const s = workflow.graph.steps[step];
  return s?.agent ? s : null;
}

/** The render input for `brief` at the unit as `record` reads; refused when its workflow or step is gone. */
export async function renderInputFrom(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs): Promise<PluginResult<BriefRenderInput>> {
  const workflow = workflowOf(env, record.state, brief);
  if (!workflow) return fail("not_found", `workflow ${brief.workflow} (${brief.hash}) is neither loaded nor pinned by ${record.unit}`, false);
  const step = agentStep(workflow, brief.step);
  if (!step?.agent) return fail("invalid", `${brief.step} is not an agent step of workflow ${brief.workflow}`, false);
  const spec = step.agent;
  const outcomes = reportableOutcomes(step.outcomes);
  const means: Record<string, string> = {};
  for (const o of outcomes) if (spec.means[o] !== undefined) means[o] = spec.means[o];
  const rework = brief.rework_from === undefined ? undefined : await reworkText(env, record.unit, record.receipts.find((r) => r.seq === brief.rework_from));
  return ok({
    brief,
    unit: record.unit,
    outcomes,
    instructions: spec.instructions,
    ...(step.description !== undefined && { description: step.description }),
    ...(Object.keys(means).length > 0 && { means }),
    ...(spec.attended && { attended: true }),
    ...(rework !== undefined && { rework }),
  });
}

export async function briefRenderInput(env: RuntimeEnv, unit: string, brief: BriefInputs): Promise<PluginResult<BriefRenderInput>> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return read;
  if (read.value.corrupt !== undefined) return fail("invalid", `${unit} is corrupt: ${read.value.corrupt}`, false);
  return renderInputFrom(env, read.value, brief);
}
