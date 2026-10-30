/**
 * Trace (O4, B4, gitignored): `.agents/norn/trace/<YYYY-MM-DD>.jsonl` — one JSONL file
 * per UTC day holding every event (tick, hook, reject, briefing) in append order. Day files keep
 * appends cheap and let old days be deleted wholesale; `trace <unit>` / `why <unit>`
 * filter by unit while reading. Briefings and transcript snapshots are separate files
 * under `briefings/<run_id>/` and `transcripts/<run_id>/`, referenced by trace-relative path.
 * Each hook event fired in a unit worktree is also kept in that unit's hook file under `hooks/` (D3),
 * which is where every reader of a unit's hooks reads them.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Facts, FileError, LoadedWorkflow, RepoWorkflows } from "@norn/core";
import {
  type HookFact,
  type HookTrace,
  type ResolvedConfig,
  type TickStartTrace,
  type TickTrace,
  type TraceEvent,
  assertValid,
  ulid,
  ulidTime,
  validate,
} from "@norn/schema";
import { appendDurable, atomicWrite, isErrno, readText, safeUnlink } from "./fsx.ts";
import { hookFilePath, traceDir } from "./paths.ts";
import { parseWorkflowText } from "./unit.ts";

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
  const line = traceLine(event);
  if (event.type === "tick.start") appendDurable(path, line);
  else {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line);
  }
  return name;
}

/** B4 (D2): one trace line, `type` first, so a reader can skip a line by its prefix without parsing it. */
function traceLine(event: TraceEvent): string {
  const { type, ...rest } = event;
  return `${JSON.stringify({ type, ...rest })}\n`;
}

/**
 * B5 (D3, A2): append a hook event to its unit's hook file, then the same line to the day file —
 * both unsynced appends, like every diagnostic line. Then the hook file's mtime is moved forward to the
 * fact's time, never back, so the tick's "written within the stalled window" (D4, `unitHooksChangedAt`)
 * is on the clock the facts carry. Returns the day file's trace-relative name.
 */
