/**
 * Herdr runner (RunnerPort, default cockpit). Drives the `herdr` CLI, which talks to the
 * running Herdr server over its socket and answers JSON (errors: JSON on stderr, exit 1).
 *
 * Command mapping:
 * - available  → `herdr status server`                       (running?)
 * - launch     → `herdr workspace list`                      (find the unit worktree's workspace)
 *                `herdr tab create --workspace W --cwd C --label T --env K=V… --no-focus`
 *                  or `herdr workspace create --cwd C --label T --env K=V… --no-focus`
 *                `herdr pane run <pane> "<argv>"`             (A6 env comes from --env)
 *                `herdr pane process-info --pane <pane>`      (record the agent's pid + start time)
 * - send       → `herdr agent prompt <pane> <text>`          (submit; bracketed paste + enter)
 *                fallback when no agent is recognized: `pane send-text` + `pane send-keys enter`
 *                without submit: `herdr pane send-text <pane> <text>`
 * - paneState  → `herdr pane get <pane>` (+ `pane read --source visible` when blocked)
 * - isAlive    → agent pid + start time if recorded, else `pane process-info` (foreground != shell)
 * - kill       → `herdr pane close <pane>` (pane_not_found = already gone)
 *
 * - openStatusPane → `herdr pane split [--current] --direction down --ratio 0.3 --cwd C --no-focus`,
 *                `herdr pane rename <pane> norn`, `herdr pane run <pane> "norn pane"`   (O1 status pane)
 *
 * Herdr's agent status is one fact among several (§21, C2): `idle`/`done` never completes a step.
 */
import type { AdapterContext, LaunchSpec, PaneState, ProcessPort, RunnerPort, SessionRef } from "@norn/core";
import type { ProcessIdentity, RunnerConfig } from "@norn/schema";
import { createProcessPort } from "../process/index.ts";
import { portError } from "../process/error.ts";
import { type Exec, bunExec, shellJoin } from "../process/exec.ts";

export const RUNNER_NAME = "herdr";

export interface HerdrRunnerOptions {
  /** herdr binary (default `herdr`) */
  bin?: string;
  /** named Herdr session (`--session <name>`); default = the user's default session */
  session?: string;
  /** reuse a workspace whose worktree is the unit cwd, adding a tab (default true) */
  reuseWorkspace?: boolean;
  exec?: Exec;
  process?: ProcessPort;
  /** how long launch waits for the agent to take the pane's foreground (default 3000 ms) */
  startWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface HerdrPane {
  pane_id: string;
  agent?: string | null;
  agent_status?: string;
}

interface ProcessInfo {
  foreground_process_group_id?: number | null;
  shell_pid?: number | null;
}

const STATE_MAP: Record<string, PaneState["state"]> = {
  working: "working",
  idle: "idle",
  blocked: "waiting_input",
  done: "done",
  unknown: "unknown",
};

/** Herdr error codes that mean the pane (and so the session) no longer exists. */
const GONE = new Set(["pane_not_found", "tab_not_found", "workspace_not_found"]);

/** Run one herdr command; parse JSON stdout (empty stdout → null). Throws PortError on failure. */
function herdrCaller(exec: Exec, base: string[]) {
  return async function herdr(args: string[]): Promise<unknown> {
    const r = await exec([...base, ...args]);
    if (r.code === 127) throw portError("runner_unavailable", `herdr not runnable: ${r.stderr.trim()}`);
    if (r.code !== 0) {
      const err = parseError(r.stderr) ?? parseError(r.stdout);
      const code = err?.code ?? "herdr_error";
      const message = `herdr ${args.slice(0, 2).join(" ")}: ${err?.message ?? (r.stderr.trim() || `exit ${r.code}`)}`;
      if (GONE.has(code)) throw portError("session_gone", message);
      if (code === "agent_blocked") throw portError("session_blocked", message, true);
      throw portError(code === "herdr_error" ? code : `herdr_${code}`, message, code === "timeout");
    }
    // Control commands answer JSON; `pane read` and input commands print plain text or nothing.
    const text = r.stdout.trim();
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return r.stdout;
    }
  };
}

