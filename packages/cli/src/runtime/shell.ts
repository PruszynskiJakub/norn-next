/**
 * Run a check command (W2, C5): `sh -c` in the unit worktree with env, stdout+stderr merged,
 * killed as a process group on timeout (a timeout is a `fail` with reason `timeout`).
 */
import { noteSpawn, spawnBounded } from "@norn/store";

export interface ShellResult {
  /** null when killed by timeout */
  exit_code: number | null;
  output: string;
  duration_ms: number;
  timed_out: boolean;
}

/** Output kept in memory; the head is dropped beyond this (the tail matters, C5). */
const MAX_OUTPUT = 4 * 1024 * 1024;

export async function runShell(command: string, opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number }): Promise<ShellResult> {
  const started = Date.now();
  noteSpawn(["sh", "-c", command], opts.cwd); // effect transcripts (refactor Phase 0.2)
  // `exec 2>&1`: the command's stderr goes to stdout, so `out` keeps both in order; stderr only
  // carries a failure to start sh and spawnBounded's own timeout note, which a check's output never showed
  const r = await spawnBounded(["sh", "-c", `exec 2>&1\n${command}`], {
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs,
    maxOutputChars: MAX_OUTPUT,
    unobserved: true,
  });
  const output = r.timed_out ? r.stdout : r.code === 127 && !r.stdout ? `\n${r.stderr}\n` : r.stdout + r.stderr;
  return { exit_code: r.timed_out ? null : r.code, output, duration_ms: Date.now() - started, timed_out: r.timed_out };
}

export function tailLines(text: string, n = 200): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.slice(-n).join("\n");
}