export function appendHookTrace(root: string, unit: HookUnit, event: HookTrace): string {
  assertValid("trace", event);
  const line = traceLine(event);
  const name = traceFileName(event.fact.at);
  const file = hookFilePath(root, unit);
  const before = unitHooksChangedAt(root, unit) ?? Number.NEGATIVE_INFINITY;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, line);
  appendFileSync(join(traceDir(root), name), line);
  const at = new Date(Math.max(before, Date.parse(event.fact.at)));
  try {
    utimesSync(file, at, at);
  } catch {
    /* diagnostic: the lines are written; a later fact sets the time */
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

/** One trace file a reader opened: what the trace-read observer sees. */
export interface TraceFileRead {
  /** absolute path of the file */
  file: string;
  /** a day file, or a unit's hook file (D3) */
  kind: "day" | "hook";
}

export type TraceReadObserver = (read: TraceFileRead) => void;

let readObserver: TraceReadObserver | null = null;

/**
 * Test hook (B4, B8–B10), modelled on `setSpawnObserver`: call `fn` with each day file a trace reader
 * opens (`readTrace` and every reader built on it, `readHookFacts`) and each unit hook file `readUnitHooks`
 * opens. `null` (the default) turns it off. Returns the observer it replaced. It only watches; one that throws is ignored.
 */
export function setTraceReadObserver(fn: TraceReadObserver | null): TraceReadObserver | null {
  const prev = readObserver;
  readObserver = fn;
  return prev;
}

function observeRead(read: TraceFileRead): void {
  if (!readObserver) return;
  try {
    readObserver(read);
  } catch {
    // an observer never changes what norn does
  }
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
    observeRead({ file: path, kind: "day" });
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

// ---------------------------------------------------------------- replay inputs (O5)

/** Workflows as recorded in a tick's replay block: name → hash of the text stored at `trace/workflows/<hash>.yaml`. */
export interface ReplayWorkflowRef {
  hash: string | null;
  issues: LoadedWorkflow["issues"];
}

/** What a tick records beside its facts so `norn why` can replay decide on the same inputs (O5). */
export interface ReplayBlock {
  workflows: Record<string, ReplayWorkflowRef>;
  config: ResolvedConfig;
}

/** decide's inputs as a tick recorded them (O5). */
export interface TickInputs {
  facts: Facts;
  workflows: RepoWorkflows;
  config: ResolvedConfig;
}

/**
 * Rebuild decide's inputs from a tick record (O5): its facts without the replay block, each workflow
 * read back from its stored source, the config. Null for a tick recorded without a replay block.
 */
export function readTickInputs(root: string, tick: TickTrace): TickInputs | null {
  const { replay, ...facts } = tick.facts as unknown as Facts & { replay?: ReplayBlock };
  if (!replay) return null;
  const workflows: Record<string, LoadedWorkflow> = {};
  for (const [name, ref] of Object.entries(replay.workflows)) {
    const source = ref.hash ? (readTraceFile(root, `workflows/${ref.hash}.yaml`) ?? "") : "";
    const parsed = source ? parseWorkflowText(source, `trace/workflows/${ref.hash}.yaml`) : null;
    const workflow = parsed?.ok ? parsed.value : null;
    workflows[name] = { name, workflow, source, issues: ref.issues };
  }
  return { facts: facts as Facts, workflows, config: replay.config };
}

// ---------------------------------------------------------------- hook lines (A2, A4): fast scans

/**
 * Hook facts appended by `norn hook` (A2), read from trace day files since `since`, oldest first.
 * A fast scan: only hook lines are parsed, and neither they nor the facts are schema-checked (the
 * trace is diagnostic: an unreadable file or a bad line is skipped).
 */
export function readHookFacts(root: string, since: string): HookFact[] {
  const out: HookFact[] = [];
  for (const ev of dayHookLines(root, since)) out.push(ev.fact);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The hook events of the day files at `since` or later, in file order: a fast scan like `readHookFacts` (D5 backfills from it). */
export function* dayHookLines(root: string, since: string): Generator<HookTrace> {
  for (const { text } of dayFileLines(root, { sinceDay: since, types: ["hook"], quiet: true })) {
    const ev = hookLine(text, since);
    if (ev) yield ev;
  }
}

/** One hook line at `since` or later, unchecked (a fast scan); null for any other or a bad line. */
function hookLine(text: string, since: string): HookTrace | null {
  try {
    const ev = JSON.parse(text) as HookTrace;
    return ev.type === "hook" && ev.fact && ev.fact.at >= since ? ev : null;
  } catch {
    return null; // diagnostic file; bad lines are skipped
  }
}

/** A unit whose hook events are read or written (D3): its story, and its slice for a slice unit. */
export interface HookUnit {
  story: string;
  slice?: string | null;
}

/**
 * The hook events in a unit's hook file at `since` or later (B5): duplicate event ids dropped, sorted by
 * the fact's time (D3). A fast scan like `readHookFacts`: nothing is schema-checked, bad lines are skipped.
 */
function unitHookLines(root: string, unit: HookUnit, since: string): HookTrace[] {
  const file = hookFilePath(root, unit);
  let text: string | null;
  try {
    text = readText(file);
  } catch {
    return []; // diagnostic file: unreadable is empty
  }
  if (text !== null) observeRead({ file, kind: "hook" });
  const seen = new Set<string>();
  const out: HookTrace[] = [];
  for (const line of (text ?? "").split("\n")) {
    const ev = line.trim() ? hookLine(line, since) : null;
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  return out.sort((a, b) => a.fact.at.localeCompare(b.fact.at));
}

/**
 * A2/A4 (B8–B10): the hook events of each unit in `units` since `since`, oldest first, in the order
 * given — one read for every caller of a unit's hooks (the tick's local facts, `brief`, `hook`'s
 * blocked count). Each unit's own hook file only: no day file is read.
 */
export function readUnitHooks(root: string, units: readonly HookUnit[], since: string): HookTrace[][] {
  return units.map((u) => unitHookLines(root, u, since));
}

/**
 * D5 (B11, B12): append to the unit's hook file the events whose id it does not hold yet, in one
 * append — never a rewrite, so a concurrent `norn hook` append is never lost. Returns how many it appended.
 */
export function appendMissingUnitHooks(root: string, unit: HookUnit, events: readonly HookTrace[]): number {
  const held = new Set(unitHookLines(root, unit, "").map((e) => e.id));
  const missing = events.filter((e) => !held.has(e.id) && held.add(e.id));
  if (!missing.length) return 0;
  const file = hookFilePath(root, unit);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, missing.map(traceLine).join(""));
  return missing.length;
}

/** D4: when the unit's hook file was last written (ms, the time of its last appended fact), or null when it has none. */
export function unitHooksChangedAt(root: string, unit: HookUnit): number | null {
  try {
    return statSync(hookFilePath(root, unit)).mtimeMs;
  } catch {
    return null;
  }
}

/** A4: hook events of `runId` that norn blocked, counted in its unit's hooks since the day the run began. */
export function blockedHookCount(root: string, unit: HookUnit, runId: string): number {
  const day = new Date(ulidTime(runId)).toISOString().slice(0, 10);
  return (readUnitHooks(root, [unit], day)[0] ?? []).filter((e) => e.blocked && e.fact.run_id === runId).length;
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
