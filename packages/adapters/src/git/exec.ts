/**
 * Command execution seam shared by the git, gh and glab adapters. Injectable so adapters are
 * tested against recorded fixtures (X4). Never throws: a missing binary is exit code 127.
 */
import type { PortError } from "@norn/core";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
}

/** Run `argv` (argv[0] is the binary). Must not throw. */
export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Default Exec on Bun.spawn. Inherits process.env, overlaid with opts.env. */
export const bunExec: Exec = async (argv, opts = {}) => {
  try {
    const proc = Bun.spawn(argv, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (e) {
    return { code: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
};

class AdapterError extends Error implements PortError {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "PortError";
  }
}

/** Typed failure for port methods (ports.ts: "throw PortError"). */
export function portError(code: string, message: string, retryable = false): PortError {
  return new AdapterError(message, code, retryable);
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
