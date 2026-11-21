/**
 * Everything the kernel's renderBrief needs beyond the decision's BriefInputs, gathered from the
 * unit's record and its pinned workflow: the outcomes `done` may report at the step, the handoff
 * path, the rework text (a red check's output tail, review findings) when the run reworks one, the
 * story's gate rulings and the unit's steps this round, and for a retry how the session it replaces
 * ended, the questions the sessions it replaces asked and the answers a person gave them.
 * Shared by the launcher (the brief a launch sends) and `brief(unit)` (what `norn brief` prints), so
 * both say the same.
 */
import type { AnsweredAsk, BriefInputs, BriefRenderInput, CompiledStep, KernelReceipt, LoadedWorkflow, RunState, UnitJournal } from "@norn/kernel";
import { wantsCriteria } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import { readEvents } from "./events/log.ts";
import { historyOf, rulingsOf } from "./input-history.ts";
import { findingsList, INPUTS_NOTE, materializeInputs, specFolder, unsettledCriteria, worktreeOf } from "./inputs.ts";
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
      return `\`${d.step ?? "a step"}\` reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${d.text ? `: ${d.text}` : "."}${findingsList(d.findings)}${unsettledCriteria(d.criteria)}`;
    case "step.finished":
      return `\`${d.step ?? d.step_kind}\` ended \`${d.outcome}\`.`;
    default:
      return undefined;
  }
}

/** The runs `runId` replaced in fresh sessions, newest first, by the `retry_of` its start receipts name. */
function replacedRuns(receipts: readonly KernelReceipt[], runId: string): { runs: string[]; startedAt: number } {
  const startOf = (id: string) => receipts.find((r) => r.data.kind === "run.started" && r.data.run_id === id);
  const own = startOf(runId);
  const runs: string[] = [];
  let r = own;
  while (r?.data.kind === "run.started" && r.data.retry_of !== undefined && !runs.includes(r.data.retry_of)) {
    runs.push(r.data.retry_of);
    r = startOf(r.data.retry_of);
  }
  return { runs, startedAt: own?.seq ?? Number.POSITIVE_INFINITY };
}

/**
 * The session run `runId` replaced, when it is a retry: the run and the nudges it was sent. Why decide
 * retried it (dead, or quiet past its nudges) is on no receipt, so the notice claims no more.
 */
function retryOf(receipts: readonly KernelReceipt[], runId: string): string | undefined {
  const own = receipts.find((r) => r.data.kind === "run.started" && r.data.run_id === runId);
  if (own?.data.kind !== "run.started" || own.data.retry_of === undefined) return undefined;
  const old = own.data.retry_of;
  const nudges = receipts.filter((r) => r.data.kind === "nudge.sent" && r.data.run_id === old).length;
  return `run \`${old}\`${nudges > 0 ? `, nudged ${nudges} time${nudges === 1 ? "" : "s"}` : ""}`;
}

/**
 * The answers the runs a retry replaces were given, each with its question: a session's own ask by
 * its input id, else the last ask a replaced run reported before the answer. A fresh session sees
 * nothing of the old one, and an answer that ended up undelivered reached nobody else.
 */
async function answeredAsks(env: RuntimeEnv, record: UnitJournal, runId: string): Promise<AnsweredAsk[]> {
  const { runs, startedAt } = replacedRuns(record.receipts, runId);
  if (runs.length === 0) return [];
  const replaced = new Set(runs);
  const asked = new Map<string, string>();
  for (const run of runs) for (const e of (await readEvents(env.ctx, record.unit, run)).events) if (e.type === "input.requested") asked.set(e.id, e.question);
  const out: AnsweredAsk[] = [];
  let reported: string | undefined;
  for (const r of record.receipts) {
    if (r.seq >= startedAt) break;
    const d = r.data;
    if (d.kind === "run.reported" && d.verb === "ask" && replaced.has(d.run_id)) reported = d.text;
    if (d.kind !== "answer.sent") continue;
    const question = asked.get(d.input_id) ?? reported;
    out.push(question === undefined ? { answer: d.text } : { question, answer: d.text });
    reported = undefined;
  }
  return out;
}

