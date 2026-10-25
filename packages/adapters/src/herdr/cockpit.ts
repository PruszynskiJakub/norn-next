/**
 * Herdr side of the cockpit (`norn pane --interactive`, HC4–HC13): find the agent pane of a run,
 * focus it, label it in Herdr's sidebar, open a pane that runs a command. Presentation only — none
 * of this is a fact for decide (HC13).
 *
 * Command mapping:
 * - listAgents  → `herdr agent list`                                  (pane, cwd, agent session id)
 * - focus       → `herdr agent focus <pane>`
 * - label       → `herdr pane report-metadata <pane> --source norn --title T --state-label S=L… --ttl-ms N`
 * - openCommand → `herdr pane split [--current] --direction right --cwd C --no-focus`, `herdr pane run <pane> <cmd>`
 * - pluginLinked → `herdr plugin list --json`                         (HC11: is norn's plugin linked and enabled)
 */
import { portError } from "../process/error.ts";
import { type Exec, bunExec } from "../process/exec.ts";

export interface HerdrAgent {
  pane_id: string;
  workspace_id: string | null;
  agent: string;
  status: string;
  /** foreground working directory, else the pane's */
  cwd: string | null;
  /** the agent tool's own session id (Claude's session uuid), when Herdr recognized it */
  agent_session_id: string | null;
}

/** HC3: where a run lives, as the inbox item carries it. */
export interface RunReach {
  worktree: string | null;
  agent_session_id: string | null;
  pane_id: string | null;
}

export interface PaneLabel {
  title: string;
  /** Herdr agent status → text shown for it (`idle`, `working`, `blocked`, `done`, `unknown`) */
  state_labels: Record<string, string>;
  ttl_ms: number;
}

export interface HerdrCockpit {
  listAgents(): Promise<HerdrAgent[]>;
  focus(paneId: string): Promise<void>;
  label(paneId: string, label: PaneLabel): Promise<void>;
  /** split a pane beside the caller (focus stays put) and run `command` in it */
  openCommand(cwd: string, command: string, title?: string): Promise<{ pane_id: string }>;
  /** HC11: norn's plugin (`PLUGIN_ID`) is linked — enabled or not; null = not linked */
  pluginLinked(): Promise<{ enabled: boolean; root: string | null } | null>;
}

export interface HerdrCockpitOptions {
  bin?: string;
  session?: string;
  exec?: Exec;
  /** caller env; `HERDR_PANE_ID` set → split the calling pane (`--current`) */
  env?: Record<string, string | undefined>;
}

/** Metadata source id norn's labels are written under (HC12). */
export const LABEL_SOURCE = "norn";
/** Id of norn's Herdr plugin (`plugins/herdr/herdr-plugin.toml`, HC9). */
export const PLUGIN_ID = "norn";

interface ListedAgent {
  pane_id?: string;
  workspace_id?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  agent_session?: { value?: string } | null;
}

const trimSlash = (p: string) => p.replace(/\/+$/, "");

/**
 * HC6: the agent pane of a run — its recorded pane id when Herdr still hosts an agent there, else the
 * agent whose session id is the run's, else the one agent working in the unit worktree. Several
 * candidates → null: the cockpit says so instead of guessing.
 */
export function findAgentPane(agents: readonly HerdrAgent[], reach: RunReach | undefined): string | null {
  if (!reach) return null;
  if (reach.pane_id && agents.some((a) => a.pane_id === reach.pane_id)) return reach.pane_id;
  if (reach.agent_session_id) {
    const bySession = agents.filter((a) => a.agent_session_id === reach.agent_session_id);
    if (bySession.length === 1) return bySession[0]?.pane_id ?? null;
    if (bySession.length > 1) return null;
  }
  if (!reach.worktree) return null;
  const wt = trimSlash(reach.worktree);
  const inWorktree = agents.filter((a) => a.cwd !== null && (trimSlash(a.cwd) === wt || a.cwd.startsWith(`${wt}/`)));
  return inWorktree.length === 1 ? (inWorktree[0]?.pane_id ?? null) : null;
}

export function createHerdrCockpit(opts: HerdrCockpitOptions = {}): HerdrCockpit {
  const exec = opts.exec ?? bunExec;
  const base = [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])];
  const env = opts.env ?? process.env;

  async function herdr(args: string[]): Promise<unknown> {
    const r = await exec([...base, ...args], { timeoutMs: 10_000 });
    if (r.code === 127) throw portError("runner_unavailable", `herdr not runnable: ${r.stderr.trim()}`);
    if (r.code !== 0) throw portError("herdr_error", `herdr ${args.slice(0, 2).join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
    const text = r.stdout.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    async listAgents() {
      const out = (await herdr(["agent", "list"])) as { result?: { agents?: ListedAgent[] } } | null;
      return (out?.result?.agents ?? []).flatMap((a) =>
        a.pane_id && a.agent
          ? [
              {
                pane_id: a.pane_id,
                workspace_id: a.workspace_id ?? null,
                agent: a.agent,
                status: a.agent_status ?? "unknown",
                cwd: a.foreground_cwd ?? a.cwd ?? null,
                agent_session_id: a.agent_session?.value ?? null,
              },
            ]
          : [],
      );
    },
    async focus(paneId) {
      await herdr(["agent", "focus", paneId]);
    },
    async label(paneId, label) {
      const states = Object.entries(label.state_labels).flatMap(([state, text]) => ["--state-label", `${state}=${text}`]);
      await herdr(["pane", "report-metadata", paneId, "--source", LABEL_SOURCE, "--title", label.title, ...states, "--ttl-ms", String(Math.max(1, Math.round(label.ttl_ms)))]);
    },
    async openCommand(cwd, command, title) {
      const target = env.HERDR_PANE_ID ? ["--current"] : [];
      const out = (await herdr(["pane", "split", ...target, "--direction", "right", "--cwd", cwd, "--no-focus"])) as { result?: { pane?: { pane_id?: string } } } | null;
      const paneId = out?.result?.pane?.pane_id;
      if (!paneId) throw portError("launch_failed", "herdr pane split did not return a pane");
      if (title) await herdr(["pane", "rename", paneId, title]).catch(() => null); // cosmetic
      await herdr(["pane", "run", paneId, command]);
      return { pane_id: paneId };
    },
    async pluginLinked() {
      const out = (await herdr(["plugin", "list", "--json"])) as { result?: { plugins?: Array<{ plugin_id?: string; enabled?: boolean; plugin_root?: string }> } } | null;
      const p = out?.result?.plugins?.find((x) => x.plugin_id === PLUGIN_ID);
      return p ? { enabled: p.enabled !== false, root: p.plugin_root ?? null } : null;
    },
  };
}
