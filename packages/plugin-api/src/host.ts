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
}

export interface HostRepo {
  /** the checkout's root */
  root: string;
  /** the machine folder for this repo, outside every worktree, so nothing a plugin keeps there is committed */
  dataDir: string;
}

export interface HostContext {
  exec(argv: string[], opts?: ExecOptions): Promise<ExecOutput>;
  files: HostFiles;
  /** ISO-8601 UTC; a plugin never reads the clock itself, so a replay sees the same time */
  now(): string;
  repo: HostRepo;
}
