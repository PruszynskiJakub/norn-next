/**
 * Trace (O4, B4, gitignored): `.agents/norn/trace/<YYYY-MM-DD>.jsonl` — one JSONL file
 * per UTC day holding every event (tick, hook, reject, briefing) in append order. Day files keep
 * appends cheap and let old days be deleted wholesale; `trace <unit>` / `why <unit>`
 * filter by unit while reading. Briefings and transcript snapshots are separate files
 * under `briefings/<run_id>/` and `transcripts/<run_id>/`, referenced by trace-relative path.
 */
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { FileError } from "@norn/core";
import { type TickStartTrace, type TickTrace, type TraceEvent, assertValid, validate } from "@norn/schema";
import { atomicWrite, isErrno, readText } from "./fsx.ts";
import { traceDir } from "./paths.ts";

export function eventTime(ev: TraceEvent): string {
  return ev.type === "hook" ? ev.fact.at : ev.at;
}

/** Day file name for an ISO time: `2026-10-23.jsonl` (UTC). */
export function traceFileName(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`bad trace time: ${at}`);
  return `${d.toISOString().slice(0, 10)}.jsonl`;
}

/** Validate and append one event as a single line (O_APPEND, one write). Returns the trace-relative file. */
export function appendTrace(root: string, event: TraceEvent): string {
  assertValid("trace", event);
  const name = traceFileName(eventTime(event));
  const path = join(traceDir(root), name);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return name;
}

export interface TraceQuery {
  /** story key (includes its slices) or slice key */
  unit?: string;
  types?: Array<TraceEvent["type"]>;
  /** ISO lower bound (inclusive) */
  since?: string;
  /** newest N matching events */
  limit?: number;
}

export interface TraceRead {
  /** oldest first */
  events: TraceEvent[];
  /** malformed lines (trace is diagnostic; bad lines are reported and skipped) */
  errors: FileError[];
}

function unitMatches(candidate: string | undefined | null, unit: string): boolean {
  if (!candidate) return false;
  return candidate === unit || candidate.startsWith(`${unit}/`);
}

/**
 * The unit a recorded tick decision belongs to. Intake decisions are keyed by the new story (F5);
 * ticks recorded before that carry unit `*`, with the story key in the action.
 */
export function decisionUnit(d: { unit: string; action: unknown }): string {
  if (d.unit !== "*") return d.unit;
  const a = d.action as { kind?: string; key?: unknown };
  return a.kind === "intake_story" && typeof a.key === "string" ? a.key : d.unit;
}

export function eventMatchesUnit(ev: TraceEvent, unit: string): boolean {
  switch (ev.type) {
    case "tick":
    case "tick.start":
      return ev.decisions.some((d) => unitMatches(decisionUnit(d), unit));
    case "tick.end":
      return false;
    case "hook":
      return unitMatches(ev.fact.slice ?? ev.fact.story, unit) || ev.fact.story === unit;
    case "reject":
    case "briefing":
    case "foreign_commits":
    case "take":
      return unitMatches(ev.unit, unit);
  }
}

function dayFiles(root: string): string[] {
  try {
    return readdirSync(traceDir(root))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
}

export function readTrace(root: string, q: TraceQuery = {}): TraceRead {
  const out: TraceRead = { events: [], errors: [] };
  const sinceDay = q.since ? traceFileName(q.since) : null;
  for (const name of dayFiles(root)) {
    if (sinceDay && name < sinceDay) continue;
    const text = readText(join(traceDir(root), name)) ?? "";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        out.errors.push({ file: `${name}:${i + 1}`, errors: [{ path: "", message: `invalid JSON: ${(e as Error).message}` }] });
        return;
      }
      const v = validate("trace", parsed);
      if (!v.ok) {
        out.errors.push({ file: `${name}:${i + 1}`, errors: v.errors });
        return;
      }
      const ev = v.value;
      if (q.types && !q.types.includes(ev.type)) return;
      if (q.since && eventTime(ev) < q.since) return;
      if (q.unit && !eventMatchesUnit(ev, q.unit)) return;
      out.events.push(ev);
    });
  }
  if (q.limit !== undefined) out.events = out.events.slice(-q.limit);
  return out;
}

/** Latest tick that decided something for `unit` (for `norn why`, O5). */
export function lastTickFor(root: string, unit: string): TickTrace | null {
  const { events } = readTrace(root, { unit, types: ["tick"] });
  return (events.at(-1) as TickTrace | undefined) ?? null;
}

/** A tick by id (for `norn why --tick`). */
export function findTick(root: string, tickId: string): TickTrace | null {
  const { events } = readTrace(root, { types: ["tick"] });
  return (events.find((e) => e.type === "tick" && e.tick_id === tickId) as TickTrace | undefined) ?? null;
}

/**
 * R5.4 (N2): a tick that wrote `tick.start` but neither its `tick` record nor `tick.end` — it died
 * during act. Null when the tick is unknown or finished.
 */
export function findCrashedTick(root: string, tickId: string): TickStartTrace | null {
  const { events } = readTrace(root, { types: ["tick.start", "tick", "tick.end"] });
  const mine = events.filter((e) => (e.type === "tick" || e.type === "tick.start" || e.type === "tick.end") && e.tick_id === tickId);
  const start = mine.find((e) => e.type === "tick.start") as TickStartTrace | undefined;
  return start && !mine.some((e) => e.type !== "tick.start") ? start : null;
}

/** R5.4: ticks that decided something for `unit` and died during act, oldest first. */
export function crashedTicksFor(root: string, unit: string): TickStartTrace[] {
  const { events } = readTrace(root, { types: ["tick.start", "tick", "tick.end"] });
  const ended = new Set(events.filter((e) => e.type === "tick" || e.type === "tick.end").map((e) => (e as { tick_id: string }).tick_id));
  return events.filter((e): e is TickStartTrace => e.type === "tick.start" && !ended.has(e.tick_id) && eventMatchesUnit(e, unit));
}

// ---------------------------------------------------------------- side files (B4, C4)

export const briefingRelPath = (runId: string, id: string) => `briefings/${runId}/${id}.md`;
export const transcriptRelPath = (runId: string, id: string) => `transcripts/${runId}/${id}.txt`;

function safeRel(rel: string): string {
  const n = normalize(rel);
  if (n.startsWith("..") || n.startsWith("/")) throw new Error(`trace path escapes trace dir: ${rel}`);
  return n;
}

/** Write a trace side file atomically; returns its trace-relative path. */
export function writeTraceFile(root: string, rel: string, text: string): string {
  atomicWrite(join(traceDir(root), safeRel(rel)), text);
  return rel;
}
export function readTraceFile(root: string, rel: string): string | null {
  return readText(join(traceDir(root), safeRel(rel)));
}

/** Store the exact briefing of a run (B4). */
export function writeBriefing(root: string, runId: string, id: string, text: string): string {
  return writeTraceFile(root, briefingRelPath(runId, id), text);
}
/** Store a transcript snapshot (C4). */
export function writeTranscriptSnapshot(root: string, runId: string, id: string, text: string): string {
  return writeTraceFile(root, transcriptRelPath(runId, id), text);
}
