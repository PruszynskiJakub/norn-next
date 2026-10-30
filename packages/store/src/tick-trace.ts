/**
 * Tick records and their replay inputs (O4, O5). A tick line keeps its decisions inline and stores its
 * facts as a skeleton marked `"$chunked": 1` (D6): each large part is replaced by `{"$chunk": <hash>}`
 * and each run's hook list by `{"$blocks": [<hash>, …]}`, the values living once in the day's chunks
 * file `<day>.chunks.jsonl` beside the day file, one `{"h": <sha256 of the value's JSON>, "v": <value>}`
 * per line (D8). A tick line without the marker is a full-facts tick an older norn wrote (B18).
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Facts, FileError, LoadedWorkflow, RepoWorkflows } from "@norn/core";
import { type ResolvedConfig, type TickTrace, assertValid } from "@norn/schema";
import { appendDurable, isErrno, readText } from "./fsx.ts";
import { traceDir } from "./paths.ts";
import { appendTrace, readTraceFile, traceFileName } from "./trace.ts";
import { parseWorkflowText, sha256 } from "./unit.ts";

/** decide's inputs as a tick recorded them (O5). */
export interface TickInputs {
  facts: Facts;
  workflows: RepoWorkflows;
  config: ResolvedConfig;
}

/** A workflow in a full-facts tick's replay block: the hash of its text stored at `trace/workflows/<hash>.yaml` (D9). */
export interface ReplayWorkflowRef {
  hash: string | null;
  issues: LoadedWorkflow["issues"];
}

/** What a full-facts tick records beside its facts so `norn run view --why` can replay decide on the same inputs (O5). */
export interface ReplayBlock {
  workflows: Record<string, ReplayWorkflowRef>;
  config: ResolvedConfig;
}

/** A chunked tick's replay block: each workflow's source is a chunk of the day (D9). */
interface ChunkedReplay {
  workflows: Record<string, { source: string; issues: LoadedWorkflow["issues"] }>;
  config: ResolvedConfig;
}

/** Hook facts per block (D7): blocks are cut by position in the run's hook list, so full ones never change. */
export const HOOK_BLOCK = 64;

const CHUNKED = "$chunked";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Chunks file of the day an ISO time falls on: `2026-10-23.chunks.jsonl` (D8). */
function chunksFileName(at: string): string {
  return traceFileName(at).replace(/\.jsonl$/, ".chunks.jsonl");
}

// ---------------------------------------------------------------- writing (B13–B16)

/** The skeleton of `full` (D7) and the chunks it names, hash → the value's JSON. */
function split(full: Obj): { skeleton: Obj; chunks: Map<string, string> } {
  const chunks = new Map<string, string>();
  const ref = (v: unknown) => {
    const text = JSON.stringify(v);
    const h = sha256(text);
    chunks.set(h, text);
    return { $chunk: h };
  };
  const blocks = (hooks: unknown[]) => {
    const out: string[] = [];
    for (let i = 0; i < hooks.length; i += HOOK_BLOCK) out.push(ref(hooks.slice(i, i + HOOK_BLOCK)).$chunk);
    return { $blocks: out };
  };
  const withBlocks = (story: Obj): Obj => ({
    ...story,
    units: (story.units as Obj[]).map((u) => (isObj(u.run) && Array.isArray(u.run.hooks) ? { ...u, run: { ...u.run, hooks: blocks(u.run.hooks) } } : u)),
  });
  // spreading first keeps every key where observe put it, so the rebuilt facts serialize byte for byte (B17)
  const skeleton: Obj = { [CHUNKED]: 1, ...full };
  if (full.machine !== undefined) skeleton.machine = ref(full.machine);
  if (isObj(full.remote) && Array.isArray(full.remote.issues)) skeleton.remote = { ...full.remote, issues: ref(full.remote.issues) };
  if (Array.isArray(full.stories)) skeleton.stories = full.stories.map((s) => ref(isObj(s) && Array.isArray(s.units) ? withBlocks(s) : s));
  const replay = full.replay as ChunkedReplay;
  const workflows: Obj = {};
  for (const [name, w] of Object.entries(replay.workflows)) workflows[name] = { ...w, source: w.source ? ref(w.source) : w.source };
  skeleton.replay = { ...replay, workflows, config: ref(replay.config) };
  return { skeleton, chunks };
}

