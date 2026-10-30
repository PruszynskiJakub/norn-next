/**
 * Reporting verbs (§9.3): `norn done`, `norn ask`, `norn stuck`. One report per run, written
 * as an immutable receipt (P6, S6) that the next tick applies; the agent then ends its turn.
 */
import { relative } from "node:path";
import { type Receipt, type ReceiptOf, ulid } from "@norn/schema";
import { appendReceipt, readHandoff, writeHandoffBody } from "@norn/store";
import type { Context } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { cmd, currentRun, implicitAskOpen, standingReport } from "@norn/core";
import { agentName, loadUnitSession, refuseUnlessAgentWork, reportCommand, type UnitSession } from "./agent-unit.ts";

export interface ReportTarget {
  s: UnitSession;
  run_id: string;
  agent: string;
}

/** Refuse unless this worktree's unit has a live agent run that has not reported yet. */
export function reportTarget(ctx: Context, verb: string): ReportTarget {
  const s = loadUnitSession(ctx, verb);
  const run = currentRun(s);
  if (run) {
    const report = standingReport(s, run.run_id);
    if (report)
      throw refuse(`this run already reported \`${reportCommand(report.receipt)}\` (receipt ${String(report.n).padStart(4, "0")}); exactly one report per run`, "end your turn", "already_reported");
  }
  refuseUnlessAgentWork(s, verb);
  if (!run) throw refuse(`no run of ${s.state.step}#${s.state.attempt} has started in this worktree`, `${cmd.brief()} (it starts the run), do the step, then report`, "no_run");
  return { s, run_id: run.run_id, agent: agentName(s, ctx.config) };
}

/** Common receipt header for an agent report. */
export function reportHeader(ctx: Context, t: ReportTarget) {
  const now = ctx.clock.now();
  return {
    receipt_id: ulid(now),
    run_id: t.run_id,
    step: t.s.state.step,
    attempt: t.s.state.attempt,
    at: ctx.clock.iso(),
    by: "agent" as const,
    who: t.agent,
    ...(t.s.unit.slice ? { slice: t.s.unit.slice } : {}),
  };
}

export function writeReport(t: ReportTarget, receipt: Receipt) {
  // R6.1 (A14): a report while parked on an implicit ask is the agent moving on — an `answer`
  // (`by: "agent"`) closes the ask first, so the tick applies the report at a running cursor
  const ask = implicitAskOpen(t.s);
  if (ask) {
    const answer: ReceiptOf<"answer"> = {
      kind: "answer",
      receipt_id: ulid(Date.parse(receipt.at)),
      run_id: receipt.run_id,
      step: receipt.step,
      attempt: receipt.attempt,
      at: receipt.at,
      by: "agent",
      ...(receipt.who ? { who: receipt.who } : {}),
      ...(receipt.slice !== undefined ? { slice: receipt.slice } : {}),
      answer: `the agent moved on: reported ${reportCommand(receipt)}`,
      ask_receipt_id: ask.receipt.receipt_id,
    };
    appendReceipt(t.s.runsDir, answer);
  }
  const r = appendReceipt(t.s.runsDir, receipt);
  return { n: r.n, file: relative(t.s.worktree, r.file) };
}

/** Progress line of a gate rejection (O6), e.g. `human-qa#1 reject: AC7 shows raw HTML`. */
export function rejectProgress(r: Receipt): string {
  const comment = r.kind === "reject" ? r.comment?.trim() : undefined;
  return `${r.step}#${r.attempt} reject${r.who ? ` by ${r.who}` : ""}: ${comment || "(no comment given)"}`;
}

/** The agent's milestone (O6): one line appended to the Progress section of handoff.md. */
export function appendProgress(runsDir: string, line: string): void {
  const cur = readHandoff(runsDir);
  const body = cur?.body ?? "\n## Goal\n\n## Progress\n\n## Resume\n";
  const text = `- ${line.replace(/\s*\n\s*/g, " ").trim()}`;
  const lines = body.split("\n");
  const at = lines.findIndex((l) => /^##\s+Progress\s*$/.test(l));
  if (at < 0) {
    writeHandoffBody(runsDir, `${body.replace(/\n*$/, "\n")}\n## Progress\n\n${text}\n`);
    return;
  }
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let insert = end;
  while (insert > at + 1 && (lines[insert - 1] ?? "").trim() === "") insert--;
  const block = insert === at + 1 ? ["", text] : [text];
  lines.splice(insert, 0, ...block);
  // keep one blank line before the next section
  const next = insert + block.length;
  if (next < lines.length && (lines[next] ?? "").trim() !== "") lines.splice(next, 0, "");
  writeHandoffBody(runsDir, lines.join("\n"));
}

/** What every successful report answers (§9.3): the receipt, then "end your turn". */
/** The reply to a report: the receipt as data, and markdown that tells the agent to end its turn. */
export function reported(t: ReportTarget, kind: string, written: { n: number; file: string }, extra: Record<string, unknown>, summary: string[]) {
  const value = {
    ok: true,
    unit: t.s.unit.key,
    step: t.s.state.step,
    attempt: t.s.state.attempt,
    run_id: t.run_id,
    kind,
    ...extra,
    receipt: written.file,
    next: "end your turn",
  };
  const markdown = [...summary, `Receipt: \`${written.file}\``, "", "**End your turn now.** Do not report again; norn routes the work from here."];
  return rendered(value, markdown.join("\n"));
}

/** `unit gh-9/01, step implement #1` — which run a report belongs to. */
export const reportedFor = (t: ReportTarget) => `${t.s.unit.key}, step ${t.s.state.step} #${t.s.state.attempt}`;
