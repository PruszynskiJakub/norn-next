/**
 * What the host hands every provider plugin factory. A plugin reaches processes, files and the clock
 * only through this, so one host owns spawning, atomic writes and time, and a plugin is tested with
 * in-memory stand-ins and no child process.
 */

export interface ExecOptions {
  cwd?: string;
  /** written to the process's stdin, then closed */
  input?: string;
  /** added to the host's environment, never replacing it wholesale */
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** What a finished process left behind. A non-zero `code` is data for the plugin, never a throw. */
export interface ExecOutput {
  code: number;
  stdout: string;
  stderr: string;
  /** the host killed it at `timeoutMs`; `code` is then whatever the kill left */
  timedOut: boolean;
}

/**
 * Files on the host's disk. Every method rejects on an IO failure (permissions, a full disk); the
 * plugin turns that into a PluginFailure, since a provider call never throws.
 */
export interface HostFiles {
  /** the file's text, or null when it does not exist */
  read(path: string): Promise<string | null>;
  /** replace the file atomically (temp file, fsync, rename): a reader sees the old text or the new, never a torn one */
  write(path: string, data: string): Promise<void>;
  /**
   * Create the file only if no file is there; false when one is. Exclusive, so two writers racing
   * for one name cannot both believe they made it.
   */
  create(path: string, data: string): Promise<boolean>;
  /** names (not paths) in the folder, sorted; empty when the folder does not exist */
  list(dir: string): Promise<string[]>;
  /** remove the file; removing a missing file is not an error */
  remove(path: string): Promise<void>;
  /**
   * `write`, and the file is executable by its owner (plugin API 1.6): a script handed to another
   * program, found on its PATH, is run only with the bit set. Optional, as a host with no executable
   * files (a browser) is still a host; a caller without it does without the script.
   */
  writeExecutable?(path: string, data: string): Promise<void>;
  /**
   * Make `path` a symbolic link to `target`, a path relative to the link's folder, replacing a link
   * already there but never a file or a folder (plugin API 1.7). Optional, with `readLink`: a host
   * without links has a caller copy instead.
   */
  symlink?(target: string, path: string): Promise<void>;
  /** the target the link at `path` names, as written; null when nothing is there or it is no link */
  readLink?(path: string): Promise<string | null>;
  /**
   * the file's bytes, or null when it does not exist (plugin API 1.28): an image or any file no text
   * encoding carries whole. Optional, with `writeBytes`; a caller without them does without the file.
   */
  readBytes?(path: string): Promise<Uint8Array | null>;
  /** replace the file with `data` atomically, as `write` does */
  writeBytes?(path: string, data: Uint8Array): Promise<void>;
}

export interface HostRepo {
  /** the checkout's root */
  root: string;
  /** the machine folder for this repo, outside every worktree, so nothing a plugin keeps there is committed */
  dataDir: string;
}

export interface SpawnOptions {
  cwd: string;
  /** added to the host's environment, never replacing it wholesale */
  env?: Record<string, string>;
  /** stdout and stderr are appended here; the folder is made when missing */
  logPath: string;
}

/**
 * A process the host started and does not wait for. `started` is an opaque start marker (the OS's
 * start time of the pid), compared only for equality: a pid the OS hands out again later is never
 * taken for this process.
 */
export interface SpawnedProcess {
  pid: number;
  started: string;
}

export type KillSignal = "TERM" | "KILL";

/**
 * Detached processes (plugin API 1.5). Optional on HostContext, as a host without them (a browser,
 * a test with no processes) is still a host; a plugin that needs them refuses at create time.
 */
export interface HostProcesses {
  /**
   * Start argv in its own process group, detached, so it outlives the tick that started it. Rejects
   * only when the executable cannot be started; an exit right after the start is the process's own.
   */
  spawn(argv: string[], opts: SpawnOptions): Promise<SpawnedProcess>;
  /**
   * Whether the pid runs, and is the process `started` names when given. A zombie is dead; a probe
   * that cannot answer is alive, so an outage of `ps` never reads as a died session.
   */
  alive(pid: number, started?: string): Promise<boolean>;
  /** Signal the pid's process group (default TERM); a pid already gone is not an error. */
  kill(pid: number, signal?: KillSignal): Promise<void>;
}

export interface HostContext extends Partial<HostProcesses> {
  exec(argv: string[], opts?: ExecOptions): Promise<ExecOutput>;
  files: HostFiles;
  /** ISO-8601 UTC; a plugin never reads the clock itself, so a replay sees the same time */
  now(): string;
  repo: HostRepo;
}

const PROCESS_METHODS = ["spawn", "alive", "kill"] as const;

/** The host's detached-process methods, or the names of those it lacks, for a plugin to refuse with. */
export function hostProcesses(ctx: HostContext): { ok: true; value: HostProcesses } | { ok: false; missing: string[] } {
  const missing = PROCESS_METHODS.filter((m) => typeof ctx[m] !== "function");
  if (missing.length > 0) return { ok: false, missing: [...missing] };
  const { spawn, alive, kill } = ctx as HostContext & HostProcesses;
  return { ok: true, value: { spawn: spawn.bind(ctx), alive: alive.bind(ctx), kill: kill.bind(ctx) } };
}
