/** Per-unit timeline (O4): receipts and trace events merged, time-ordered, one line each. */
import type { NumberedReceipt } from "@norn/core";
import type { Receipt, TraceEvent } from "@norn/schema";
import type { TimelineEntry } from "./types.ts";

const MAX = 140;

/** Collapse whitespace and cut to one short line. */
export function oneLine(text: string, max = MAX): string {
  return cut(text, max);
}

function cut(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const at = (r: Receipt) => `${r.step}#${r.attempt}`;

/** One-line summary of a receipt (cut to `max` chars; `Infinity` keeps it whole). */
export function receiptSummary(r: Receipt, max = MAX): string {
  const oneLine = (t: string) => cut(t, max);
  switch (r.kind) {
    case "done": {
      const f = r.findings?.length ? ` (${r.findings.length} finding${r.findings.length === 1 ? "" : "s"})` : "";
      return oneLine(`done ${r.outcome} at ${at(r)}${f}${r.handoff ? ` — ${r.handoff}` : ""}`);
    }
    case "ask":
      return oneLine(`ask at ${at(r)}${r.implicit ? " (implicit)" : ""}: ${r.question}`);
    case "stuck":
      return oneLine(`stuck at ${at(r)}: ${r.reason}`);
    case "answer":
      return oneLine(`answer: ${r.answer}`);
    case "approve":
      return oneLine(`approve ${r.step}${r.comment ? `: ${r.comment}` : ""}`);
    case "reject":
      return oneLine(`reject ${r.step}${r.comment ? `: ${r.comment}` : ""}`);
    case "unstick": {
      const parts = [r.to ? `to ${r.to}` : null, r.reset?.length ? `reset ${r.reset.join(", ")}` : null].filter(Boolean);
      return oneLine(`unstick${parts.length ? ` ${parts.join(", ")}` : ""}${r.comment ? `: ${r.comment}` : ""}`);
    }
    case "mode":
      return `mode ${r.previous} → ${r.mode}`;
    case "check": {
      const why = r.reason === "timeout" ? "timeout" : `exit ${r.exit_code}`;
      return oneLine(`check ${r.outcome} at ${at(r)}: ${r.command} (${why}, ${Math.round(r.duration_ms / 100) / 10}s)`);
    }
    case "started":
      return oneLine(`started ${r.step}#${r.attempt} (${r.how}${r.agent ? `, ${r.agent}` : ""}${r.retry ? ", retry" : ""})`);
    case "classify": {
      const c = r.counter ? ` [${r.counter.name} ${r.counter.value}/${r.counter.max}]` : "";
      return oneLine(`classify ${r.step}.${r.outcome} by ${r.rule} → ${r.route}${c}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    case "workflow":
      return oneLine(`workflow switched to ${r.name} at ${r.to}`);
    case "take":
      return oneLine(`taken by ${r.who ?? r.by}${r.previous_holder ? ` from ${r.previous_holder}${r.forced ? " (forced)" : r.expired ? " (expired claim)" : ""}` : " (claim was free)"}`);
  }
}

export function receiptEntry(nr: NumberedReceipt): TimelineEntry {
  return { at: nr.receipt.at, source: "receipt", kind: nr.receipt.kind, summary: receiptSummary(nr.receipt), ref: nr.file.split("/").at(-1) ?? String(nr.n) };
}

/** Unit key a trace event belongs to, per decision for ticks (exact match, not prefix). */
export function traceEntries(ev: TraceEvent, unit: string, max = MAX): TimelineEntry[] {
  const oneLine = (t: string) => cut(t, max);
  switch (ev.type) {
    case "tick":
      return ev.decisions
        .filter((d) => d.unit === unit)
        .map((d) => ({
          at: ev.at,
          source: "tick" as const,
          kind: d.action.kind,
          summary: oneLine(`tick ${d.rule} → ${d.action.kind}${d.result.ok ? "" : ` failed: ${d.result.error ?? "error"}`}`),
          ref: ev.tick_id,
        }));
    case "hook": {
      const f = ev.fact;
      if ((f.slice ?? f.story) !== unit) return [];
      const extra = f.tool ?? f.command ?? f.message;
      const blocked = ev.blocked ? ` blocked${ev.reason ? `: ${ev.reason}` : ""}` : "";
      return [{ at: f.at, source: "hook", kind: f.event, summary: oneLine(`${f.agent} ${f.event}${extra ? ` ${extra}` : ""}${blocked}`), ref: ev.id }];
    }
    case "reject":
      if (ev.unit !== unit) return [];
      return [{ at: ev.at, source: "reject", kind: "reject", summary: oneLine(`rejected ${ev.source}: ${ev.reason}`), ref: ev.id }];
    case "briefing":
      if (ev.unit !== unit) return [];
      return [{ at: ev.at, source: "briefing", kind: "briefing", summary: oneLine(`briefing for run ${ev.run_id} at ${ev.step}#${ev.attempt}: ${ev.briefing}`), ref: ev.briefing }];
    case "foreign_commits":
      if (ev.unit !== unit) return [];
      // Q6: commits on norn's branches that norn did not make (a hand merge, a conflict fix). Placed
      // at the commit time; the tick that noticed them may be much later.
      return ev.commits.map((c) => ({ at: c.at || ev.at, source: "foreign" as const, kind: "foreign_commit", summary: oneLine(`foreign commit on ${c.branch} (not made by norn): ${c.sha.slice(0, 12)} ${c.subject} (${c.author})`), ref: c.sha }));
    case "take":
      // R10.1: a takeover, forced or not, with the claim it replaced
      if (ev.unit !== unit) return [];
      return [{ at: ev.at, source: "take", kind: "take", summary: oneLine(`take by ${ev.holder}${ev.previous_holder ? ` from ${ev.previous_holder}${ev.forced ? " (forced)" : ev.expired ? " (expired claim)" : ""}` : " (claim was free)"}`), ref: ev.id }];
  }
}

/** Unit keys a trace event mentions (for one-pass bucketing). */
export function traceUnits(ev: TraceEvent): string[] {
  switch (ev.type) {
    case "tick":
      return [...new Set(ev.decisions.map((d) => d.unit))];
    case "hook": {
      const k = ev.fact.slice ?? ev.fact.story;
      return k ? [k] : [];
    }
    case "reject":
    case "briefing":
    case "foreign_commits":
    case "take":
      return [ev.unit];
  }
}

/** Merge and order by time; ties keep receipts first, then trace in append order. */
export function mergeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries
    .map((e, i) => ({ e, i, t: Date.parse(e.at) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}
