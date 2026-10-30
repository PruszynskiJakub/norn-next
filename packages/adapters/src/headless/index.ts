/**
 * Headless runner (RunnerPort): starts the agent's non-interactive command as a detached
 * background process in the unit worktree, env included (A6), stdout+stderr appended to a log
 * file in the trace dir. Liveness is pid + start time (K3), so a reused pid never counts.
 *
 * There is no pane to type into: `send` throws PortError `unsupported`. Per B2 the caller then
 * continues the same agent session by launching `AgentAdapter.launchCommand({ resume })` through
 * this runner, or starts a fresh session from the handoff — capabilities `send: false, resume: true`
 * (R4.1). `findSessions` looks for a run's process by its `NORN_RUN` env (R5.1). `output` is the head
 * of the run's log (B3).
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AdapterContext, LaunchSpec, PaneState, ProcessPort, RunnerPort, SessionRef } from "@norn/core";
import type { RunnerConfig } from "@norn/schema";
import { noteSpawn, runnerLogDir } from "@norn/store";
import { portError } from "../exec.ts";
import { createProcessPort } from "../process/index.ts";

export const RUNNER_NAME = "headless";

export interface HeadlessRunnerOptions {
  /** directory for `<run_id>.log` (the caller's trace dir) */
  logDir: string;
  process?: ProcessPort;
  /** grace between SIGTERM and SIGKILL (default 3000 ms) */
  killGraceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Log file for a run: `<logDir>/<run_id>.log`. */
export function logPath(logDir: string, runId: string): string {
  return join(logDir, `${runId}.log`);
}

export function createHeadlessRunner(opts: HeadlessRunnerOptions): RunnerPort {
  const proc = opts.process ?? createProcessPort();
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const grace = opts.killGraceMs ?? 3000;

  return {
    name: RUNNER_NAME,
    capabilities: { send: false, resume: true },

    async available() {
      return true;
    },

    async findSessions(q) {
      // the run's process carries NORN_RUN (A6); its session id is the run id, as launch records it
      const procs = proc.findByEnv ? await proc.findByEnv("NORN_RUN", q.run_id).catch(() => []) : [];
      return procs.map((p) => ({ session: { runner: RUNNER_NAME, session_id: q.run_id, process: p } }));
    },

    async launch(spec: LaunchSpec): Promise<SessionRef> {
      const [cmd, ...args] = spec.argv;
      if (!cmd) throw portError("launch_failed", "empty argv");
      const log = logPath(opts.logDir, spec.run_id);
      mkdirSync(dirname(log), { recursive: true });
      const fd = openSync(log, "a");
      let pid: number | undefined;
      try {
        noteSpawn(spec.argv, spec.cwd);
        const child = spawn(cmd, args, {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env },
          detached: true, // own process group: survives the tick, killable as a group
          stdio: ["ignore", fd, fd],
        });
        pid = await new Promise<number | undefined>((resolve, reject) => {
          child.once("spawn", () => resolve(child.pid));
          child.once("error", reject);
        });
        child.unref();
      } catch (err) {
        throw portError("launch_failed", `cannot start ${cmd}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        closeSync(fd);
      }
      if (!pid) throw portError("launch_failed", `no pid for ${cmd}`);
      const identity = await proc.identify(pid);
      if (!identity) throw portError("launch_failed", `${cmd} exited immediately; see ${log}`);
      return { runner: RUNNER_NAME, session_id: spec.run_id, process: identity };
    },

    async output(session) {
      // B3: the head of the run's log — why a run that exited at once never started
      try {
        return headOf(readFileSync(logPath(opts.logDir, session.session_id), "utf8"), OUTPUT_LINES);
      } catch {
        return null;
      }
    },

    async send() {
      throw portError("unsupported", "headless sessions take no input; resume via the agent's resume command (B2)");
    },

    async paneState(session): Promise<PaneState> {
      // No screen to read: report liveness only, never a completion signal (C2).
      return { alive: await this.isAlive(session), state: "unknown", since: null };
    },

    async isAlive(session) {
      return session.process ? proc.isAlive(session.process) : false;
    },

    async kill(session) {
      const p = session.process;
      if (!p || !(await proc.isAlive(p))) return; // gone, or pid reused by someone else
      signal(p.pid, "SIGTERM");
      for (let waited = 0; waited < grace; waited += 100) {
        await sleep(100);
        if (!(await proc.isAlive(p))) return;
      }
      if (await proc.isAlive(p)) signal(p.pid, "SIGKILL");
    },
  };
}

const OUTPUT_LINES = 5;
const OUTPUT_CHARS = 600;

/** The first `n` non-empty lines of a log, joined with ` | ` and capped; null when there are none. */
function headOf(text: string, n: number): string | null {
  const head = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, n)
    .join(" | ");
  if (!head) return null;
  return head.length > OUTPUT_CHARS ? `${head.slice(0, OUTPUT_CHARS - 1)}…` : head;
}

/** Signal the process group (detached leader), falling back to the pid alone. */
function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      /* already gone */
    }
  }
}

/** RunnerFactory: option `log_dir` (default store's `runnerLogDir`, machine-local). */
export const headlessFactory = (ctx: AdapterContext, config: RunnerConfig): RunnerPort => {
  const dir = config.options?.log_dir;
  return createHeadlessRunner({
    logDir: typeof dir === "string" ? dir : runnerLogDir(ctx.repoRoot),
  });
};
