/**
 * What the agent verbs (`brief`, `done`, `ask`, `stuck`) share: the run they act for, read from the
 * launch env the runner set, the report id a retry records under once, and the runtime's refusals
 * in the machine contract.
 */
import { RUN_ENV } from "@norn/plugin-api";
import type { ReportRefusal } from "@norn/runtime";
import { type ParsedArgs, opt } from "../command.ts";
import type { CliContext } from "../context.ts";
import { type CliFailure, corruptError, refuse } from "../output.ts";

/** Set by a wrapper that retries a report command, so every retry names the first report. */
export const REPORT_ID_ENV = "NORN_REPORT_ID";

export interface AgentRun {
  unit: string;
  runId: string;
}

/** The run this process works for; only a session norn launched carries it. */
export function agentRunOf(ctx: CliContext, verb: string): AgentRun {
  const unit = ctx.env[RUN_ENV.unit]?.trim();
  const runId = ctx.env[RUN_ENV.run]?.trim();
  if (unit && runId) return { unit, runId };
  throw refuse(
    `norn ${verb} reports for a run norn launched; ${RUN_ENV.unit} and ${RUN_ENV.run} are not set`,
    "run it from the agent session norn started for the step; a person acts on a story with `norn story ...`",
    "no_run_env",
  );
}

/** A runtime refusal as a CliError; a corrupt record is its own exit code. */
export function fromRefusal(r: ReportRefusal): CliFailure {
  return r.code === "corrupt" ? corruptError(r.error, r.do_instead) : refuse(r.error, r.do_instead, r.code ?? "refused");
}

/** 32-bit FNV-1a, hex: a short stable name for a text inside an id. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The report id: the flag, else the env, else one derived from what is reported, so the same
 * command retried after a crash records once while a different report of the run is not taken for it.
 */
export function reportIdOf(ctx: CliContext, args: ParsedArgs, derived: string): string {
  return opt.str(args, "report-id")?.trim() || ctx.env[REPORT_ID_ENV]?.trim() || derived;
}
