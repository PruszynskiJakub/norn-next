/**
 * Run a check command (W2, C5): `sh -c` in the unit worktree with env, stdout+stderr merged,
 * killed as a process group on timeout (a timeout is a `fail` with reason `timeout`).
 */
import { spawn } from "node:child_process";

export interface ShellResult {
  /** null when killed by timeout */
  exit_code: number | null;
  output: string;
  duration_ms: number;
  timed_out: boolean;
}

/** Output kept in memory; the head is dropped beyond this (the tail matters, C5). */
const MAX_OUTPUT = 4 * 1024 * 1024;

export function runShell(command: string, opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number }): Promise<ShellResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    const child = spawn("sh", ["-c", `exec 2>&1\n${command}`], {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const add = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > MAX_OUTPUT) out = out.slice(out.length - MAX_OUTPUT);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const finish = (code: number | null, err?: Error) => {
      clearTimeout(timer);
      if (err) out += `\n${err.message}\n`;
      resolve({ exit_code: timedOut ? null : (code ?? 127), output: out, duration_ms: Date.now() - started, timed_out: timedOut });
    };
    child.on("error", (e) => finish(127, e));
    child.on("close", (code) => finish(code));
  });
}

export function tailLines(text: string, n = 200): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.slice(-n).join("\n");
}
