/**
 * One hook call, end to end (what `norn hook <harness>` will call): resolve the run from the launch
 * env (plugin-api RUN_ENV), normalize the payload with the harness, append the events to the run's
 * log, reduce the log with the kernel's session reducer, compute the answer, and render it with the
 * harness. A prompt mark is trusted only when the host sent that id and has not seen it before;
 * otherwise the turn is rewritten as the person's.
 *
 * Never throws and never blocks the agent on norn's own failure: an internal failure answers allow
 * (a harness renders null as allow) and records the problem (a `hook.error` event when the log can
 * be written, else in the result).
 */
import { type BriefCommands, type Journal, type ReportHintInput, reduceSession, renderReportHint, renderStepReminder } from "@norn/kernel";
import { type Harness, type HarnessAnswer, type HarnessEvent, type HostContext, type NativeReply, RUN_ENV } from "@norn/plugin-api";
import { liveStepOf, reportOnRecord } from "../live-run.ts";
import { answerFor, MAX_STOP_BLOCKS, owesReportBlock } from "./answer.ts";
import { appendEvents, readEvents } from "./log.ts";
import { claimReceived, claimStopBlock, type Injection, markDelivered, pendingInjections, readSentPrompt } from "./outbox.ts";

export interface IngestDeps {
  ctx: HostContext;
  /** harnesses by the name the hook command names */
  harnesses: Readonly<Record<string, Harness>>;
  /** the unit's record, to learn whether the run reported and whether its step needs a report */
  journal: Journal;
  /** the unit's worktree path */
  worktreeOf(unit: string): string;
  /** paths no agent may write; default the data dir, which holds every unit's run state */
  protectedPaths?: readonly string[];
  /** roots outside the worktree a write may land in, such as the temp folder */
  writableRoots?: readonly string[];
  /** how the report commands are spelled in a stop block's reason */
  commands?: BriefCommands;
}

export interface IngestInput {
  harness: string;
  /** the native hook name */
  hook: string;
  payload: unknown;
  env: Record<string, string | undefined>;
}

export interface IngestResult {
  reply: NativeReply;
  /** what went wrong inside norn; the reply is then allow */
  problems: string[];
  /**
   * Call once `reply` is printed: marks the outbox entries it carries delivered. Marked after the
   * print, so a crash between the two delivers an entry twice rather than never.
   */
  delivered(): Promise<void>;
}

const ALLOW: HarnessAnswer = { kind: "allow" };
const SILENT: NativeReply = { stdout: "", exit_code: 0 };
const nothing = async (): Promise<void> => {};
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function allowWith(harness: Harness | undefined, hook: string, problems: string[]): IngestResult {
  let reply = SILENT;
  try {
    if (harness) reply = harness.respond({ hook, answer: ALLOW });
  } catch (e) {
    problems.push(`${harness?.name} respond threw: ${errorText(e)}`);
  }
  return { reply, problems, delivered: nothing };
}

/**
 * A mark is a claim; the record decides. A norn source survives only when the host sent that id as
 * that source and this is its first arrival; otherwise the turn is the person's, and so is any
 * answer it carried.
 */
async function attribute(ctx: HostContext, unit: string, runId: string, events: HarnessEvent[]): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as HarnessEvent;
    if (e.type !== "turn.started" || e.source === "person" || e.prompt_id === undefined) {
      out.push(e);
      continue;
    }
    const sent = await readSentPrompt(ctx, unit, runId, e.prompt_id);
    if (sent && sent.source === e.source && (await claimReceived(ctx, unit, runId, e.prompt_id))) {
      out.push(e);
      continue;
    }
    const { prompt_id: _untrusted, ...rest } = e;
    out.push({ ...rest, source: "person" });
    const next = events[i + 1];
    if (next?.type === "input.received") {
      out.push({ ...next, by: "pane" });
      i++;
    } else out.push({ type: "input.received", run_id: e.run_id, seq: e.seq, at: e.at, by: "pane" });
  }
  return out;
}

/** An answer a native hook cannot carry renders as nothing: what it held stays queued. */
const carried = (reply: NativeReply): boolean => reply.stdout !== "" || reply.exit_code !== 0;

