import { describe, expect, test } from "bun:test";
import { createHerdrCockpit, findAgentPane, findWorkspace, type HerdrAgent, type HerdrSocketCall, herdrSocketPath } from "../../src/herdr/cockpit.ts";
import herdrFixtures from "./fixtures/herdr.json";
import { createHerdrNotifier, herdrNotifyArgv } from "../../src/notify/index.ts";
import type { Exec, ExecResult } from "../../src/exec.ts";
import agentList from "./fixtures/agent-list.json";
import paneList from "./fixtures/pane-list.json";
import workspaceList from "./fixtures/workspace-list.json";

const ok = (v: unknown): ExecResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
const empty: ExecResult = { code: 0, stdout: "", stderr: "" };

function fakeExec(rules: Array<[string, ExecResult]>) {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => {
    calls.push(argv);
    const key = argv.slice(1).join(" ");
    const rule = rules.find(([prefix]) => key.startsWith(prefix));
    if (!rule) throw new Error(`unexpected herdr call: ${key}`);
    return rule[1];
  };
  return { exec, calls };
}

const item = { id: "attended:gh-1:R:t", group: "your_turn" as const, story: "gh-1", slice: null, step: "refine", title: "refine: the agent is waiting for you", command: "cd /wt", since: "2026-10-25T12:00:00.000Z" };

describe("herdr cockpit (HC6, HC12)", () => {
  test("listAgents reads `herdr agent list`: foreground cwd and the agent's own session id", async () => {
    const { exec } = fakeExec([["agent list", ok(agentList)]]);
    const agents = await createHerdrCockpit({ exec }).listAgents();
    expect(agents[0]).toEqual({ pane_id: "w2:p5", workspace_id: "w2", agent: "claude", status: "idle", cwd: "/repo-worktrees/gh-1-login", agent_session_id: "sess-refine" });
    expect(agents[2]?.agent_session_id).toBeNull();
  });

  test("findAgentPane: recorded pane, then session id, then the one agent in the worktree; never a guess", async () => {
    const { exec } = fakeExec([["agent list", ok(agentList)]]);
    const agents: HerdrAgent[] = await createHerdrCockpit({ exec }).listAgents();
    const reach = (r: Partial<{ worktree: string; agent_session_id: string; pane_id: string }>) => ({ worktree: null, agent_session_id: null, pane_id: null, ...r });
    expect(findAgentPane(agents, reach({ pane_id: "w2:p1", agent_session_id: "sess-refine" }))).toBe("w2:p1");
    expect(findAgentPane(agents, reach({ pane_id: "w9:p9", agent_session_id: "sess-refine" }))).toBe("w2:p5");
    // the session is not in Herdr (another agent took the pane): fall back to the worktree
    expect(findAgentPane(agents, reach({ agent_session_id: "gone", worktree: "/repo-worktrees/gh-1-login/" }))).toBe("w2:p5");
    // two agents in one worktree (one in a subfolder): ambiguous
    expect(findAgentPane(agents, reach({ worktree: "/repo-worktrees/gh-2-search" }))).toBeNull();
    expect(findAgentPane(agents, reach({ worktree: "/repo-worktrees/gh-3-none" }))).toBeNull();
    expect(findAgentPane(agents, undefined)).toBeNull();
  });

  test("focus, label and openCommand argv", async () => {
    const { exec, calls } = fakeExec([
      ["agent focus", empty],
      ["pane report-metadata", empty],
      ["pane split", ok({ result: { pane: { pane_id: "w2:p7" } } })],
      ["pane rename", empty],
      ["pane run", empty],
    ]);
    const c = createHerdrCockpit({ exec, env: { HERDR_PANE_ID: "w2:p3" } });
    await c.focus("w2:p5");
    await c.label("w2:p5", { title: "gh-1 · refine", state_labels: { idle: "norn: your turn" }, ttl_ms: 15_000 });
    expect(await c.openCommand("/repo", "cd /wt && claude 'go'", "gh-1 refine")).toEqual({ pane_id: "w2:p7" });
    expect(calls.map((a) => a.slice(1))).toEqual([
      ["agent", "focus", "w2:p5"],
      ["pane", "report-metadata", "w2:p5", "--source", "norn", "--title", "gh-1 · refine", "--state-label", "idle=norn: your turn", "--ttl-ms", "15000"],
      ["pane", "split", "--current", "--direction", "right", "--cwd", "/repo", "--no-focus"],
      ["pane", "rename", "w2:p7", "gh-1 refine"],
      ["pane", "run", "w2:p7", "cd /wt && claude 'go'"],
    ]);
  });
});

