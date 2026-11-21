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
  /** whether the file was last written by `writeExecutable` */
  executable(path: string): boolean;
  writeExecutable(path: string, data: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  readLink(path: string): Promise<string | null>;
  /** every link and its target, by path */
  links(): Record<string, string>;
}

const trim = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** `path` with `.`, `..` and repeated slashes folded away; absolute paths only. */
function normal(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

export function memoryFiles(seed: Record<string, string> = {}): MemoryFiles {
  const files = new Map<string, string>(Object.entries(seed).map(([p, d]) => [trim(p), d]));
  let failing = false;
  const executables = new Set<string>();
  const links = new Map<string, string>();
  const guard = (op: string, path: string): void => {
    if (failing) throw new Error(`memoryFiles: ${op} ${path} failed (injected)`);
  };
  /**
   * The stored path `path` names, following every link on the way as a disk does; the last part only
   * when `last`, as removing or reading a link acts on the link itself. A relative path (only tests
   * use one) is kept as it is.
   */
  const real = (path: string, last = true): string => {
    const p = trim(path);
    if (!p.startsWith("/") || links.size === 0) return p;
    let pending = normal(p).split("/").slice(1);
    let at = "";
    let hops = 0;
    while (pending.length > 0) {
      const next = `${at}/${pending.shift()}`;
      const target = links.get(next);
      if (target === undefined || (pending.length === 0 && !last)) {
        at = next;
        continue;
      }
      if (++hops > 40) throw new Error(`memoryFiles: ${p} loops through its links`);
      // the target is relative to the link's folder; walked again from the root, a link in it is followed too
      pending = [...normal(target.startsWith("/") ? target : `${at}/${target}`).split("/").slice(1), ...pending];
      at = "";
    }
    return at || "/";
  };
  return {
    read: async (path) => files.get(real(path)) ?? null,
    write: async (path, data) => {
      guard("write", path);
      files.set(real(path), data);
      executables.delete(real(path));
    },
    writeExecutable: async (path, data) => {
      guard("write", path);
      files.set(real(path), data);
      executables.add(real(path));
    },
    executable: (path) => executables.has(real(path)),
    create: async (path, data) => {
      guard("create", path);
      const p = real(path);
      if (files.has(p)) return false;
      files.set(p, data);
      return true;
    },
    list: async (dir) => {
      const prefix = `${real(dir)}/`;
      const names = new Set<string>();
      for (const p of [...files.keys(), ...links.keys()]) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split("/")[0] as string);
      return [...names].sort();
    },
    symlink: async (target, path) => {
      guard("symlink", path);
      const p = real(path, false);
      if (files.has(p) || [...files.keys()].some((f) => f.startsWith(`${p}/`))) throw new Error(`memoryFiles: ${p} is not a link; it is left as it is`);
      links.set(p, target);
    },
    readLink: async (path) => links.get(real(path, false)) ?? null,
    links: () => Object.fromEntries([...links.entries()].sort(([a], [b]) => a.localeCompare(b))),
    remove: async (path) => {
      guard("remove", path);
      const p = real(path, false);
      files.delete(p);
      executables.delete(p);
      links.delete(p);
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