export function createHerdrRunner(opts: HerdrRunnerOptions = {}): RunnerPort {
  const exec = opts.exec ?? bunExec;
  const proc = opts.process ?? createProcessPort({ exec });
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const startWaitMs = opts.startWaitMs ?? 3000;
  const base = [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])];

  const herdr = herdrCaller(exec, base);

  async function processInfo(paneId: string): Promise<ProcessInfo | null> {
    try {
      const out = (await herdr(["pane", "process-info", "--pane", paneId])) as { result?: { process_info?: ProcessInfo } };
      return out?.result?.process_info ?? {};
    } catch (err) {
      if ((err as { code?: string }).code === "session_gone") return null;
      throw err;
    }
  }

  /** The pane's foreground process group leader when something other than the shell runs. */
  function foregroundPid(info: ProcessInfo): number | null {
    const fg = info.foreground_process_group_id;
    return typeof fg === "number" && fg > 0 && fg !== info.shell_pid ? fg : null;
  }

  return {
    name: RUNNER_NAME,

    async available() {
      const r = await exec([...base, "status", "server"]);
      return r.code === 0 && /status:\s*running/.test(r.stdout);
    },

    async launch(spec: LaunchSpec): Promise<SessionRef> {
      const envFlags = Object.entries(spec.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
      const common = ["--cwd", spec.cwd, "--label", spec.title, ...envFlags, "--no-focus"];

      let workspaceId: string | null = null;
      if (opts.reuseWorkspace ?? true) {
        const list = (await herdr(["workspace", "list"])) as {
          result?: { workspaces?: Array<{ workspace_id: string; worktree?: { checkout_path?: string } }> };
        };
        workspaceId = list?.result?.workspaces?.find((w) => w.worktree?.checkout_path === spec.cwd)?.workspace_id ?? null;
      }
      const created = (await herdr(
        workspaceId ? ["tab", "create", "--workspace", workspaceId, ...common] : ["workspace", "create", ...common],
      )) as { result?: { root_pane?: HerdrPane } };
      const paneId = created?.result?.root_pane?.pane_id;
      if (!paneId) throw portError("launch_failed", "herdr did not return a root pane");

      await herdr(["pane", "run", paneId, shellJoin(spec.argv)]);

      // `pane run` acknowledges admission only; wait briefly for the agent to own the foreground.
      let identity: ProcessIdentity | null = null;
      for (let waited = 0; ; waited += 250) {
        const info = await processInfo(paneId);
        const pid = info ? foregroundPid(info) : null;
        if (pid !== null) {
          identity = await proc.identify(pid);
          break;
        }
        if (waited >= startWaitMs) break;
        await sleep(250);
      }

      const ref: SessionRef = { runner: RUNNER_NAME, session_id: paneId, pane_id: paneId };
      if (identity) ref.process = identity;
      return ref;
    },

    async send(session, text, sendOpts) {
      const pane = paneOf(session);
      if (!sendOpts?.submit) {
        await herdr(["pane", "send-text", pane, text]);
        return;
      }
      try {
        await herdr(["agent", "prompt", pane, text]);
      } catch (err) {
        // No recognized agent in the pane (e.g. an unsupported tool): type raw text + enter.
        if ((err as { code?: string }).code !== "herdr_agent_not_found") throw err;
        await herdr(["pane", "send-text", pane, text]);
        await herdr(["pane", "send-keys", pane, "enter"]);
      }
    },

    async paneState(session): Promise<PaneState> {
      const pane = paneOf(session);
      let info: HerdrPane | undefined;
      try {
        const out = (await herdr(["pane", "get", pane])) as { result?: { pane?: HerdrPane } };
        info = out?.result?.pane;
      } catch (err) {
        if ((err as { code?: string }).code === "session_gone") return { alive: false, state: "unknown", since: null };
        throw err;
      }
      const alive = await this.isAlive(session);
      const state = STATE_MAP[info?.agent_status ?? "unknown"] ?? "unknown";
      const result: PaneState = { alive, state, since: null };
      if (state === "waiting_input") {
        const screen = await herdr(["pane", "read", pane, "--source", "visible", "--lines", "15"]).catch(() => null);
        if (typeof screen === "string" && screen.trim() !== "") result.detail = screen.trim();
      }
      return result;
    },

    async isAlive(session) {
      if (session.process) return proc.isAlive(session.process);
      const info = await processInfo(paneOf(session));
      return info !== null && foregroundPid(info) !== null;
    },

    async kill(session) {
      try {
        await herdr(["pane", "close", paneOf(session)]);
      } catch (err) {
        if ((err as { code?: string }).code !== "session_gone") throw err;
      }
    },
  };
}

function paneOf(session: SessionRef): string {
  const pane = session.pane_id ?? session.session_id;
  if (!pane) throw portError("bad_session", "herdr session has no pane id");
  return pane;
}

function parseError(text: string): { code?: string; message?: string } | null {
  try {
    const parsed = JSON.parse(text.trim()) as { error?: { code?: string; message?: string } };
    return parsed?.error ?? null;
  } catch {
    return null;
  }
}

/** RunnerFactory: options `bin`, `session`, `reuse_workspace` from RunnerConfig.options. */
export const herdrFactory = (_ctx: AdapterContext, config: RunnerConfig): RunnerPort => {
  const o = config.options ?? {};
  const opts: HerdrRunnerOptions = {};
  if (typeof o.bin === "string") opts.bin = o.bin;
  if (typeof o.session === "string") opts.session = o.session;
  if (typeof o.reuse_workspace === "boolean") opts.reuseWorkspace = o.reuse_workspace;
  return createHerdrRunner(opts);
};

export interface StatusPaneOptions {
  bin?: string;
  session?: string;
  exec?: Exec;
  /** caller env; `HERDR_PANE_ID` set (running inside Herdr) → split the calling pane (`--current`) */
  env?: Record<string, string | undefined>;
  /** argv that runs norn (default `["norn"]`); `pane` is appended */
  command?: string[];
  /** refresh interval passed as `--interval` (default: `norn pane`'s own) */
  interval?: string;
  direction?: "down" | "right";
}

/**
 * O1 "a Herdr status pane": split a pane next to the caller (focus stays put) and run
 * `norn pane` in it — a read-only inbox view that refreshes itself (X1). Returns the new pane.
 */
export async function openStatusPane(cwd: string, opts: StatusPaneOptions = {}): Promise<{ pane_id: string }> {
  const herdr = herdrCaller(opts.exec ?? bunExec, [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])]);
  const env = opts.env ?? process.env;
  const target = env.HERDR_PANE_ID ? ["--current"] : [];
  const out = (await herdr(["pane", "split", ...target, "--direction", opts.direction ?? "down", "--ratio", "0.3", "--cwd", cwd, "--no-focus"])) as {
    result?: { pane?: HerdrPane };
  } | null;
  const paneId = out?.result?.pane?.pane_id;
  if (!paneId) throw portError("launch_failed", "herdr pane split did not return a pane");
  await herdr(["pane", "rename", paneId, "norn"]).catch(() => null); // the label is cosmetic
  const argv = [...(opts.command ?? ["norn"]), "pane", ...(opts.interval ? ["--interval", opts.interval] : [])];
  await herdr(["pane", "run", paneId, shellJoin(argv)]);
  return { pane_id: paneId };
}