test("openBelow splits a short pane below the caller without focus, names it, runs the command (B12)", async () => {
  const { exec, calls } = fakeExec([["pane split", ok({ result: { pane: { pane_id: "w1:p3" } } })], ["pane rename", empty], ["pane run", empty]]);
  expect(await createHerdrCockpit({ exec, env: { HERDR_PANE_ID: "w1:p1" } }).openBelow("/repo", "norn status --watch", "norn")).toEqual({ pane_id: "w1:p3" });
  expect(calls.map((a) => a.slice(1))).toEqual([
    ["pane", "split", "--current", "--direction", "down", "--ratio", "0.3", "--cwd", "/repo", "--no-focus"],
    ["pane", "rename", "w1:p3", "norn"],
    ["pane", "run", "w1:p3", "norn status --watch"],
  ]);
  // a split without a pane id is a launch failure
  const none = fakeExec([["pane split", ok({ result: {} })]]);
  expect(await createHerdrCockpit({ exec: none.exec, env: {} }).openBelow("/repo", "x").catch((e) => e)).toMatchObject({ code: "launch_failed" });
});

test("listWorkspaces pairs `herdr workspace list` with each pane's cwd; focusWorkspace argv (HC15)", async () => {
  const { exec, calls } = fakeExec([
    ["workspace list", ok(workspaceList)],
    ["pane list", ok(paneList)],
    ["workspace focus", empty],
  ]);
  const cockpit = createHerdrCockpit({ exec });
  const ws = await cockpit.listWorkspaces();
  expect(ws).toEqual([
    { workspace_id: "w2", label: "repo", pane_ids: ["w2:p1", "w2:p2"], cwds: ["/repo", "/repo"] },
    { workspace_id: "w3A", label: "gh-1/01 implement", pane_ids: ["w3A:p1"], cwds: ["/repo-worktrees/gh-1-01-login"] },
    { workspace_id: "w4", label: "empty", pane_ids: [], cwds: [] },
  ]);
  await cockpit.focusWorkspace("w3A");
  expect(calls.at(-1)?.slice(1)).toEqual(["workspace", "focus", "w3A"]);

  const reach = (r: Partial<{ worktree: string; pane_id: string }>) => ({ worktree: null, agent_session_id: null, pane_id: null, ...r });
  expect(findWorkspace(ws, reach({ pane_id: "w3A:p1", worktree: "/elsewhere" }))).toBe("w3A");
  expect(findWorkspace(ws, reach({ pane_id: "w9:p9", worktree: "/repo-worktrees/gh-1-01-login/" }))).toBe("w3A");
  // several workspaces work in /repo, none in an unknown worktree: no guess
  expect(findWorkspace([...ws, { workspace_id: "w5", label: "x", pane_ids: [], cwds: ["/repo/sub"] }], reach({ worktree: "/repo" }))).toBeNull();
  expect(findWorkspace(ws, reach({ worktree: "/nope" }))).toBeNull();
  expect(findWorkspace(ws, undefined)).toBeNull();
});

test("listPanes reads each pane's tab, workspace, cwd and status; close calls treat a missing target as gone (K7)", async () => {
  const gone = (what: string): ExecResult => ({ code: 1, stdout: "", stderr: JSON.stringify({ error: { code: `${what}_not_found`, message: "not found" } }) });
  const { exec, calls } = fakeExec([
    ["pane list", ok(paneList)],
    ["pane close w2:p2", empty],
    ["tab close w9:t1", gone("tab")],
    ["workspace close w3A", empty],
    ["workspace close w7", { code: 1, stdout: "", stderr: "socket refused" }],
  ]);
  const cockpit = createHerdrCockpit({ exec });
  expect(await cockpit.listPanes()).toEqual([
    { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/repo", status: "idle" },
    { pane_id: "w2:p2", tab_id: "w2:t1", workspace_id: "w2", cwd: "/repo", status: "unknown" },
    { pane_id: "w3A:p1", tab_id: "w3A:t1", workspace_id: "w3A", cwd: "/repo-worktrees/gh-1-01-login", status: "idle" },
  ]);
  await cockpit.closePane("w2:p2");
  await cockpit.closeTab("w9:t1");
  await cockpit.closeWorkspace("w3A");
  await expect(cockpit.closeWorkspace("w7")).rejects.toMatchObject({ code: "herdr_error" });
  expect(calls.slice(1).map((a) => a.slice(1))).toEqual([
    ["pane", "close", "w2:p2"],
    ["tab", "close", "w9:t1"],
    ["workspace", "close", "w3A"],
    ["workspace", "close", "w7"],
  ]);
});

test("cockpit errors keep the raw stderr: herdr_error with stderr as message, session_gone on a not-found anywhere in stderr", async () => {
  const fail = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr });
  const jsonErr = (code: string) => JSON.stringify({ error: { code, message: "parsed message" } });
  const { exec } = fakeExec([
    ["workspace focus w1", fail(jsonErr("server_unavailable"))],
    ["workspace focus w2", fail(jsonErr("agent_blocked"))],
    ["pane close w3:p1", fail(`warning: stale socket\n${jsonErr("pane_not_found")}`)],
  ]);
  const cockpit = createHerdrCockpit({ exec });
  await expect(cockpit.focusWorkspace("w1")).rejects.toMatchObject({ code: "herdr_error", message: `herdr workspace focus: ${jsonErr("server_unavailable")}` });
  await expect(cockpit.focusWorkspace("w2")).rejects.toMatchObject({ code: "herdr_error", message: `herdr workspace focus: ${jsonErr("agent_blocked")}` });
  await cockpit.closePane("w3:p1");
});

