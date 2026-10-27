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
 *                nothing in the foreground → `pane read` + `pane close`, launch_failed (R4.3, B2)
 * - send       → `herdr agent prompt <pane> <text>`          (submit; bracketed paste + enter)
 *                fallback when no agent is recognized: `pane send-text` + `pane send-keys enter`
 *                without submit: `herdr pane send-text <pane> <text>`
 * - paneState  → `herdr pane get <pane>` (+ `pane read --source visible` when blocked; the prompt
 *                parsed from it, R6.2)
 * - sendKeys   → `herdr pane send-text <pane> <text>` / `herdr pane send-keys <pane> <key>…` (R6.2)
 * - reach      → `herdr agent attach <pane>`                 (the command a person runs, R6.3)
 * - isAlive    → agent pid + start time if recorded, else `pane process-info` (foreground != shell)
 * - kill       → `herdr pane close <pane>` (pane_not_found = already gone)
 * - findSessions → `herdr pane list`                         (agent panes whose cwd is the worktree, R5.1)
 *                `herdr pane process-info --pane <pane>`      (their agent pid)
 * - openForPerson → `herdr workspace list`                  (the workspace on the worktree, else the caller's)
 *                `herdr tab create --workspace W --cwd C --label T` or `herdr workspace create …` (focused)
 *                `herdr pane run <pane> "<command>"`          (MO5, `norn open`)
 * - capabilities: send + resume + open (R4.1, MO5)
 *
 * - openCockpitPane → `herdr pane split [--current] --direction down --ratio 0.3 --cwd C --no-focus`,
 *                `herdr pane rename <pane> norn`, `herdr pane run <pane> "norn cockpit"`   (SPEC-cockpit CP10)
 * - cockpit helpers (agent list, focus, labels, command panes): `./cockpit.ts` (HC6, HC12)
 *
 * Herdr's agent status is one fact among several (§21, C2): `idle`/`done` never completes a step.
 */
import type { AdapterContext, LaunchSpec, PaneState, PersonOpenSpec, ProcessPort, RunnerPort, SessionRef } from "@norn/core";
import type { ProcessIdentity, RunnerConfig } from "@norn/schema";
import { createProcessPort } from "../process/index.ts";
import { portError } from "../process/error.ts";
import { type Exec, bunExec, shellJoin } from "../process/exec.ts";
import { parsePanePrompt } from "./prompt.ts";

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
  /** how long launch waits for the agent to take the pane's foreground (default 10000 ms) */
  startWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface HerdrPane {
  pane_id: string;
  agent?: string | null;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  agent_session?: { value?: string } | null;
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
  const startWaitMs = opts.startWaitMs ?? 10_000;
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
    capabilities: { send: true, resume: true, open: true },

    async available() {
      const r = await exec([...base, "status", "server"]);
      return r.code === 0 && /status:\s*running/.test(r.stdout);
    },

    async openForPerson(spec: PersonOpenSpec): Promise<{ pane_id: string }> {
      const list = (await herdr(["workspace", "list"])) as {
        result?: { workspaces?: Array<{ workspace_id: string; worktree?: { checkout_path?: string } }> };
      } | null;
      const workspaceId = list?.result?.workspaces?.find((w) => w.worktree?.checkout_path === spec.cwd)?.workspace_id ?? spec.env.HERDR_WORKSPACE_ID ?? null;
      const common = ["--cwd", spec.cwd, "--label", spec.title];
      const created = (await herdr(workspaceId ? ["tab", "create", "--workspace", workspaceId, ...common] : ["workspace", "create", ...common])) as {
        result?: { root_pane?: HerdrPane };
      } | null;
      const paneId = created?.result?.root_pane?.pane_id;
      if (!paneId) throw portError("launch_failed", "herdr did not return a root pane");
      await herdr(["pane", "run", paneId, spec.command]);
      return { pane_id: paneId };
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
        // A group gone before `ps` sees it (a short-lived rc-file subshell) is not the agent: keep waiting.
        identity = pid !== null ? await proc.identify(pid) : null;
        if (identity) break;
        if (waited >= startWaitMs) break;
        await sleep(250);
      }

      if (!identity) {
        // R4.3, B2: nothing took the pane's foreground — the command never ran (cut off while the
        // pane's shell started) or exited at once. Not a launch: say what the pane shows, close it.
        const screen = await herdr(["pane", "read", paneId, "--source", "visible", "--lines", "30"]).catch(() => null);
        const shown = typeof screen === "string" ? lastLines(screen, 5) : "";
        await herdr(["pane", "close", paneId]).catch(() => undefined);
        throw portError("launch_failed", `the command never started in herdr pane ${paneId} (no process took the foreground within ${startWaitMs / 1000}s)${shown ? `; the pane showed: ${shown}` : ""}`);
      }
      return { runner: RUNNER_NAME, session_id: paneId, pane_id: paneId, process: identity };
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
        const screen = await herdr(["pane", "read", pane, "--source", "visible", "--lines", "30"]).catch(() => null);
        if (typeof screen === "string" && screen.trim() !== "") {
          result.detail = screen.trim();
          // R6.2, L1: the question, options and pending command, read off the screen
          const prompt = parsePanePrompt(screen);
          if (prompt) result.prompt = prompt;
        }
      }
      return result;
    },

    async sendKeys(session, keys) {
      // R6.2: raw keystrokes into the pane — a blocked agent takes no `agent prompt`; runs of named
      // keys go in one `send-keys`
      const pane = paneOf(session);
      let named: string[] = [];
      const flush = async () => {
        if (named.length) await herdr(["pane", "send-keys", pane, ...named]);
        named = [];
      };
      for (const k of keys) {
        if ("key" in k) named.push(k.key);
        else {
          await flush();
          await herdr(["pane", "send-text", pane, k.text]);
        }
      }
      await flush();
    },

    reach(session) {
      // R6.3, R9.1: what a person runs to look at (and type into) the agent's pane
      return shellJoin([...base, "agent", "attach", paneOf(session)]);
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

    async findSessions(q) {
      const out = (await herdr(["pane", "list"])) as { result?: { panes?: HerdrPane[] } } | null;
      const panes = (out?.result?.panes ?? []).filter((p) => !!p.agent && (p.cwd === q.cwd || p.foreground_cwd === q.cwd));
      const found = [];
      for (const p of panes) {
        const info = await processInfo(p.pane_id);
        const pid = info ? foregroundPid(info) : null;
        const identity = pid !== null ? await proc.identify(pid) : null;
        const session: SessionRef = { runner: RUNNER_NAME, session_id: p.pane_id, pane_id: p.pane_id, ...(identity ? { process: identity } : {}) };
        const agentSession = p.agent_session?.value;
        found.push({ session, ...(agentSession ? { agent_session_id: agentSession } : {}) });
      }
      return found;
    },
  };
}

