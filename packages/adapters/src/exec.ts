/**
 * The one command execution seam of the adapters, and their one `PortError` (ports.ts). Adapters
 * build argv and hand it to an injectable `Exec`, so they are tested against recorded fixtures
 * (X4); production runs `bunExec` on store's `spawnBounded` (H11: bounded, a timeout is exit 124).
 * Never throws: a missing binary is exit code 127.
 */
import type { PortError } from "@norn/core";
import { spawnBounded } from "@norn/store";

export interface ExecOptions {
  cwd?: string;
  /** overlaid on the inherited process.env (a key set to undefined keeps the inherited value) */
  env?: Record<string, string | undefined>;
  stdin?: string;
  /** H11: kill the call (and its process group) after this long; a timeout is exit 124 */
  timeoutMs?: number;
}

export interface ExecResult {
  /** exit code; 124 when killed by the timeout, 127 when the executable could not be started */
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `argv` (argv[0] is the binary). Must not throw. */
export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

async function run(argv: string[], opts: ExecOptions, unobserved: boolean): Promise<ExecResult> {
  const r = await spawnBounded(argv, {
    env: { ...process.env, ...(opts.env ?? {}) },
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    ...(unobserved ? { unobserved: true } : {}),
  });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

/** Default Exec: inherits process.env overlaid with opts.env; tells store's spawn observer (effect transcripts). */
export const bunExec: Exec = (argv, opts = {}) => run(argv, opts, false);

/**
 * `bunExec` without telling the spawn observer: for the process adapter's read-only `ps` probes,
 * whose argv carries live pids (an effect transcript would differ on every run).
 */
export const unobservedExec: Exec = (argv, opts = {}) => run(argv, opts, true);

class AdapterError extends Error implements PortError {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "PortError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Typed failure for port methods (ports.ts: "throw PortError"): stable `code`, `retryable` for transient failures. */
export function portError(code: string, message: string, retryable = false): PortError {
  return new AdapterError(code, message, retryable);
}

/** Classify common transport failures from a CLI's stderr. */
export function isNetworkError(stderr: string): boolean {
  return /could not resolve host|connection (refused|reset|timed out)|network is unreachable|unable to access|timed out|could not read from remote repository|error connecting to/i.test(
    stderr,
  );
}

export function isAuthError(stderr: string): boolean {
  return /authentication failed|permission denied|not logged in|auth login|401|403|could not read username|invalid credentials|token/i.test(stderr);
}

/** Fails with a PortError unless exit code is 0; returns stdout. */
export function okOrThrow(res: ExecResult, what: string, codePrefix: string): string {
  if (res.code === 0) return res.stdout;
  const msg = `${what} failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`;
  if (res.code === 127) throw portError(`${codePrefix}_missing`, msg);
  if (isAuthError(res.stderr)) throw portError(`${codePrefix}_auth`, msg);
  if (isNetworkError(res.stderr)) throw portError(`${codePrefix}_network`, msg, true);
  throw portError(`${codePrefix}_failed`, msg);
}

/** Parse JSON stdout or fail with a typed PortError. */
export function parseJson<T>(text: string, what: string, codePrefix: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw portError(`${codePrefix}_bad_output`, `${what}: output is not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Fixture-backed Exec for tests: each entry matches argv exactly (joined by NUL) and returns
 * a recorded result. Unmatched calls return exit 1 with a message naming the argv.
 */
export interface ExecFixture {
  argv: string[];
  code?: number;
  stdout?: string;
  stderr?: string;
}

export function fixtureExec(fixtures: ExecFixture[], calls: string[][] = []): Exec {
  return async (argv) => {
    calls.push(argv);
    const key = argv.join("\0");
    const hit = fixtures.find((f) => f.argv.join("\0") === key);
    if (!hit) return { code: 1, stdout: "", stderr: `no fixture for: ${argv.join(" ")}` };
    return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
}

/** POSIX-shell quote one word. */
export function shellQuote(word: string): string {
  if (word !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Join argv into one POSIX command line. */
export function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}
