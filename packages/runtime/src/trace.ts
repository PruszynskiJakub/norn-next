/**
 * The per-tick trace: the facts decide read, every decision and how carrying it out went, written
 * through `ctx.files` under `<dataDir>/trace-v2/`. It is a record for people and for replay, never
 * read back by decide.
 */
import type { KernelFacts } from "@norn/kernel";
import type { HostContext } from "@norn/plugin-api";
import type { ActionOutcome, TickReport } from "./types.ts";

export const TRACE_DIR = "trace-v2";

export function tracePath(ctx: HostContext, tickId: string): string {
  return `${ctx.repo.dataDir}/${TRACE_DIR}/${tickId}.json`;
}

/** Collects one tick's entries; `write` puts them on disk once, so a tick that crashes midway leaves no torn trace. */
export class TickTrace {
  readonly entries: ActionOutcome[] = [];
  facts: KernelFacts | null = null;
  constructor(
    readonly ctx: HostContext,
    readonly tickId: string,
  ) {}

  record(outcome: ActionOutcome): void {
    this.entries.push(outcome);
  }

  /** Written whole and atomically; a trace that cannot be written is the tick's loss, never a reason to undo what it did. */
  async write(report: TickReport): Promise<string | null> {
    const doc = { ...report, at: this.ctx.now(), facts: this.facts };
    try {
      await this.ctx.files.write(tracePath(this.ctx, this.tickId), `${JSON.stringify(doc, null, 2)}\n`);
      return null;
    } catch (e) {
      return `the trace could not be written: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