/** The last `n` non-empty lines of a pane screen, joined with ` | `. */
function lastLines(screen: string, n: number): string {
  return screen
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-n)
    .join(" | ");
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

export interface CockpitPaneOptions {
  bin?: string;
  session?: string;
  exec?: Exec;
  /** caller env; `HERDR_PANE_ID` set (running inside Herdr) → split the calling pane (`--current`) */
  env?: Record<string, string | undefined>;
  /** argv that runs norn (default `["norn"]`); `cockpit` is appended */
  command?: string[];
  /** refresh interval passed as `--interval` (default: the cockpit's own) */
  interval?: string;
  direction?: "down" | "right";
}

/**
 * SPEC-cockpit CP10 (`norn cockpit --open`): split a pane next to the caller (focus stays put) and run
 * `norn cockpit` in it (it writes only through CLI verbs, X1). Returns the new pane.
 */
export async function openCockpitPane(cwd: string, opts: CockpitPaneOptions = {}): Promise<{ pane_id: string }> {
  const herdr = herdrCaller(opts.exec ?? bunExec, [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])]);
  const env = opts.env ?? process.env;
  const target = env.HERDR_PANE_ID ? ["--current"] : [];
  const out = (await herdr(["pane", "split", ...target, "--direction", opts.direction ?? "down", "--ratio", "0.3", "--cwd", cwd, "--no-focus"])) as {
    result?: { pane?: HerdrPane };
  } | null;
  const paneId = out?.result?.pane?.pane_id;
  if (!paneId) throw portError("launch_failed", "herdr pane split did not return a pane");
  await herdr(["pane", "rename", paneId, "norn"]).catch(() => null); // the label is cosmetic
  const argv = [...(opts.command ?? ["norn"]), "cockpit", ...(opts.interval ? ["--interval", opts.interval] : [])];
  await herdr(["pane", "run", paneId, shellJoin(argv)]);
  return { pane_id: paneId };
}
export { parsePanePrompt } from "./prompt.ts";
export * from "./cockpit.ts";