/**
 * Which hashes a chunks file holds, trusted while the file is the size this process left it (D8, B16).
 * Only the file last written to is kept: a long-running watch moves on to the next day's.
 */
let written: { path: string; size: number; hashes: Set<string> } | null = null;

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return 0;
    throw e;
  }
}

/** The last byte of a file: a torn last line (a write killed midway) has no newline (B15). */
function endsWithNewline(path: string, size: number): boolean {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

const HASH_PREFIX = '{"h":"';

/** Hash-only scan of a chunks file's complete lines (a torn last line does not count as written). */
function scanHashes(text: string): Set<string> {
  const out = new Set<string>();
  const lines = text.split("\n");
  lines.pop(); // the part after the last newline: empty, or a torn line
  for (const line of lines) if (line.startsWith(HASH_PREFIX)) out.add(line.slice(HASH_PREFIX.length, HASH_PREFIX.length + 64));
  return out;
}

/** Append the chunks the file lacks in one fsynced write (D8): a quiet tick has none and pays no fsync. */
function appendChunks(path: string, chunks: Map<string, string>): void {
  const size = fileSize(path);
  let known = written;
  if (known?.path !== path || known.size !== size) {
    known = { path, size, hashes: scanHashes(size ? (readText(path) ?? "") : "") };
    written = known;
  }
  const fresh = [...chunks].filter(([h]) => !known.hashes.has(h));
  if (!fresh.length) return;
  const torn = size > 0 && !endsWithNewline(path, size);
  const data = `${torn ? "\n" : ""}${fresh.map(([h, v]) => `${HASH_PREFIX}${h}","v":${v}}\n`).join("")}`;
  appendDurable(path, data);
  for (const [h] of fresh) known.hashes.add(h);
  known.size = size + Buffer.byteLength(data);
}

/**
 * Record a tick (O4): its facts and replay inputs as chunks of the day, written and fsynced before the
 * tick line that names them, so no tick line ever names an unwritten chunk (B15). Returns the day file.
 */
export function appendTick(root: string, tick: Omit<TickTrace, "type" | "facts">, inputs: TickInputs): string {
  const replay: ChunkedReplay = { workflows: {}, config: inputs.config };
  for (const [name, w] of Object.entries(inputs.workflows)) replay.workflows[name] = { source: w.source, issues: w.issues };
  const full = JSON.parse(JSON.stringify({ ...inputs.facts, replay })) as Obj;
  const { skeleton, chunks } = split(full);
  const { inbox, ...fields } = tick;
  const line: TickTrace = { type: "tick", ...fields, facts: skeleton, ...(inbox ? { inbox } : {}) };
  assertValid("trace", line);
  appendChunks(join(traceDir(root), chunksFileName(tick.at)), chunks);
  return appendTrace(root, line);
}

// ---------------------------------------------------------------- reading (B17–B19, B21)

export type TickInputsRead =
  | { ok: true; inputs: TickInputs }
  /** recorded by an older norn without a replay block */
  | { ok: false; reason: "no_replay" }
  /** a chunk the tick names is missing from its day (B21, S2): nothing is replayed */
  | { ok: false; reason: "corrupt"; error: FileError };

class MissingChunk extends Error {
  constructor(readonly hash: string) {
    super(`missing chunk ${hash}`);
  }
}

/** One day's chunks: lines indexed by hash on first use, each parsed only when a tick needs it (D8). */
class DayChunks {
  private lines: Map<string, string[]> | null = null;
  private values = new Map<string, unknown>();
  constructor(private readonly path: string) {}

  get(h: string): unknown {
    if (this.values.has(h)) return this.values.get(h);
    if (!this.lines) {
      this.lines = new Map();
      for (const line of (readText(this.path) ?? "").split("\n")) {
        if (!line.startsWith(HASH_PREFIX)) continue;
        const key = line.slice(HASH_PREFIX.length, HASH_PREFIX.length + 64);
        const same = this.lines.get(key);
        if (same) same.push(line);
        else this.lines.set(key, [line]);
      }
    }
    // duplicates hold the same value; a torn one does not parse and the next is tried
    for (const line of this.lines.get(h) ?? []) {
      try {
        const v = (JSON.parse(line) as { v: unknown }).v;
        this.values.set(h, v);
        return v;
      } catch {
        /* torn line */
      }
    }
    throw new MissingChunk(h);
  }
}

/** Put each chunk's value back where its reference stood, dropping the marker (B17). */
function rebuild(v: unknown, day: DayChunks): unknown {
  if (Array.isArray(v)) return v.map((x) => rebuild(x, day));
  if (!isObj(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1 && typeof v.$chunk === "string") return rebuild(day.get(v.$chunk), day);
  if (keys.length === 1 && Array.isArray(v.$blocks)) return (v.$blocks as string[]).flatMap((h) => rebuild(day.get(h), day) as unknown[]);
  const out: Obj = {};
  for (const k of keys) if (k !== CHUNKED) out[k] = rebuild(v[k], day);
  return out;
}

export interface TickReader {
  inputs(tick: TickTrace): TickInputsRead;
}

/**
 * A reader of ticks' decide inputs (O5) that keeps each day's chunks it read, for callers that read
 * many ticks (`why` with a filter, the golden harvest). One reader per command: it never sees later appends.
 */
export function tickReader(root: string): TickReader {
  const days = new Map<string, DayChunks>();
  const dayOf = (at: string) => {
    const name = chunksFileName(at);
    let d = days.get(name);
    if (!d) days.set(name, (d = new DayChunks(join(traceDir(root), name))));
    return { name, chunks: d };
  };
  return {
    inputs(tick) {
      let all = tick.facts;
      if (all[CHUNKED] === 1) {
        const { name, chunks } = dayOf(tick.at);
        try {
          all = rebuild(all, chunks) as Obj;
        } catch (e) {
          if (!(e instanceof MissingChunk)) throw e;
          return { ok: false, reason: "corrupt", error: { file: name, errors: [{ path: "", message: `tick ${tick.tick_id} names chunk ${e.hash}, which is not in ${name}` }] } };
        }
      }
      const { replay, ...facts } = all as unknown as Facts & { replay?: ReplayBlock | ChunkedReplay };
      if (!replay) return { ok: false, reason: "no_replay" };
      const workflows: Record<string, LoadedWorkflow> = {};
      for (const [name, ref] of Object.entries(replay.workflows as Record<string, Partial<ReplayWorkflowRef> & { source?: string; issues: LoadedWorkflow["issues"] }>)) {
        // a chunked tick carries the source; a full-facts tick names it in trace/workflows (D9)
        const label = ref.hash ? `trace/workflows/${ref.hash}.yaml` : `trace/${chunksFileName(tick.at)}`;
        const source = typeof ref.source === "string" ? ref.source : ref.hash ? (readTraceFile(root, `workflows/${ref.hash}.yaml`) ?? "") : "";
        const parsed = source ? parseWorkflowText(source, label) : null;
        workflows[name] = { name, workflow: parsed?.ok ? parsed.value : null, source, issues: ref.issues };
      }
      return { ok: true, inputs: { facts: facts as Facts, workflows, config: replay.config } };
    },
  };
}

/** Rebuild decide's inputs from one tick record (O5): its facts without the replay block, each workflow, the config. */
export function readTickInputs(root: string, tick: TickTrace): TickInputsRead {
  return tickReader(root).inputs(tick);
}