test("openWorkspace, reportWorkspace argv; moveWorkspace over the socket API", async () => {
  const { exec, calls } = fakeExec([
    ["workspace create", ok(herdrFixtures.workspace_create)],
    ["pane run", empty],
    ["workspace report-metadata", empty],
  ]);
  const requests: unknown[] = [];
  const socket: HerdrSocketCall = async (req) => {
    requests.push(req);
    return req.params.workspace_id === "gone" ? { id: req.id, error: { code: "workspace_not_found", message: "workspace gone not found" } } : { id: req.id, result: { type: "ok" } };
  };
  const cockpit = createHerdrCockpit({ exec, socket });
  expect(await cockpit.openWorkspace("/wt", "gh-1 orient", "claude -- 'Run `norn story view gh-1` and follow it.'")).toEqual({ workspace_id: "w1", pane_id: "w1:p1" });
  await cockpit.reportWorkspace("w1", { norn: "● approve" }, 15_000);
  await cockpit.moveWorkspace("w1", 0);
  await expect(cockpit.moveWorkspace("gone", 0)).rejects.toMatchObject({ code: "session_gone" });
  expect(calls.map((a) => a.slice(1))).toEqual([
    ["workspace", "create", "--cwd", "/wt", "--label", "gh-1 orient", "--focus"],
    ["pane", "run", "w1:p1", "claude -- 'Run `norn story view gh-1` and follow it.'"],
    ["workspace", "report-metadata", "w1", "--source", "norn", "--token", "norn=● approve", "--ttl-ms", "15000"],
  ]);
  expect(requests).toEqual([
    { id: "norn:workspace.move:1", method: "workspace.move", params: { workspace_id: "w1", insert_index: 0 } },
    { id: "norn:workspace.move:2", method: "workspace.move", params: { workspace_id: "gone", insert_index: 0 } },
  ]);
  expect(herdrSocketPath({ HERDR_SOCKET_PATH: "/s/herdr.sock", HOME: "/h" })).toBe("/s/herdr.sock");
  expect(herdrSocketPath({ HERDR_SOCKET_PATH: "/s/herdr.sock", HOME: "/h" }, "work")).toBe("/h/.config/herdr/sessions/work/herdr.sock");
  expect(herdrSocketPath({ HOME: "/h" })).toBe("/h/.config/herdr/herdr.sock");
});

test("pluginLinked reads `herdr plugin list --json` (HC11)", async () => {
  const list = (plugins: unknown[]) => fakeExec([["plugin list --json", ok({ id: "cli:plugin", result: { plugins } })]]).exec;
  expect(await createHerdrCockpit({ exec: list([{ plugin_id: "jpruszynski.github-issues", enabled: true }]) }).pluginLinked()).toBeNull();
  expect(await createHerdrCockpit({ exec: list([{ plugin_id: "norn", enabled: false, plugin_root: "/src/norn/plugins/herdr" }]) }).pluginLinked()).toEqual({ enabled: false, root: "/src/norn/plugins/herdr" });
});

describe("herdr notifier (HC14)", () => {
  test("a toast with the request sound for items that need a person", () => {
    expect(herdrNotifyArgv(item)).toEqual(["herdr", "notification", "show", "norn · Your turn · gh-1 · refine", "--body", "refine: the agent is waiting for you\ncd /wt", "--sound", "request"]);
    expect(herdrNotifyArgv({ ...item, group: "unclaimed" }, { session: "s" }).slice(0, 3)).toEqual(["herdr", "--session", "s"]);
    expect(herdrNotifyArgv({ ...item, group: "unclaimed" }).at(-1)).toBe("none");
  });

  test("outside Herdr it is unsupported and runs nothing", async () => {
    const { exec, calls } = fakeExec([]);
    await expect(createHerdrNotifier({ exec, env: {} }).notify(item)).rejects.toMatchObject({ code: "unsupported" });
    expect(calls).toEqual([]);
  });

  test("inside Herdr it shows the toast; a failing herdr is notify_failed", async () => {
    const good = fakeExec([["notification show", empty]]);
    await createHerdrNotifier({ exec: good.exec, env: { HERDR_ENV: "1" } }).notify(item);
    expect(good.calls).toHaveLength(1);
    const bad = fakeExec([["notification show", { code: 1, stdout: "", stderr: "boom" }]]);
    await expect(createHerdrNotifier({ exec: bad.exec, env: { HERDR_ENV: "1" } }).notify(item)).rejects.toMatchObject({ code: "notify_failed" });
  });
});
