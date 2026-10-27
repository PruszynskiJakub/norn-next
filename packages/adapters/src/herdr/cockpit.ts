/**
 * Herdr side of the cockpit (`norn cockpit`, HC6–HC15, SPEC-cockpit): find the agent pane of a run,
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
 * - openWorkspace → `herdr workspace create --cwd C --label L --focus|--no-focus`, `herdr pane run <root pane> <cmd>` (orient)
 * - reportWorkspace → `herdr workspace report-metadata <w> --source norn --token name=value… --ttl-ms N` (sidebar `$name` rows)
 * - moveWorkspace → socket API `workspace.move {workspace_id, insert_index}` (no CLI verb reorders workspaces)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { type Exec, bunExec, portError } from "../exec.ts";
import { herdrCaller, splitAndRun } from "./call.ts";

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
  /** a new workspace in `cwd` running `command` in its root pane; focused unless `focus` is false */
  openWorkspace(cwd: string, label: string, command: string, focus?: boolean): Promise<{ workspace_id: string; pane_id: string }>;
  /** sidebar tokens of a workspace (`$name` in `[ui.sidebar.spaces] rows`), gone after `ttlMs` */
  reportWorkspace(workspaceId: string, tokens: Record<string, string>, ttlMs: number): Promise<void>;
  /** move a workspace to `index` (0 = first) in the sidebar */
  moveWorkspace(workspaceId: string, index: number): Promise<void>;
}

/** One request over Herdr's socket API: a JSON line out, a JSON line back. */
export type HerdrSocketCall = (request: { id: string; method: string; params: Record<string, unknown> }) => Promise<unknown>;

export interface HerdrCockpitOptions {
  bin?: string;
  session?: string;
  exec?: Exec;
  /** caller env; `HERDR_PANE_ID` set → split the calling pane (`--current`) */
  env?: Record<string, string | undefined>;
  /** socket API caller (tests); default: a unix socket connection to the session's `herdr.sock` */
  socket?: HerdrSocketCall;
}

/**
 * The session's socket: `$HERDR_SOCKET_PATH` (inside Herdr), else `sessions/<session>/herdr.sock` for a
 * named session, else the default `herdr.sock`, under `$XDG_CONFIG_HOME/herdr` (default `~/.config/herdr`).
 */
export function herdrSocketPath(env: Record<string, string | undefined>, session?: string): string {
  if (!session && env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  const dir = join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config"), "herdr");
  return session ? join(dir, "sessions", session, "herdr.sock") : join(dir, "herdr.sock");
}

/** The real socket call: one connection per request, closed after the first reply line. */
export function unixSocketCall(path: string, timeoutMs = 5_000): HerdrSocketCall {
  return (request) =>
    new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(portError("herdr_error", `herdr socket ${path}: no reply in ${timeoutMs} ms`)), timeoutMs);
      const finish = (s: { end(): void } | null) => {
        clearTimeout(timer);
        s?.end();
        const line = buf.split("\n")[0] ?? "";
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(portError("herdr_error", `herdr socket ${path}: unreadable reply`));
        }
      };
      Bun.connect({
        unix: path,
        socket: {
          open: (s) => void s.write(`${JSON.stringify(request)}\n`),
          data: (s, d) => {
            buf += new TextDecoder().decode(d);
            if (buf.includes("\n")) finish(s);
          },
          close: () => (buf ? finish(null) : undefined),
          error: (_s, e) => {
            clearTimeout(timer);
            reject(portError("herdr_error", `herdr socket ${path}: ${e.message}`));
          },
        },
      }).catch((e: Error) => {
        clearTimeout(timer);
        reject(portError("runner_unavailable", `herdr socket ${path}: ${e.message}`));
      });
    });
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
  const env = opts.env ?? process.env;
  // the cockpit answers keystrokes: a hung herdr must not hang it (H11); its errors keep the raw stderr
  const herdr = herdrCaller(opts.exec ?? bunExec, { ...opts, timeoutMs: 10_000, errors: "raw" });
  const socket = opts.socket ?? unixSocketCall(herdrSocketPath(env, opts.session));
  let requests = 0;

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
      return splitAndRun(herdr, { cwd, direction: "right", current: !!env.HERDR_PANE_ID, ...(title ? { title } : {}), command });
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
    async openWorkspace(cwd, label, command, focus = true) {
      const out = (await herdr(["workspace", "create", "--cwd", cwd, "--label", label, focus ? "--focus" : "--no-focus"])) as {
        result?: { root_pane?: { pane_id?: string; workspace_id?: string } };
      } | null;
      const pane = out?.result?.root_pane;
      if (!pane?.pane_id || !pane.workspace_id) throw portError("launch_failed", "herdr workspace create did not return a root pane");
      await herdr(["pane", "run", pane.pane_id, command]);
      return { workspace_id: pane.workspace_id, pane_id: pane.pane_id };
    },
    async reportWorkspace(workspaceId, tokens, ttlMs) {
      const flags = Object.entries(tokens).flatMap(([name, value]) => ["--token", `${name}=${value}`]);
      await herdr(["workspace", "report-metadata", workspaceId, "--source", LABEL_SOURCE, ...flags, "--ttl-ms", String(Math.max(1, Math.round(ttlMs)))]);
    },
    async moveWorkspace(workspaceId, index) {
      const reply = (await socket({ id: `norn:workspace.move:${++requests}`, method: "workspace.move", params: { workspace_id: workspaceId, insert_index: index } })) as {
        error?: { code?: string; message?: string };
      } | null;
      if (reply?.error) throw portError(reply.error.code === "workspace_not_found" ? "session_gone" : "herdr_error", `herdr workspace.move: ${reply.error.message ?? reply.error.code ?? "error"}`);
    },
  };
}
