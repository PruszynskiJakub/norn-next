/**
 * Injectable command runner. Adapters build argv and hand it to an `Exec`; tests pass a
 * fake that replays recorded fixtures (X4), production uses `bunExec`.
 */
export interface ExecOptions {
  cwd?: string;
  /** full environment for the child; omitted = inherit */
  env?: Record<string, string | undefined>;
  stdin?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  /** exit code; 127 when the executable could not be started */
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Run argv with Bun.spawn and collect output. Never throws for a missing binary (code 127). */
export const bunExec: Exec = async (argv, opts = {}) => {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(argv, {
      cwd: opts.cwd,
      env: opts.env as Record<string, string> | undefined,
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeoutMs,
    });
  } catch (err) {
    return { code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

/** POSIX-shell quote one word. */
export function shellQuote(word: string): string {
  if (word !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Join argv into one POSIX command line. */
export function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}
