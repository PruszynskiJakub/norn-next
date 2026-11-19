/**
 * A `herdr` for the CLI's end-to-end tests, run as a process on PATH as the herdr runner runs the
 * real one. It keeps its workspaces, tabs and panes in the JSON file `$FAKE_HERDR_STATE` and appends
 * every argv (after `--session <name>`) to `$FAKE_HERDR_LOG`, so a test reads what was opened, typed
 * and closed, and in what order.
 *
 * It answers only the commands the herdr runner makes, in herdr 0.9's shapes: JSON on stdout, an
 * error as `{"error": {code, message}}` with exit 1, and exit 2 for a command line it does not know,
 * so a new call shows up as a failing test rather than a guess.
 *
 * A pane is a real process: `pane run` starts the line with `sh -c` in the pane's cwd, with the
 * pane's `--env` over a bare login env (PATH, HOME, TMPDIR), as a fresh herdr shell would give it, and
 * its output goes to the pane's screen file. `process-info` reports that process in the foreground
 * while it lives. Keys and text typed into a pane are appended to its input file, whose path the pane
 * gets as `FAKE_HERDR_INPUT`, so an agent waiting on a dialog sees the answer arrive. A test makes a
 * pane show a dialog by setting its `status` to `blocked` and its `screen`; enter pressed there
 * clears both, as a dialog closes once it is answered. Closing a tab's only pane closes the tab, and
 * closing a workspace's last tab closes the workspace, as herdr does.
 */
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type HerdrPane, type HerdrState, type HerdrTab, type HerdrWorkspace, inputPath, outputPath, SHELL_PID } from "./state.ts";

const statePath = process.env.FAKE_HERDR_STATE as string;
const logPath = process.env.FAKE_HERDR_LOG as string;

function load(): HerdrState {
  return JSON.parse(readFileSync(statePath, "utf8")) as HerdrState;
}

function save(s: HerdrState): void {
  const tmp = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, statePath);
}

function answer(id: string, result: Record<string, unknown>): never {
  process.stdout.write(`${JSON.stringify({ id: `cli:${id}`, result })}\n`);
  process.exit(0);
}

function error(id: string, code: string, message: string): never {
  process.stdout.write(`${JSON.stringify({ error: { code, message }, id: `cli:${id}` })}\n`);
  process.exit(1);
}

function usage(argv: string[]): never {
  process.stderr.write(`fake herdr: no such command: ${argv.join(" ")}\n`);
  process.exit(2);
}

/** `--name value` options (repeatable ones gathered) and the positionals around them. */
function parse(args: string[]): { pos: string[]; opt: Record<string, string[]>; flags: Set<string> } {
  const pos: string[] = [];
  const opt: Record<string, string[]> = {};
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--no-focus") flags.add(a);
    else if (a.startsWith("--")) {
      const v = args[++i];
      if (v === undefined) usage(args);
      opt[a.slice(2)] = [...(opt[a.slice(2)] ?? []), v];
    } else pos.push(a);
  }
  return { pos, opt, flags };
}

const one = (opt: Record<string, string[]>, name: string): string | undefined => opt[name]?.[0];