export async function ingestHook(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const problems: string[] = [];
  const harness = deps.harnesses[input.harness];
  if (!harness) return allowWith(undefined, input.hook, [`no harness named ${input.harness}`]);
  const unit = input.env[RUN_ENV.unit];
  const runId = input.env[RUN_ENV.run];
  // a session norn did not launch (a person's own, in a checkout with the hooks installed) is not norn's to answer
  if (!unit || !runId) return allowWith(harness, input.hook, []);
  const { ctx } = deps;
  try {
    const before = await readEvents(ctx, unit, runId);
    problems.push(...before.problems);
    const normalized = harness.normalize({ hook: input.hook, payload: input.payload, env: input.env, at: ctx.now(), run_id: runId, seq: before.next_seq });
    const events = await attribute(ctx, unit, runId, normalized);
    let fresh = events;
    if (events.length > 0) {
      const appended = await appendEvents(ctx, unit, runId, events);
      if (appended.ok) fresh = appended.value.events;
      else problems.push(`event log: ${appended.failure.message}`);
    }
    const view = reduceSession([...before.events, ...fresh]);

    const read = await deps.journal.readUnit(unit);
    if (!read.ok) problems.push(`record of ${unit}: ${read.failure.message}`);
    const record = read.ok && read.value.corrupt === undefined ? read.value : null;
    if (read.ok && read.value.corrupt !== undefined) problems.push(`record of ${unit} is corrupt: ${read.value.corrupt}`);
    const live = liveStepOf(record?.state ?? null);
    const isLive = live !== null && live.run.id === runId;
    const reported = view.report !== undefined || (record !== null && reportOnRecord(record, runId) !== null);
    const hintInput: ReportHintInput | null = live && { unit, step: live.step, outcomes: live.outcomes, attended: live.attended, ...(deps.commands && { commands: deps.commands }) };

    let pending: Injection[] = [];
    try {
      const queued = await pendingInjections(ctx, unit, runId);
      pending = queued.injections;
      problems.push(...queued.problems);
    } catch (e) {
      problems.push(`outbox: ${errorText(e)}`);
    }
    // an attended run is the person's to end, and a replaced run owes nothing
    const needsReport = isLive && live.agent && !live.attended;
    let stopBlocksSpent = false;
    if (owesReportBlock(fresh, { needsReport, reported, capabilities: harness.capabilities })) {
      try {
        stopBlocksSpent = !(await claimStopBlock(ctx, unit, runId, MAX_STOP_BLOCKS));
      } catch (e) {
        // a refusal that cannot be counted is not given: an uncounted block could repeat without end
        stopBlocksSpent = true;
        problems.push(`stop blocks: ${errorText(e)}`);
      }
    }
    const computed = answerFor(fresh, {
      worktree: deps.worktreeOf(unit),
      protectedPaths: deps.protectedPaths ?? [ctx.repo.dataDir],
      ...(deps.writableRoots && { writableRoots: deps.writableRoots }),
      reported,
      needsReport,
      stopBlocksSpent,
      reportHint: hintInput ? renderReportHint(hintInput) : "",
      pending,
      capabilities: harness.capabilities,
      ...(isLive && live.agent && hintInput && before.events.length > 0 && { reminder: renderStepReminder(hintInput) }),
    });
    const reply = harness.respond({ hook: input.hook, answer: computed.answer ?? ALLOW });
    const delivers = carried(reply) ? computed.delivers : [];
    const answers = pending.filter((p) => delivers.includes(p.id) && p.source === "answer");
    const delivered = async (): Promise<void> => {
      if (delivers.length === 0) return;
      const marked = await markDelivered(ctx, unit, runId, delivers);
      if (!marked.ok) problems.push(`outbox: ${marked.failure.message}`);
      // an answer reached the agent through its context, never a typed prompt, so no hook sees it arrive
      const received: HarnessEvent[] = answers.map((a) => ({ type: "input.received", run_id: runId, seq: 0, at: ctx.now(), by: "norn", ...(a.input_id && { id: a.input_id }) }));
      if (received.length > 0) {
        const appended = await appendEvents(ctx, unit, runId, received);
        if (!appended.ok) problems.push(`event log: ${appended.failure.message}`);
      }
    };
    return { reply, problems, delivered };
  } catch (e) {
    problems.push(`ingest of ${input.harness} ${input.hook} failed: ${errorText(e)}`);
    try {
      const { next_seq } = await readEvents(ctx, unit, runId);
      await appendEvents(ctx, unit, runId, [{ type: "hook.error", run_id: runId, seq: next_seq, at: ctx.now(), hook: input.hook, message: problems.at(-1) as string }]);
    } catch {
      // the problem is already in the result, which is all a failing disk leaves
    }
    return allowWith(harness, input.hook, problems);
  }
}
