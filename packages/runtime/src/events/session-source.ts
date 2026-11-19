/**
 * SessionSource over the event log: each run's events reduced and classified by the kernel at the
 * tick's time, and a session the runner reports dead without a `session.ended` read as ended (died).
 * A process that ended before its first event reads ended too, with the head of its log as the error:
 * an agent that never got going (a bad flag, a missing login) sends no event at all, and without this
 * its run would wait out the silent window and be retried with no reason given.
 * A log with bad files still classifies from its valid batches; the problems go to the tick.
 */
import { type ClassifyOptions, classifySession, reduceSession, type SessionFacts } from "@norn/kernel";
import type { HarnessEvent, HostContext } from "@norn/plugin-api";
import type { SessionSource } from "../types.ts";
import { readEvents } from "./log.ts";

export interface EventLogSessionSourceOptions {
  ctx: HostContext;
  classify: ClassifyOptions;
  /**
   * Whether the launcher's handle (the run's recorded session) still runs; absent, or a probe that
   * cannot answer, never reads as dead.
   */
  alive?(handle: string): Promise<boolean | null>;
  /** the head of the log the handle's process wrote, or null when it left none */
  output?(handle: string): Promise<string | null>;
  /** problems found while reading, for the tick to report */
  onProblem?(unit: string, runId: string, problem: string): void;
}

export class EventLogSessionSource implements SessionSource {
  constructor(readonly opts: EventLogSessionSourceOptions) {}

  async facts(unit: string, runId: string, session?: string): Promise<SessionFacts | null> {
    const { ctx } = this.opts;
    const read = await readEvents(ctx, unit, runId);
    for (const p of read.problems) this.opts.onProblem?.(unit, runId, p);
    const now = ctx.now();
    if (read.events.length === 0 && read.problems.length === 0) {
      // no event and a process still there (or one the probe cannot tell about): decide's own grace tells a slow start from a launch that never produced a session
      if (session === undefined || !this.opts.alive || (await this.probe(session)) !== false) return null;
      return this.endedUnheard(runId, session, now);
    }
    let events: HarnessEvent[] = read.events;
    if (session !== undefined && this.opts.alive && reduceSession(events).ended === undefined && (await this.probe(session)) === false)
      // an agent killed or crashed sends no end of its own; the runner's word stands in for it, and only in this read
      events = [...events, { type: "session.ended", run_id: runId, seq: read.next_seq, at: now, reason: "crash" }];
    const facts = classifySession(reduceSession(events), now, this.opts.classify);
    // a bad file is named, never read past silently: it travels with the facts it may have changed
    if (read.problems.length > 0) facts.errors = [...facts.errors, ...read.problems];
    return facts;
  }

  private async endedUnheard(runId: string, session: string, now: string): Promise<SessionFacts> {
    const facts = classifySession(reduceSession([{ type: "session.ended", run_id: runId, seq: 0, at: now, reason: "crash" }]), now, this.opts.classify);
    let head: string | null = null;
    try {
      head = (await this.opts.output?.(session)) ?? null;
    } catch {
      head = null;
    }
    facts.error = head ? `the agent exited before its first event: ${head}` : "the agent exited before its first event and left no output";
    return facts;
  }

  private async probe(handle: string): Promise<boolean | null> {
    try {
      return (await this.opts.alive?.(handle)) ?? null;
    } catch {
      return null;
    }
  }
}
