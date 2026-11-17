/**
 * In-memory stand-ins for the host context, so a provider plugin is tested with no child process,
 * no disk and no clock: every answer is scripted, and every call is there to inspect afterwards.
 */
import type { ExecOptions, ExecOutput, HostContext, HostFiles } from "@norn/plugin-api";

export interface MemoryFiles extends HostFiles {
  /** every file and its text, by path */
  snapshot(): Record<string, string>;
  /** while on, every write, create and remove rejects and changes nothing, as a full disk would */
  failWrites(on: boolean): void;
}

const trim = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function memoryFiles(seed: Record<string, string> = {}): MemoryFiles {
  const files = new Map<string, string>(Object.entries(seed).map(([p, d]) => [trim(p), d]));
  let failing = false;
  const guard = (op: string, path: string): void => {
    if (failing) throw new Error(`memoryFiles: ${op} ${path} failed (injected)`);
  };
  return {
    read: async (path) => files.get(trim(path)) ?? null,
    write: async (path, data) => {
      guard("write", path);
      files.set(trim(path), data);
    },
    create: async (path, data) => {
      guard("create", path);
      const p = trim(path);
      if (files.has(p)) return false;
      files.set(p, data);
      return true;
    },
    list: async (dir) => {
      const prefix = `${trim(dir)}/`;
      const names = new Set<string>();
      for (const p of files.keys()) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split("/")[0] as string);
      return [...names].sort();
    },
    remove: async (path) => {
      guard("remove", path);
      files.delete(trim(path));
    },
    snapshot: () => Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b))),
    failWrites: (on) => {
      failing = on;
    },
  };
}

export interface ExecCall {
  argv: string[];
  opts: ExecOptions;
}

/** What a script answers for one call; missing fields default to a clean exit with no output. */
export type ScriptedAnswer = Partial<ExecOutput>;
export type ExecScript = (argv: string[], opts: ExecOptions) => ScriptedAnswer | undefined | Promise<ScriptedAnswer | undefined>;

export type ScriptedExec = HostContext["exec"] & { readonly calls: ExecCall[] };

/** Exit code for a call the script does not answer: what a shell gives for a command it cannot find. */
export const UNSCRIPTED_CODE = 127;

/**
 * An exec that answers from `script` and records every call. A call the script leaves unanswered
 * exits 127 with the argv on stderr, so a plugin running a command its test never expected fails
 * loudly rather than reading an empty success.
 */
export function scriptedExec(script: ExecScript): ScriptedExec {
  const calls: ExecCall[] = [];
  const exec = async (argv: string[], opts: ExecOptions = {}): Promise<ExecOutput> => {
    calls.push({ argv: [...argv], opts: { ...opts } });
    const answer = await script([...argv], opts);
    if (answer === undefined) return { code: UNSCRIPTED_CODE, stdout: "", stderr: `unscripted: ${argv.join(" ")}`, timedOut: false };
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "", timedOut: answer.timedOut ?? false };
  };
  return Object.assign(exec, { calls });
}

/** A clock that starts at `start` and moves `stepMs` forward on every read, so each read is distinct. */
export function steppingClock(start: string, stepMs = 1000): () => string {
  const t0 = Date.parse(start);
  if (Number.isNaN(t0)) throw new RangeError(`steppingClock: not a time: ${start}`);
  let n = 0;
  return () => new Date(t0 + stepMs * n++).toISOString();
}

export interface ManualClock {
  /** the current time, ISO-8601 UTC; reading it never moves it */
  now(): string;
  /** move the clock forward */
  advance(ms: number): void;
}

/** A clock that stands still until told to move, so a test decides exactly when a claim expires. */
export function manualClock(start: string): ManualClock {
  let t = Date.parse(start);
  if (Number.isNaN(t)) throw new RangeError(`manualClock: not a time: ${start}`);
  return {
    now: () => new Date(t).toISOString(),
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`manualClock: cannot move by ${ms}`);
      t += ms;
    },
  };
}

export interface MemoryHostParts {
  files?: HostFiles;
  exec?: HostContext["exec"];
  now?: () => string;
  repo?: HostContext["repo"];
}

/** A whole host context from in-memory parts; whatever is left out gets an empty default. */
export function memoryHost(parts: MemoryHostParts = {}): HostContext {
  return {
    exec: parts.exec ?? scriptedExec(() => undefined),
    files: parts.files ?? memoryFiles(),
    now: parts.now ?? steppingClock("2026-01-01T00:00:00.000Z"),
    repo: parts.repo ?? { root: "/repo", dataDir: "/machine/repo" },
  };
}
