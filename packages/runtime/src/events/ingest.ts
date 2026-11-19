/**
 * One hook call, end to end (what `norn hook <harness>` will call): resolve the run from the launch
 * env (plugin-api RUN_ENV), normalize the payload with the harness, reduce the log and the new
 * events with the kernel's session reducer, compute the answer, render it with the harness, and
 * append the events to the run's log (a refused stop without its turn end). A prompt mark is trusted only when the host sent that id and has not seen it before;
 * otherwise the turn is rewritten as the person's.
 *
 * Never throws and never blocks the agent on norn's own failure: an internal failure answers allow
 * (a harness renders null as allow) and records the problem (a `hook.error` event when the log can
 * be written, else in the result). The one exception is a write the guard never judged: allowed, it
 * could land in another unit's worktree or norn's run state, so it is denied with the reason.
 */
import { type BriefCommands, type Journal, type ReportHintInput, reduceSession, renderReportHint, renderStepReminder } from "@norn/kernel";
import { type Harness, type HarnessAnswer, type HarnessEvent, type HostContext, type NativeReply, RUN_ENV } from "@norn/plugin-api";
import { liveStepOf, reportOnRecord } from "../live-run.ts";
import { type AnswerContext, answerFor, MAX_STOP_BLOCKS, owesReportBlock, resolvePath } from "./answer.ts";
import { appendEvents, readEvents } from "./log.ts";
import { realPath } from "./real-path.ts";
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
  /**
   * whether another machine now holds the claim of `unit`'s story: its report is refused here
   * (`claim_moved`), so a stop must not wait for one
   */
  claimMoved?(unit: string): Promise<boolean>;
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

/** The worktree, the protected paths and each write's path with their links followed, for the guard's second look. */
async function realPaths(ctx: HostContext, worktree: string, protectedPaths: readonly string[], events: readonly HarnessEvent[]): Promise<AnswerContext["real"]> {
  const folded = resolvePath("/", worktree);
  const writes: Record<string, string> = {};
  for (const e of events) if (e.type === "tool.requested" && e.kind === "write" && e.detail) writes[resolvePath(folded, e.detail)] = await realPath(ctx.files, folded, e.detail);
  if (Object.keys(writes).length === 0) return undefined;
  return {
    worktree: await realPath(ctx.files, "/", folded),
    protectedPaths: await Promise.all(protectedPaths.map((p) => realPath(ctx.files, "/", p))),
    writes,
  };
}

function allowWith(harness: Harness | undefined, hook: string, problems: string[]): IngestResult {
  let reply = SILENT;
  try {
    if (harness) reply = harness.respond({ hook, answer: ALLOW });
  } catch (e) {
    problems.push(`${harness?.name} respond threw: ${errorText(e)}`);
  }
  return { reply, problems, delivered: nothing };
}

/** The events of a hook whose ingest failed, for the guard's sake: normalized again when the first pass never got that far. */
function eventsOf(harness: Harness, input: IngestInput, at: string, runId: string, normalized: HarnessEvent[] | null): HarnessEvent[] {
  if (normalized) return normalized;
  try {
    return harness.normalize({ hook: input.hook, payload: input.payload, env: input.env, at, run_id: runId, seq: 0 });
  } catch {
    return [];
  }
}

const writes = (events: readonly HarnessEvent[]): boolean => events.some((e) => e.type === "tool.requested" && e.kind === "write");

function denyWith(harness: Harness, hook: string, problems: string[]): IngestResult {
  const reason = `norn: this write was not checked against the unit's worktree, because norn failed (${problems.at(-1)}). Try it again; if it keeps failing, tell the person.`;
  try {
    return { reply: harness.respond({ hook, answer: { kind: "deny", reason } }), problems, delivered: nothing };
  } catch (e) {
    problems.push(`${harness.name} respond threw: ${errorText(e)}`);
    return { reply: SILENT, problems, delivered: nothing };
  }
}

/**
 * The reply to a hook norn failed before it could ingest at all (no config, a plugin that would not
 * load): the same rule as an ingest that failed inside, so a guarded write is denied with `problem`
 * as its reason and anything else is let through. Never throws.
 */
export function failedHookReply(harness: Harness, input: IngestInput, problem: string, at: string): NativeReply {
  const problems = [problem];
  if (harness.capabilities.denyTool && writes(eventsOf(harness, input, at, input.env[RUN_ENV.run] ?? "", null))) return denyWith(harness, input.hook, problems).reply;
  return allowWith(harness, input.hook, problems).reply;
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
  let normalized: HarnessEvent[] | null = null;
  try {
    const before = await readEvents(ctx, unit, runId);
    problems.push(...before.problems);
    normalized = harness.normalize({ hook: input.hook, payload: input.payload, env: input.env, at: ctx.now(), run_id: runId, seq: before.next_seq });
    const fresh = await attribute(ctx, unit, runId, normalized);
    const view = reduceSession([...before.events, ...fresh]);

    const read = await deps.journal.readUnit(unit);
    if (!read.ok) problems.push(`record of ${unit}: ${read.failure.message}`);
    const record = read.ok && read.value.corrupt === undefined ? read.value : null;
    if (read.ok && read.value.corrupt !== undefined) problems.push(`record of ${unit} is corrupt: ${read.value.corrupt}`);
    const live = liveStepOf(record?.state ?? null, record?.unapplied ?? []);
    const isLive = live !== null && live.run.id === runId;
    // the receipt is written before the event, so a readable record has the last word: a report the
    // kernel rejected leaves its event in the log, and must not let the turn end unreported
    const reported = record !== null ? reportOnRecord(record, runId) !== null : view.report !== undefined;
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
    let needsReport = isLive && live.agent && !live.attended;
    // asked only when a stop would block: a moved claim refuses every report, so a block would never end
    if (owesReportBlock(fresh, { needsReport, reported, capabilities: harness.capabilities }) && deps.claimMoved) {
      try {
        if (await deps.claimMoved(unit)) needsReport = false;
      } catch (e) {
        problems.push(`claim: ${errorText(e)}`);
      }
    }
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
    const worktree = deps.worktreeOf(unit);
    const protectedPaths = deps.protectedPaths ?? [ctx.repo.dataDir];
    const real = await realPaths(ctx, worktree, protectedPaths, fresh);
    const computed = answerFor(fresh, {
      worktree,
      protectedPaths,
      ...(real && { real }),
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
    // a stop the agent was refused is a turn that goes on: logged as ended, the session would read as
    // quiet and be nudged while the agent works on the reason it was given
    const blocked = computed.answer?.kind === "block" && carried(reply);
    const logged = blocked ? fresh.filter((e) => e.type !== "turn.ended") : fresh;
    if (logged.length > 0) {
      const appended = await appendEvents(ctx, unit, runId, logged);
      if (!appended.ok) problems.push(`event log: ${appended.failure.message}`);
    }
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
    if (harness.capabilities.denyTool && writes(eventsOf(harness, input, ctx.now(), runId, normalized))) return denyWith(harness, input.hook, problems);
    return allowWith(harness, input.hook, problems);
  }
}
