/**
 * Trace (O4, B4, gitignored): `.agents/norn/trace/<YYYY-MM-DD>.jsonl` — one JSONL file
 * per UTC day holding every event (tick, hook, reject, briefing) in append order. Day files keep
 * appends cheap and let old days be deleted wholesale; `trace <unit>` / `why <unit>`
 * filter by unit while reading. Briefings and transcript snapshots are separate files
 * under `briefings/<run_id>/` and `transcripts/<run_id>/`, referenced by trace-relative path.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { FileError } from "@norn/core";
import { type HookFact, type TickStartTrace, type TickTrace, type TraceEvent, assertValid, ulid, ulidTime, validate } from "@norn/schema";
import { appendDurable, atomicWrite, isErrno, readText, safeUnlink } from "./fsx.ts";
import { traceDir } from "./paths.ts";

function eventTime(ev: TraceEvent): string {
  return ev.type === "hook" ? ev.fact.at : ev.at;
}

/** Day file name for an ISO time: `2026-10-23.jsonl` (UTC). */
function traceFileName(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`bad trace time: ${at}`);
  return `${d.toISOString().slice(0, 10)}.jsonl`;
}

/**
 * Validate and append one event as a single line (O_APPEND, one write). Returns the trace-relative file.
 * Only `tick.start` is fsynced (R5.4): it is the line that explains a tick that died during act, so it
 * must reach disk before act starts. Every other event is diagnostic and skips the fsync.
 */
export function appendTrace(root: string, event: TraceEvent): string {
  assertValid("trace", event);
  const name = traceFileName(eventTime(event));
  const path = join(traceDir(root), name);
  const line = `${JSON.stringify(event)}\n`;
  if (event.type === "tick.start") appendDurable(path, line);
  else {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line);
  }
  return name;
}

/** A trace event stamped with its own `id` and `at`: every type but tick, tick.start, tick.end and hook. */
type StampedTrace = Extract<TraceEvent, { id: string; at: string }>;
type StampedOf<T extends StampedTrace["type"]> = Extract<StampedTrace, { type: T }>;

/**
 * One stamped trace event of `type`: `id` is a ulid of `now`, `at` is `now` as ISO time, unless
 * `fields` gives either (a briefing reuses its id; a criteria event takes its receipt's time).
 */
export function traceEvent<T extends StampedTrace["type"]>(
  type: T,
  now: number,
  fields: Omit<StampedOf<T>, "type" | "id" | "at"> & { id?: string; at?: string },
): StampedOf<T> {
  return { type, id: ulid(now), at: new Date(now).toISOString(), ...fields } as StampedOf<T>;
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

function eventMatchesUnit(ev: TraceEvent, unit: string): boolean {
  switch (ev.type) {
    case "tick":
    case "tick.start":
      return ev.decisions.some((d) => unitMatches(decisionUnit(d), unit));
    case "tick.end":
    case "local_file":
      return false;
    case "hook":
      return unitMatches(ev.fact.slice ?? ev.fact.story, unit) || ev.fact.story === unit;
    case "reject":
    case "briefing":
    case "foreign_commits":
    case "take":
    case "criteria":
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

// ---------------------------------------------------------------- hook lines (A2, A4): fast scans

/** Day files of the trace, unsorted; none when the trace dir cannot be listed (diagnostic, never fatal). */
function hookDayFiles(root: string): string[] | null {
  try {
    return readdirSync(traceDir(root)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  } catch {
    return null;
  }
}

/**
 * Hook facts appended by `norn hook` (A2), read from trace day files since `since`, oldest first.
 * A fast scan: only lines starting `{"type":"hook"` are parsed, and neither they nor the facts are
 * schema-checked (the trace is diagnostic: an unreadable file or a bad line is skipped).
 */
export function readHookFacts(root: string, since: string): HookFact[] {
  const names = hookDayFiles(root);
  if (!names) return [];
  const day = since.slice(0, 10);
  const out: HookFact[] = [];
  for (const name of names.sort()) {
    if (name.slice(0, 10) < day) continue;
    let text: string;
    try {
      text = readFileSync(join(traceDir(root), name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.startsWith('{"type":"hook"')) continue;
      try {
        const ev = JSON.parse(line) as { fact?: HookFact };
        if (ev.fact && ev.fact.at >= since) out.push(ev.fact);
      } catch {
        /* diagnostic file; bad lines are skipped */
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** A4: hook events of `runId` that norn blocked, counted in the trace day files since the run began (text match, no parse). */
export function blockedHookCount(root: string, runId: string): number {
  const names = hookDayFiles(root);
  if (!names) return 0;
  const day = new Date(ulidTime(runId)).toISOString().slice(0, 10);
  const needle = `"run_id":"${runId}"`;
  let n = 0;
  for (const name of names) {
    if (name.slice(0, 10) < day) continue;
    for (const line of readFileSync(join(traceDir(root), name), "utf8").split("\n"))
      if (line.startsWith('{"type":"hook"') && line.includes('"blocked":true') && line.includes(needle)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- retention (D12): whole day pairs

/** One day of the trace: its day file and, where present, its chunks file (trace-relative, sorted). */
export interface TraceDay {
  /** `YYYY-MM-DD` (UTC) */
  day: string;
  files: string[];
  bytes: number;
}

const DAY_PAIR_FILE = /^(\d{4}-\d{2}-\d{2})(?:\.chunks)?\.jsonl$/;

/**
 * D12: the day pairs (`<day>.jsonl`, `<day>.chunks.jsonl`) dated before `beforeDay` (`YYYY-MM-DD`),
 * oldest first, with the bytes each holds. Nothing else in the trace dir is a day pair: `workflows/`,
 * briefings, transcripts, caches and locks are never listed.
 */
export function traceDaysBefore(root: string, beforeDay: string): TraceDay[] {
  let names: string[];
  try {
    names = readdirSync(traceDir(root)).sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
  const days = new Map<string, TraceDay>();
  for (const name of names) {
    const day = DAY_PAIR_FILE.exec(name)?.[1];
    if (!day || day >= beforeDay) continue;
    let bytes: number;
    try {
      bytes = statSync(join(traceDir(root), name)).size;
    } catch {
      continue;
    }
    const d = days.get(day) ?? { day, files: [], bytes: 0 };
    d.files.push(name);
    d.bytes += bytes;
    days.set(day, d);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** D12: delete the files of these day pairs (deleted wholesale: a day pair is self-contained). */
export function deleteTraceDays(root: string, days: TraceDay[]): void {
  for (const d of days) for (const f of d.files) safeUnlink(join(traceDir(root), f));
}

/** Whether the trace still holds the day file of the UTC day of `at` (D10: a gone day means pruned). */
export function hasTraceDay(root: string, at: string): boolean {
  return existsSync(join(traceDir(root), traceFileName(at)));
}

// ---------------------------------------------------------------- side files (B4, C4)

const briefingRelPath = (runId: string, id: string) => `briefings/${runId}/${id}.md`;
const transcriptRelPath = (runId: string, id: string) => `transcripts/${runId}/${id}.txt`;

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