function envOf(opt: Record<string, string[]>): Record<string, string> {
  return Object.fromEntries((opt.env ?? []).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const paneJson = (p: HerdrPane) => ({ agent_status: p.status ?? "unknown", cwd: p.cwd, focused: false, foreground_cwd: p.cwd, pane_id: p.pane_id, revision: 0, tab_id: p.tab_id, workspace_id: p.workspace_id });
const tabJson = (s: HerdrState, t: HerdrTab) => ({ agent_status: "unknown", focused: false, label: t.label, pane_count: s.panes.filter((p) => p.tab_id === t.tab_id).length, tab_id: t.tab_id, workspace_id: t.workspace_id });
const workspaceJson = (s: HerdrState, w: HerdrWorkspace) => ({ agent_status: "unknown", focused: false, label: w.label, tab_count: s.tabs.filter((t) => t.workspace_id === w.workspace_id).length, workspace_id: w.workspace_id });

function paneOf(s: HerdrState, id: string, cmd: string): HerdrPane {
  const p = s.panes.find((x) => x.pane_id === id);
  if (!p) error(cmd, "pane_not_found", `pane ${id} not found`);
  return p;
}

/** A tab with its root pane in workspace `ws`, which the caller has made or found. */
function openTab(s: HerdrState, ws: string, label: string, opt: Record<string, string[]>): { tab: HerdrTab; pane: HerdrPane } {
  const n = s.next++;
  const tab: HerdrTab = { tab_id: `${ws}:t${n}`, workspace_id: ws, label };
  const pane: HerdrPane = { pane_id: `${ws}:p${n}`, tab_id: tab.tab_id, workspace_id: ws, cwd: one(opt, "cwd") ?? process.cwd(), env: envOf(opt) };
  s.tabs.push(tab);
  s.panes.push(pane);
  return { tab, pane };
}

/** The pane's process, its tab once it has no pane left, and the workspace once it has no tab left. */
function closePane(s: HerdrState, p: HerdrPane): void {
  if (alive(p.pid)) {
    try {
      process.kill(-(p.pid as number), "SIGTERM");
    } catch {
      process.kill(p.pid as number, "SIGTERM");
    }
  }
  s.panes = s.panes.filter((x) => x.pane_id !== p.pane_id);
  if (!s.panes.some((x) => x.tab_id === p.tab_id)) s.tabs = s.tabs.filter((t) => t.tab_id !== p.tab_id);
  if (!s.tabs.some((t) => t.workspace_id === p.workspace_id)) s.workspaces = s.workspaces.filter((w) => w.workspace_id !== p.workspace_id);
}

function run(s: HerdrState, p: HerdrPane, line: string): void {
  const out = openSync(outputPath(statePath, p.pane_id), "a");
  const base = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", TMPDIR: process.env.TMPDIR ?? "/tmp" };
  const env = { ...base, ...p.env, HERDR_ENV: "1", HERDR_PANE_ID: p.pane_id, FAKE_HERDR_INPUT: inputPath(statePath, p.pane_id) };
  const child = spawn("sh", ["-c", line], { cwd: p.cwd, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  closeSync(out);
  p.pid = child.pid;
}

function typed(p: HerdrPane, text: string): void {
  appendFileSync(inputPath(statePath, p.pane_id), text);
}

const argv = process.argv.slice(2);
const args = argv[0] === "--session" ? argv.slice(2) : argv;
appendFileSync(logPath, `${JSON.stringify(args)}\n`);

if (args[0] === "--version") {
  process.stdout.write("herdr 0.9.5 (fake)\n");
  process.exit(0);
}

const [group, verb, ...rest] = args;
const cmd = `${group}:${verb?.replace(/-/g, "_")}`;
const { pos, opt } = parse(rest);
const s = load();

switch (`${group} ${verb}`) {
  case "workspace list":
    answer(cmd, { type: "workspace_list", workspaces: s.workspaces.map((w) => workspaceJson(s, w)) });
    break;
  case "workspace create": {
    const ws: HerdrWorkspace = { workspace_id: `w${s.next++}`, label: one(opt, "label") ?? "workspace" };
    s.workspaces.push(ws);
    // herdr labels a new workspace's first tab with its number; the runner renames it
    const { tab, pane } = openTab(s, ws.workspace_id, "1", opt);
    save(s);
    answer(cmd, { type: "workspace_created", root_pane: paneJson(pane), tab: tabJson(s, tab), workspace: workspaceJson(s, ws) });
    break;
  }
  case "tab list": {
    const ws = one(opt, "workspace");
    answer(cmd, { type: "tab_list", tabs: s.tabs.filter((t) => ws === undefined || t.workspace_id === ws).map((t) => tabJson(s, t)) });
    break;
  }
  case "tab create": {
    const ws = one(opt, "workspace");
    if (!ws || !s.workspaces.some((w) => w.workspace_id === ws)) error(cmd, "workspace_not_found", `workspace ${ws} not found`);
    const { tab, pane } = openTab(s, ws, one(opt, "label") ?? "tab", opt);
    save(s);
    answer(cmd, { type: "tab_created", root_pane: paneJson(pane), tab: tabJson(s, tab) });
    break;
  }
  case "tab rename": {
    const [id, label] = pos;
    const tab = s.tabs.find((t) => t.tab_id === id);
    if (!tab || label === undefined) error(cmd, "tab_not_found", `tab ${id} not found`);
    tab.label = label;
    save(s);
    answer(cmd, { type: "ok" });
    break;
  }
  case "pane list": {
    const ws = one(opt, "workspace");
    answer(cmd, { type: "pane_list", panes: s.panes.filter((p) => ws === undefined || p.workspace_id === ws).map(paneJson) });
    break;
  }
  case "pane get":
    answer(cmd, { type: "pane_info", pane: paneJson(paneOf(s, pos[0] as string, cmd)) });
    break;
  case "pane process-info": {
    const p = paneOf(s, one(opt, "pane") ?? (pos[0] as string), cmd);
    const fg = alive(p.pid) ? (p.pid as number) : SHELL_PID;
    answer(cmd, { type: "pane_process_info", process_info: { foreground_process_group_id: fg, pane_id: p.pane_id, shell_pid: SHELL_PID } });
    break;
  }
  case "pane read": {
    const p = paneOf(s, pos[0] as string, cmd);
    const out = outputPath(statePath, p.pane_id);
    const screen = p.screen ?? (existsSync(out) ? readFileSync(out, "utf8").split("\n").slice(-Number(one(opt, "lines") ?? 30)).join("\n") : "");
    process.stdout.write(screen);
    process.exit(0);
    break;
  }
  case "pane run": {
    const [id, line] = pos;
    const p = paneOf(s, id as string, cmd);
    if (line === undefined) usage(args);
    run(s, p, line);
    save(s);
    answer(cmd, { type: "ok" });
    break;
  }
  case "pane send-text": {
    const [id, text] = pos;
    const p = paneOf(s, id as string, cmd);
    typed(p, text ?? "");
    answer(cmd, { type: "ok" });
    break;
  }
  case "pane send-keys": {
    const [id, ...keys] = pos;
    const p = paneOf(s, id as string, cmd);
    typed(p, keys.map((k) => `<${k}>`).join(""));
    if (keys.includes("enter") && p.status === "blocked") {
      delete p.status;
      delete p.screen;
      save(s);
    }
    answer(cmd, { type: "ok" });
    break;
  }
  case "pane close":
    closePane(s, paneOf(s, pos[0] as string, cmd));
    save(s);
    answer(cmd, { type: "ok" });
    break;
  case "agent prompt":
    // herdr knows no agent of the test harness, so the runner falls back to raw text and enter
    error(cmd, "agent_not_found", `agent target ${pos[0]} not found`);
    break;
  default:
    usage(args);
}
