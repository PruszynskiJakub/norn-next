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
import { type HookFact, type TickStartTrace, type TickTrace, type TraceEvent, assertValid, ulid, ulidTime, validate } from "@norn/schema";
import { appendDurable, atomicWrite, isErrno, readText } from "./fsx.ts";
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
  // B4 (D2): `type` first, so a reader can skip a line by its prefix without parsing it
  const { type, ...rest } = event;
  const line = `${JSON.stringify({ type, ...rest })}\n`;
  if (type === "tick.start") appendDurable(path, line);
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

// ---------------------------------------------------------------- day-file lines (B4)

/** One day file a reader opened: what the trace-read observer sees. */
export interface TraceFileRead {
  /** absolute path of the day file */
  file: string;
}

export type TraceReadObserver = (read: TraceFileRead) => void;

let readObserver: TraceReadObserver | null = null;

/**
 * Test hook (B4), modelled on `setSpawnObserver`: call `fn` with each day file a trace reader opens
 * (`readTrace` and every reader built on it, `readHookFacts`, `blockedHookCount`). `null` (the
 * default) turns it off. Returns the observer it replaced. It only watches; one that throws is ignored.
 */
export function setTraceReadObserver(fn: TraceReadObserver | null): TraceReadObserver | null {
  const prev = readObserver;
  readObserver = fn;
  return prev;
}

interface DayLine {
  /** day file name, e.g. `2026-10-23.jsonl` */
  name: string;
  /** 1-based line number */
  n: number;
  text: string;
  /** the type its `{"type":"…"` prefix names; null for a line without one (an older norn's, or garbage) */
  type: string | null;
}

const TYPE_PREFIX = '{"type":"';

function prefixType(line: string): string | null {
  if (!line.startsWith(TYPE_PREFIX)) return null;
  const end = line.indexOf('"', TYPE_PREFIX.length);
  return end < 0 ? null : line.slice(TYPE_PREFIX.length, end);
}

/**
 * The one day-file line reader (B4): the non-blank lines of every day file from `sinceDay` on,
 * oldest file first. With `types`, a line whose prefix names another type is skipped unparsed (D2);
 * a line without a type prefix is always yielded for the caller to parse. Throws when the trace dir
 * cannot be listed or a file cannot be read, unless `quiet` (a file that went away is skipped either way).
 */
function* dayFileLines(root: string, opts: { sinceDay?: string | null; types?: readonly string[]; quiet?: boolean } = {}): Generator<DayLine> {
  let names: string[];
  try {
    names = readdirSync(traceDir(root))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .sort();
  } catch (e) {
    if (opts.quiet || isErrno(e, "ENOENT")) return;
    throw e;
  }
  for (const name of names) {
    if (opts.sinceDay && name.slice(0, 10) < opts.sinceDay.slice(0, 10)) continue;
    const path = join(traceDir(root), name);
    if (readObserver) {
      try {
        readObserver({ file: path });
      } catch {
        // an observer never changes what norn does
      }
    }
    let text: string | null;
    try {
      text = readText(path);
    } catch (e) {
      if (opts.quiet) continue;
      throw e;
    }
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (!line.trim()) continue;
      const type = prefixType(line);
      if (opts.types && type !== null && !opts.types.includes(type)) continue;
      yield { name, n: i + 1, text: line, type };
    }
  }
}

export function readTrace(root: string, q: TraceQuery = {}): TraceRead {
  const out: TraceRead = { events: [], errors: [] };
  for (const { name, n, text, type } of dayFileLines(root, { sinceDay: q.since ? traceFileName(q.since) : null, ...(q.types ? { types: q.types } : {}) })) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // D2: a line that names no type is garbage only to a reader of every type
      if (!q.types || type !== null) out.errors.push({ file: `${name}:${n}`, errors: [{ path: "", message: `invalid JSON: ${(e as Error).message}` }] });
      continue;
    }
    const parsedType = (parsed as { type?: unknown } | null)?.type;
    if (q.types && !q.types.includes(parsedType as TraceEvent["type"])) continue;
    const v = validate("trace", parsed);
    if (!v.ok) {
      out.errors.push({ file: `${name}:${n}`, errors: v.errors });
      continue;
    }
    const ev = v.value;
    if (q.since && eventTime(ev) < q.since) continue;
    if (q.unit && !eventMatchesUnit(ev, q.unit)) continue;
    out.events.push(ev);
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

/**
 * Hook facts appended by `norn hook` (A2), read from trace day files since `since`, oldest first.
 * A fast scan: only hook lines are parsed, and neither they nor the facts are schema-checked (the
 * trace is diagnostic: an unreadable file or a bad line is skipped).
 */
export function readHookFacts(root: string, since: string): HookFact[] {
  const out: HookFact[] = [];
  for (const { text } of dayFileLines(root, { sinceDay: since, types: ["hook"], quiet: true })) {
    try {
      const ev = JSON.parse(text) as { type?: string; fact?: HookFact };
      if (ev.type === "hook" && ev.fact && ev.fact.at >= since) out.push(ev.fact);
    } catch {
      /* diagnostic file; bad lines are skipped */
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** A4: hook events of `runId` that norn blocked, counted in the trace day files since the run began (text match, no parse). */
export function blockedHookCount(root: string, runId: string): number {
  const day = new Date(ulidTime(runId)).toISOString().slice(0, 10);
  const needle = `"run_id":"${runId}"`;
  let n = 0;
  for (const { text, type } of dayFileLines(root, { sinceDay: day, types: ["hook"], quiet: true })) if (type === "hook" && text.includes('"blocked":true') && text.includes(needle)) n++;
  return n;
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
