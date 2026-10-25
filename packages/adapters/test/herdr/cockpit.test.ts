import { describe, expect, test } from "bun:test";
import { createHerdrCockpit, findAgentPane, type HerdrAgent } from "../../src/herdr/cockpit.ts";
import { createHerdrNotifier, herdrNotifyArgv } from "../../src/notify/index.ts";
import type { Exec, ExecResult } from "../../src/process/exec.ts";
import agentList from "./fixtures/agent-list.json";

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
