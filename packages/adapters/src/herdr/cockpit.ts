/**
 * Herdr side of the cockpit (`norn pane --interactive`, HC4–HC13): find the agent pane of a run,
 * focus it or its workspace, label it in Herdr's sidebar, open a pane that runs a command. Presentation only — none
 * of this is a fact for decide (HC13).
 *
 * Command mapping:
 * - listAgents  → `herdr agent list`                                  (pane, cwd, agent session id)
 * - focus       → `herdr agent focus <pane>`
 * - listWorkspaces → `herdr workspace list`, `herdr pane list`         (each workspace with its panes' cwds)
 * - focusWorkspace → `herdr workspace focus <workspace>`
 * - label       → `herdr pane report-metadata <pane> --source norn --title T --state-label S=L… --ttl-ms N`
 * - openCommand → `herdr pane split [--current] --direction right --cwd C --no-focus`, `herdr pane run <pane> <cmd>`
 * - pluginLinked → `herdr plugin list --json`                         (HC11: is norn's plugin linked and enabled)
 * - listPanes   → `herdr pane list`                                   (K7: each pane with its tab, workspace, cwd)
 * - closePane / closeTab / closeWorkspace → `herdr pane|tab|workspace close <id>` (K7; not found = already gone)
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

/** HC15: a Herdr workspace with the panes in it. */
export interface HerdrWorkspace {
  workspace_id: string;
  label: string;
  pane_ids: string[];
  /** foreground working directory of each pane, else the pane's */
  cwds: string[];
}

/** K7: where a pane sits — its tab and workspace — with its working directory and agent status. */
export interface HerdrPaneSpot {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  /** foreground working directory, else the pane's */
  cwd: string | null;
  /** Herdr's agent status (`working`, `idle`, `done`, …); `unknown` without an agent */
  status: string;
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
  listWorkspaces(): Promise<HerdrWorkspace[]>;
  focusWorkspace(workspaceId: string): Promise<void>;
  label(paneId: string, label: PaneLabel): Promise<void>;
  /** split a pane beside the caller (focus stays put) and run `command` in it */
  openCommand(cwd: string, command: string, title?: string): Promise<{ pane_id: string }>;
  /** HC11: norn's plugin (`PLUGIN_ID`) is linked — enabled or not; null = not linked */
  pluginLinked(): Promise<{ enabled: boolean; root: string | null } | null>;
  /** K7: every pane with its tab and workspace */
  listPanes(): Promise<HerdrPaneSpot[]>;
  /** K7: close one pane, tab or workspace; one that is already gone is not an error */
  closePane(paneId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  closeWorkspace(workspaceId: string): Promise<void>;
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

interface ListedPane {
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
}

const trimSlash = (p: string) => p.replace(/\/+$/, "");
/** `cwd` is the worktree or a folder in it. */
export const inside = (cwd: string, worktree: string) => {
  const wt = trimSlash(worktree);
  return trimSlash(cwd) === wt || cwd.startsWith(`${wt}/`);
};

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
  const wt = reach.worktree;
  const inWorktree = agents.filter((a) => a.cwd !== null && inside(a.cwd, wt));
  return inWorktree.length === 1 ? (inWorktree[0]?.pane_id ?? null) : null;
}

/**
 * HC15: the workspace of a run — the one holding its recorded pane, else the one workspace with a
 * pane in the unit worktree. Several candidates → null, as for panes (HC6).
 */
export function findWorkspace(workspaces: readonly HerdrWorkspace[], reach: RunReach | undefined): string | null {
  if (!reach) return null;
  const byPane = reach.pane_id ? workspaces.find((w) => w.pane_ids.includes(reach.pane_id as string)) : undefined;
  if (byPane) return byPane.workspace_id;
  const wt = reach.worktree;
  if (!wt) return null;
  const inWorktree = workspaces.filter((w) => w.cwds.some((c) => inside(c, wt)));
  return inWorktree.length === 1 ? (inWorktree[0]?.workspace_id ?? null) : null;
}

export function createHerdrCockpit(opts: HerdrCockpitOptions = {}): HerdrCockpit {
  const exec = opts.exec ?? bunExec;
  const base = [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])];
  const env = opts.env ?? process.env;

  async function herdr(args: string[]): Promise<unknown> {
    const r = await exec([...base, ...args], { timeoutMs: 10_000 });
    if (r.code === 127) throw portError("runner_unavailable", `herdr not runnable: ${r.stderr.trim()}`);
    if (r.code !== 0) {
      const message = `herdr ${args.slice(0, 2).join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`;
      throw portError(/"code"\s*:\s*"(pane|tab|workspace)_not_found"/.test(r.stderr) ? "session_gone" : "herdr_error", message);
    }
    const text = r.stdout.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** K7: close one thing; one already gone is not an error. */
  async function close(kind: "pane" | "tab" | "workspace", id: string): Promise<void> {
    try {
      await herdr([kind, "close", id]);
    } catch (err) {
      if ((err as { code?: string }).code !== "session_gone") throw err;
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
    async listWorkspaces() {
      const ws = (await herdr(["workspace", "list"])) as { result?: { workspaces?: Array<{ workspace_id?: string; label?: string }> } } | null;
      const ps = (await herdr(["pane", "list"])) as { result?: { panes?: ListedPane[] } } | null;
      const panes = ps?.result?.panes ?? [];
      return (ws?.result?.workspaces ?? []).flatMap((w) => {
        if (!w.workspace_id) return [];
        const mine = panes.filter((p) => p.workspace_id === w.workspace_id && p.pane_id);
        return [
          {
            workspace_id: w.workspace_id,
            label: w.label ?? "",
            pane_ids: mine.map((p) => p.pane_id as string),
            cwds: mine.flatMap((p) => {
              const cwd = p.foreground_cwd ?? p.cwd;
              return cwd ? [cwd] : [];
            }),
          },
        ];
      });
    },
    async focusWorkspace(workspaceId) {
      await herdr(["workspace", "focus", workspaceId]);
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
    async listPanes() {
      const out = (await herdr(["pane", "list"])) as { result?: { panes?: ListedPane[] } } | null;
      return (out?.result?.panes ?? []).flatMap((p) =>
        p.pane_id && p.tab_id && p.workspace_id
          ? [{ pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id, cwd: p.foreground_cwd ?? p.cwd ?? null, status: p.agent_status ?? "unknown" }]
          : [],
      );
    },
    closePane: (id) => close("pane", id),
    closeTab: (id) => close("tab", id),
    closeWorkspace: (id) => close("workspace", id),
  };
}