/**
 * Whether a person works in the run's session: as its start receipt says, since an attended step may
 * be started headless (no runner for a pane, or `norn run start` on a headless executor), and a
 * session nobody reads must ask through the ask verb. The step's own word holds when the run is unknown.
 */
function attendedRun(record: UnitJournal, runId: string | undefined, step: boolean): boolean {
  if (runId === undefined) return step;
  if (record.state?.run?.id === runId) return record.state.run.attended;
  // a launch not yet applied is on the record only as its start receipt
  const own = record.receipts.findLast((r) => r.data.kind === "run.started" && r.data.run_id === runId);
  return own?.data.kind === "run.started" ? own.data.attended : step;
}

function agentStep(workflow: LoadedWorkflow, step: string): CompiledStep | null {
  const s = workflow.graph.steps[step];
  return s?.agent ? s : null;
}

/**
 * The render input for `brief` at the unit as `record` reads, for run `runId` when known (a retry's
 * brief then carries the answers its replaced runs were given); refused when its workflow or step is
 * gone. The step's inputs are written into the unit's worktree first (inputs.ts), so the brief names
 * paths the agent can read; when they cannot be written the brief falls back to their bare names
 * rather than holding the run back.
 */
export async function renderInputFrom(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, runId?: string, worktree?: string): Promise<PluginResult<BriefRenderInput>> {
  const workflow = workflowOf(env, record.state, brief);
  if (!workflow) return fail("not_found", `workflow ${brief.workflow} (${brief.hash}) is neither loaded nor pinned by ${record.unit}`, false);
  const step = agentStep(workflow, brief.step);
  if (!step?.agent) return fail("invalid", `${brief.step} is not an agent step of workflow ${brief.workflow}`, false);
  const spec = step.agent;
  const outcomes = reportableOutcomes(step.outcomes);
  const means: Record<string, string> = {};
  for (const o of outcomes) if (spec.means[o] !== undefined) means[o] = spec.means[o];
  const rework = brief.rework_from === undefined ? undefined : await reworkText(env, record.unit, record.receipts.find((r) => r.seq === brief.rework_from));
  const answered = runId === undefined ? [] : await answeredAsks(env, record, runId);
  const retry = runId === undefined ? undefined : retryOf(record.receipts, runId);
  const rulings = await rulingsOf(env, record, brief.rework_from);
  const history = historyOf(record);
  const made = await materializeInputs(env, record, brief, worktree ?? worktreeOf(env, record.unit));
  const inputs = made.ok ? made.value : null;
  const produced = Object.entries(spec.produces ?? {}).map(([name, p]) => ({ name, path: `${specFolder(record.unit)}/${p.file}`, outcomes: [...p.on] }));
  return ok({
    brief,
    unit: record.unit,
    outcomes,
    instructions: spec.instructions,
    ...(step.description !== undefined && { description: step.description }),
    ...(Object.keys(means).length > 0 && { means }),
    ...(wantsCriteria(spec) && { criteria: { required: spec.criteria, verdict: { ...spec.verdict } } }),
    ...(attendedRun(record, runId, spec.attended) && { attended: true }),
    ...(Object.keys(spec.hand_back).length > 0 && { handBack: { ...spec.hand_back } }),
    ...(produced.length > 0 && { produced }),
    ...(rework !== undefined && { rework }),
    ...(answered.length > 0 && { answered }),
    ...(retry !== undefined && { retry }),
    ...(rulings.length > 0 && { rulings }),
    ...(history.length > 0 && { history }),
    ...(inputs?.story !== undefined && { story: inputs.story }),
    ...(inputs !== null && inputs.inputs.length > 0 && { inputs: inputs.inputs, inputsNote: INPUTS_NOTE }),
    ...(inputs?.handoff !== undefined && { handoff: inputs.handoff }),
  });
}

export async function briefRenderInput(env: RuntimeEnv, unit: string, brief: BriefInputs, runId?: string, worktree?: string): Promise<PluginResult<BriefRenderInput>> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return read;
  if (read.value.corrupt !== undefined) return fail("invalid", `${unit} is corrupt: ${read.value.corrupt}`, false);
  return renderInputFrom(env, read.value, brief, runId, worktree);
}
