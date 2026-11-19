import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost, type ScriptedAnswer, scriptedExec } from "@norn/conformance";
import type { RunnerStartRequest } from "@norn/plugin-api";
import { createHerdrRunner, type HerdrConfig, keyRecordPath, launchScript, launchScriptPath, shellJoin } from "../../src/index.ts";

interface Pane {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  shell: number;
  fg: number;
  /** herdr's reading of the agent in the pane */
  status?: "idle" | "working" | "blocked" | "done" | "unknown";
  /** what the pane shows, when a test sets it */
  screen?: string;
}

/**
 * A herdr server in memory, answering the CLI's JSON the way herdr does: workspaces, tabs, panes,
 * and a pane's foreground, which `pane run` hands to a new process unless `runSticks` is false.
 */
function fakeHerdr(opts: { runSticks?: boolean; agentKnown?: boolean } = {}) {
  const workspaces: Array<{ workspace_id: string; label: string }> = [];
  const tabs: Array<{ tab_id: string; workspace_id: string; label: string }> = [];
  const panes: Pane[] = [];
  let n = 0;
  const json = (result: unknown): ScriptedAnswer => ({ stdout: JSON.stringify({ id: "cli", result }) });
  const notFound = (code: string): ScriptedAnswer => ({ code: 1, stderr: JSON.stringify({ error: { code, message: `${code.replace("_", " ")}` } }) });
  const flag = (argv: string[], name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  const newTab = (ws: string, label: string) => {
    const tab = { tab_id: `${ws}:t${++n}`, workspace_id: ws, label };
    tabs.push(tab);
    const shell = 1000 + n;
    const pane: Pane = { pane_id: `${ws}:p${n}`, tab_id: tab.tab_id, workspace_id: ws, shell, fg: shell };
    panes.push(pane);
    return pane;
  };
  const exec = scriptedExec((full) => {
    const [bin, ...argv] = full;
    if (bin !== "herdr") return undefined;
    const [noun, verb, ...rest] = argv;
    const pane = (id: string | undefined) => panes.find((p) => p.pane_id === id);
    switch (`${noun} ${verb}`) {
      case "workspace list":
        return json({ type: "workspace_list", workspaces });
      case "workspace create": {
        const ws = { workspace_id: `w${++n}`, label: flag(argv, "--label") ?? "" };
        workspaces.push(ws);
        const p = newTab(ws.workspace_id, "1");
        return json({ type: "workspace_created", workspace: ws, root_pane: { pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id } });
      }
      case "tab create": {
        const ws = flag(argv, "--workspace") as string;
        if (!workspaces.some((w) => w.workspace_id === ws)) return notFound("workspace_not_found");
        const p = newTab(ws, flag(argv, "--label") ?? "");
        return json({ type: "tab_created", tab: { tab_id: p.tab_id }, root_pane: { pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id } });
      }
      case "tab list":
        return json({ type: "tab_list", tabs: tabs.filter((t) => t.workspace_id === flag(argv, "--workspace")) });
      case "tab rename": {
        const t = tabs.find((x) => x.tab_id === rest[0]);
        if (!t) return notFound("tab_not_found");
        t.label = rest[1] as string;
        return json({ type: "ok" });
      }
      case "pane list":
        return json({ panes: panes.filter((p) => p.workspace_id === flag(argv, "--workspace")).map(({ pane_id, tab_id, workspace_id }) => ({ pane_id, tab_id, workspace_id })) });
      case "pane process-info": {
        const p = pane(flag(argv, "--pane"));
        return p ? json({ process_info: { foreground_process_group_id: p.fg, shell_pid: p.shell } }) : notFound("pane_not_found");
      }
      case "pane run": {
        const p = pane(rest[0]);
        if (!p) return notFound("pane_not_found");
        if (opts.runSticks !== false) p.fg = p.shell + 500;
        return { stdout: "" };
      }
      case "pane read": {
        const p = pane(rest[0]);
        return p ? { stdout: p.screen ?? "$ claude\nzsh: command not found: claude\n$ \n" } : notFound("pane_not_found");
      }
      case "pane get": {
        const p = pane(rest[0]);
        return p ? json({ type: "pane_info", pane: { pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id, agent_status: p.status ?? "unknown" } }) : notFound("pane_not_found");
      }
      case "pane close": {
        const i = panes.findIndex((p) => p.pane_id === rest[0]);
        if (i < 0) return notFound("pane_not_found");
        panes.splice(i, 1);
        return { stdout: "" };
      }
      case "agent prompt":
        if (!pane(rest[0])) return notFound("pane_not_found");
        return opts.agentKnown === false ? notFound("agent_not_found") : json({ type: "ok" });
      case "pane send-text":
      case "pane send-keys":
        return pane(rest[0]) ? { stdout: "" } : notFound("pane_not_found");
      default:
        return undefined;
    }
  });
  /** the agent in a pane exits, leaving its shell */
  const exitAgent = (id: string) => {
    const p = panes.find((x) => x.pane_id === id) as Pane;
    p.fg = p.shell;
  };
  const calls = () => exec.calls.map((c) => c.argv.slice(1).slice(0, 2).join(" "));
  return { exec, workspaces, tabs, panes, exitAgent, calls };
}

const req = (over: Partial<RunnerStartRequest> = {}): RunnerStartRequest => ({
  key: "01JRUN1",
  argv: ["claude", "--settings", "a b.json"],
  env: { NORN_RUN_ID: "01JRUN1", NORN_UNIT: "gh-1" },
  cwd: "/wt/gh-1",
  title: "gh-1 implement",
  workspace: "gh-1",
  logPath: "/machine/repo/logs/01JRUN1.log",
  ...over,
});

const noSleep = async () => {};

function setup(config: HerdrConfig = {}, herdrOpts: Parameters<typeof fakeHerdr>[0] = {}) {
  const h = fakeHerdr(herdrOpts);
  const files = memoryFiles();
  const ctx = memoryHost({ exec: h.exec, files });
  const runner = createHerdrRunner(ctx, config, { sleep: noSleep });
  const record = () => {
    const text = files.snapshot()[keyRecordPath(ctx, "01JRUN1")];
    return text === undefined ? undefined : JSON.parse(text);
  };
  return { h, files, ctx, runner, record };
}

describe("herdr start", () => {
  test("a story's first run opens its workspace, titles the tab, runs the command with the env and records the key", async () => {
    const { h, runner, record, files, ctx } = setup();
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w1:p2" } });
    expect(h.workspaces).toEqual([{ workspace_id: "w1", label: "gh-1" }]);
    expect(h.tabs).toEqual([{ tab_id: "w1:t2", workspace_id: "w1", label: "gh-1 implement" }]);
    const create = h.exec.calls.find((c) => c.argv[1] === "workspace" && c.argv[2] === "create");
    expect(create?.argv).toEqual(["herdr", "workspace", "create", "--label", "gh-1", "--cwd", "/wt/gh-1", "--env", "NORN_RUN_ID=01JRUN1", "--env", "NORN_UNIT=gh-1", "--no-focus"]);
    // the pane runs a script with one short line; the env goes in it as well, since the pane's shell
    // startup files run after --env and may reorder PATH
    const run = h.exec.calls.find((c) => c.argv[2] === "run");
    expect(run?.argv).toEqual(["herdr", "pane", "run", "w1:p2", `sh ${launchScriptPath(ctx, "01JRUN1")}`]);
    expect(files.snapshot()[launchScriptPath(ctx, "01JRUN1")]).toBe(launchScript(["env", "NORN_RUN_ID=01JRUN1", "NORN_UNIT=gh-1", "claude", "--settings", "a b.json"]));
    expect(launchScript(["claude", "a b"])).toEndWith("\nexec claude 'a b'\n");
    expect(record()).toEqual({ key: "01JRUN1", workspace: "w1", pane: "w1:p2", title: "gh-1 implement", ran: true });
  });

  test("the story's next run gets a tab in the same workspace", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    expect(await runner.start(req({ key: "01JRUN2", title: "gh-1 review" }))).toEqual({ ok: true, value: { handle: "w1:p3" } });
    expect(h.workspaces.length).toBe(1);
    const create = h.exec.calls.find((c) => c.argv[1] === "tab" && c.argv[2] === "create");
    expect(create?.argv.slice(0, 7)).toEqual(["herdr", "tab", "create", "--workspace", "w1", "--label", "gh-1 review"]);
  });

  test("without a workspace the run gets a workspace of its own, labelled with its title", async () => {
    const { h, runner } = setup();
    const { workspace: _, ...rest } = req();
    expect((await runner.start(rest)).ok).toBe(true);
    expect(h.workspaces).toEqual([{ workspace_id: "w1", label: "gh-1 implement" }]);
    expect(h.calls()).not.toContain("tab rename");
  });

  test("a replay under the same key finds the recorded pane and opens nothing, even once the agent exited", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    h.exitAgent("w1:p2");
    const before = h.exec.calls.length;
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w1:p2" } });
    expect(h.exec.calls.length).toBe(before);
  });

  test("a record made before the command went in sends it on replay, into the recorded pane", async () => {
    const { h, runner, files, ctx, record } = setup();
    h.workspaces.push({ workspace_id: "w9", label: "gh-1" });
    h.panes.push({ pane_id: "w9:p1", tab_id: "w9:t1", workspace_id: "w9", shell: 50, fg: 50 });
    await files.write(keyRecordPath(ctx, "01JRUN1"), JSON.stringify({ key: "01JRUN1", workspace: "w9", pane: "w9:p1", title: "gh-1 implement", ran: false }));
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w9:p1" } });
    expect(h.exec.calls.find((c) => c.argv[2] === "run")?.argv[4]).toBe(`sh ${launchScriptPath(ctx, "01JRUN1")}`);
    expect(record().ran).toBe(true);
  });

  test("a record not yet marked whose pane already runs something is marked, and nothing is sent twice", async () => {
    const { h, runner, files, ctx, record } = setup();
    h.panes.push({ pane_id: "w9:p1", tab_id: "w9:t1", workspace_id: "w9", shell: 50, fg: 77 });
    await files.write(keyRecordPath(ctx, "01JRUN1"), JSON.stringify({ key: "01JRUN1", workspace: "w9", pane: "w9:p1", title: "gh-1 implement", ran: false }));
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w9:p1" } });
    expect(h.calls()).not.toContain("pane run");
    expect(record().ran).toBe(true);
  });

  test("a record that names no pane yet (a crash after the pane opened) adopts the idle pane of the tab titled for the run", async () => {
    const { h, runner, files, ctx, record } = setup();
    h.workspaces.push({ workspace_id: "w9", label: "gh-1" });
    h.tabs.push({ tab_id: "w9:t1", workspace_id: "w9", label: "gh-1 implement" });
    h.panes.push({ pane_id: "w9:p1", tab_id: "w9:t1", workspace_id: "w9", shell: 50, fg: 50 });
    await files.write(keyRecordPath(ctx, "01JRUN1"), JSON.stringify({ key: "01JRUN1", title: "gh-1 implement", ran: false }));
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w9:p1" } });
    expect(h.calls()).not.toContain("tab create");
    expect(h.exec.calls.find((c) => c.argv[2] === "run")?.argv[4]).toBe(`sh ${launchScriptPath(ctx, "01JRUN1")}`);
    expect(record()).toEqual({ key: "01JRUN1", workspace: "w9", pane: "w9:p1", title: "gh-1 implement", ran: true });
  });

  test("a fresh start never adopts another run's idle tab with the same title: it opens its own", async () => {
    const { h, runner, record } = setup();
    h.workspaces.push({ workspace_id: "w9", label: "gh-1" });
    h.tabs.push({ tab_id: "w9:t1", workspace_id: "w9", label: "gh-1 implement" });
    h.panes.push({ pane_id: "w9:pOld", tab_id: "w9:t1", workspace_id: "w9", shell: 50, fg: 50 });
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w9:p1" } });
    expect(h.calls()).toContain("tab create");
    expect(h.exec.calls.filter((c) => c.argv[2] === "run").map((c) => c.argv[3])).toEqual(["w9:p1"]);
    expect(record()).toEqual({ key: "01JRUN1", workspace: "w9", pane: "w9:p1", title: "gh-1 implement", ran: true });
  });

  test("a same-titled tab where an agent still works is never taken over, even on a replay: the run gets a new tab", async () => {
    const { h, runner, files, ctx } = setup();
    h.workspaces.push({ workspace_id: "w9", label: "gh-1" });
    h.tabs.push({ tab_id: "w9:t1", workspace_id: "w9", label: "gh-1 implement" });
    h.panes.push({ pane_id: "w9:pBusy", tab_id: "w9:t1", workspace_id: "w9", shell: 50, fg: 99 });
    await files.write(keyRecordPath(ctx, "01JRUN1"), JSON.stringify({ key: "01JRUN1", title: "gh-1 implement", ran: false }));
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w9:p1" } });
    expect(h.panes.find((p) => p.pane_id === "w9:pBusy")?.fg).toBe(99);
    expect(h.calls()).toContain("tab create");
  });

  test("two starts racing for one key: the second opens nothing and hands back the first's pane", async () => {
    const h = fakeHerdr();
    const files = memoryFiles();
    // the other start's record lands between this start's read and its create
    const racing = {
      ...files,
      create: async (p: string, d: string) => {
        await files.write(p, JSON.stringify({ key: "01JRUN1", workspace: "w0", pane: "w0:p0", title: "gh-1 implement", ran: true }));
        return files.create(p, d);
      },
    };
    const runner = createHerdrRunner(memoryHost({ exec: h.exec, files: racing }), {}, { sleep: noSleep });
    expect(await runner.start(req())).toEqual({ ok: true, value: { handle: "w0:p0" } });
    expect(h.exec.calls).toEqual([]);
  });

  test("losing the race to a start that has not opened its pane yet is a retryable conflict, and nothing opens", async () => {
    const h = fakeHerdr();
    const files = memoryFiles();
    const racing = {
      ...files,
      create: async (p: string, d: string) => {
        await files.write(p, JSON.stringify({ key: "01JRUN1", title: "gh-1 implement", ran: false }));
        return files.create(p, d);
      },
    };
    const runner = createHerdrRunner(memoryHost({ exec: h.exec, files: racing }), {}, { sleep: noSleep });
    const r = await runner.start(req());
    expect(!r.ok && [r.failure.code, r.failure.retryable]).toEqual(["conflict", true]);
    expect(h.exec.calls).toEqual([]);
  });

  test("a pane that cannot be opened leaves no record, so a retry starts fresh", async () => {
    const files = memoryFiles();
    const exec = scriptedExec((argv) => (argv[2] === "list" ? { stdout: JSON.stringify({ result: { workspaces: [] } }) } : { code: 1, stderr: '{"error":{"code":"internal","message":"boom"}}' }));
    const ctx = memoryHost({ exec, files });
    const r = await createHerdrRunner(ctx, {}, { sleep: noSleep }).start(req());
    expect(!r.ok && r.failure.code).toBe("unknown");
    expect(files.snapshot()[keyRecordPath(ctx, "01JRUN1")]).toBeUndefined();
  });

  test("a command that never takes the foreground fails with what the pane showed, closes the pane and leaves no record", async () => {
    const { h, runner, record } = setup({ start_wait_ms: 500 }, { runSticks: false });
    const r = await runner.start(req());
    expect(r).toEqual({
      ok: false,
      failure: {
        code: "unavailable",
        message: "the command never started in herdr pane w1:p2 (nothing took the foreground within 0.5s); the pane showed: $ claude | zsh: command not found: claude | $",
        retryable: true,
      },
    });
    expect(h.panes).toEqual([]);
    expect(record()).toBeUndefined();
  });

  test("a key record it cannot read is refused and nothing opens", async () => {
    const { h, runner, files, ctx } = setup();
    await files.write(keyRecordPath(ctx, "01JRUN1"), JSON.stringify({ pane: "w1:p1" }));
    const r = await runner.start(req());
    expect(!r.ok && r.failure.code).toBe("invalid");
    expect(h.exec.calls).toEqual([]);
  });

  test("an unsafe key or an empty argv is refused before herdr is called", async () => {
    const { h, runner } = setup();
    for (const r of [await runner.start(req({ key: "../x" })), await runner.start(req({ argv: [] }))]) expect(!r.ok && r.failure.code).toBe("invalid");
    expect(h.exec.calls).toEqual([]);
  });
});

describe("herdr alive, send and stop", () => {
  test("alive while something other than the shell holds the pane, dead once only the shell is left or the pane is gone", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    expect(await runner.alive("w1:p2")).toEqual({ ok: true, value: true });
    h.exitAgent("w1:p2");
    expect(await runner.alive("w1:p2")).toEqual({ ok: true, value: false });
    expect(await runner.alive("w1:p404")).toEqual({ ok: true, value: false });
    expect(h.exec.calls.at(-1)?.argv).toEqual(["herdr", "pane", "process-info", "--pane", "w1:p404"]);
  });

  test("send submits the text as a prompt to the pane's agent", async () => {
    const { h, runner } = setup();
    expect(await runner.send("w1:p9", "x")).toEqual({ ok: false, failure: { code: "not_found", message: "herdr agent prompt: pane not_found [herdr:pane_not_found]", retryable: false } });
    await runner.start(req());
    expect(await runner.send("w1:p2", "carry on\nplease")).toEqual({ ok: true, value: undefined });
    expect(h.exec.calls.at(-1)?.argv).toEqual(["herdr", "agent", "prompt", "w1:p2", "carry on\nplease"]);
  });

  test("a text that starts with a dash goes in the text position, never as an option and with no separator", async () => {
    const { h, runner } = setup({}, { agentKnown: false });
    await runner.start(req());
    for (const text of ["- yes, the second one", "--wait"]) expect(await runner.send("w1:p2", text)).toEqual({ ok: true, value: undefined });
    expect(h.exec.calls.filter((c) => c.argv[2] === "prompt" || c.argv[2] === "send-text").map((c) => c.argv.slice(1))).toEqual([
      ["agent", "prompt", "w1:p2", "- yes, the second one"],
      ["pane", "send-text", "w1:p2", "- yes, the second one"],
      ["agent", "prompt", "w1:p2", "--wait"],
      ["pane", "send-text", "w1:p2", "--wait"],
    ]);
  });

  test("with no agent herdr recognizes in the pane, send types the text and presses enter", async () => {
    const { h, runner } = setup({}, { agentKnown: false });
    await runner.start(req());
    expect(await runner.send("w1:p2", "carry on")).toEqual({ ok: true, value: undefined });
    expect(h.exec.calls.slice(-2).map((c) => c.argv)).toEqual([
      ["herdr", "pane", "send-text", "w1:p2", "carry on"],
      ["herdr", "pane", "send-keys", "w1:p2", "enter"],
    ]);
  });

  test("keys go into the pane as a person would press them: text typed, runs of named keys in one call", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    const before = h.exec.calls.length;
    expect(await runner.keys?.("w1:p2", [{ text: "1" }, { key: "enter" }])).toEqual({ ok: true, value: undefined });
    expect(await runner.keys?.("w1:p2", [{ key: "down" }, { key: "down" }, { key: "enter" }])).toEqual({ ok: true, value: undefined });
    expect(h.exec.calls.slice(before).map((c) => c.argv)).toEqual([
      ["herdr", "pane", "send-text", "w1:p2", "1"],
      ["herdr", "pane", "send-keys", "w1:p2", "enter"],
      ["herdr", "pane", "send-keys", "w1:p2", "down", "down", "enter"],
    ]);
    const gone = await runner.keys?.("w9:p9", [{ key: "esc" }]);
    expect(gone?.ok ? null : gone?.failure.code).toBe("not_found");
  });

  test("dialog reads the pane only while herdr says the agent is blocked, and hands back what the pane shows of it", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    const p = h.panes.find((x) => x.pane_id === "w1:p2") as Pane;
    p.status = "working";
    expect(await runner.dialog?.("w1:p2")).toEqual({ ok: true, value: null });
    expect(h.calls().at(-1)).toBe("pane get");
    p.status = "blocked";
    p.screen = [
      "╭──────────────────────────────────────────╮",
      "│ Do you trust the files in this folder?   │",
      "│                                          │",
      "│ /wt/gh-1                                 │",
      "│ ❯ 1. Yes, proceed                        │",
      "│   2. No, exit                            │",
      "╰──────────────────────────────────────────╯",
      "   Enter to confirm · Esc to exit",
      "",
    ].join("\n");
    expect(await runner.dialog?.("w1:p2")).toEqual({
      ok: true,
      value: ["  Do you trust the files in this folder?", "", "  /wt/gh-1", "  ❯ 1. Yes, proceed", "    2. No, exit", "", "   Enter to confirm · Esc to exit"].join("\n"),
    });
    expect(await runner.dialog?.("w9:p9")).toEqual({ ok: true, value: null });
  });

  test("dialog asked to read whatever herdr says of the agent reads the pane even when herdr does not see it blocked", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    const p = h.panes.find((x) => x.pane_id === "w1:p2") as Pane;
    p.status = "idle";
    p.screen = ["│ ❯ No, exit           │", "│   Yes, I trust this folder │", ""].join("\n");
    expect(await runner.dialog?.("w1:p2", { anyStatus: true })).toEqual({ ok: true, value: ["  ❯ No, exit", "    Yes, I trust this folder"].join("\n") });
    p.screen = "\n\n";
    expect(await runner.dialog?.("w1:p2", { anyStatus: true })).toEqual({ ok: true, value: null });
    expect(await runner.dialog?.("w9:p9", { anyStatus: true })).toEqual({ ok: true, value: null });
  });

  test("stop closes the pane; a pane already gone is not an error", async () => {
    const { h, runner } = setup();
    await runner.start(req());
    expect(await runner.stop("w1:p2")).toEqual({ ok: true, value: undefined });
    expect(h.panes).toEqual([]);
    expect(await runner.stop("w1:p2")).toEqual({ ok: true, value: undefined });
  });
});

describe("herdr missing or failing", () => {
  test("a herdr binary that cannot run is an unavailable failure, never a throw", async () => {
    const ctx = memoryHost({ exec: scriptedExec(() => ({ code: 127, stderr: "herdr: command not found" })) });
    const runner = createHerdrRunner(ctx, { bin: "/opt/herdr" }, { sleep: noSleep });
    const failure = { ok: false as const, failure: { code: "unavailable" as const, message: "herdr is not runnable (/opt/herdr): herdr: command not found", retryable: false } };
    expect(await runner.start(req())).toEqual(failure);
    expect(await runner.alive("w1:p1")).toEqual(failure);
    expect(await runner.send("w1:p1", "x")).toEqual(failure);
    expect(await runner.stop("w1:p1")).toEqual(failure);
  });

  test("a server that does not answer (no JSON error) is unavailable and retryable", async () => {
    const ctx = memoryHost({ exec: scriptedExec(() => ({ code: 1, stderr: "error: cannot connect to herdr socket" })) });
    const r = await createHerdrRunner(ctx, {}, { sleep: noSleep }).alive("w1:p1");
    expect(r).toEqual({ ok: false, failure: { code: "unavailable", message: "herdr pane process-info: error: cannot connect to herdr socket", retryable: true } });
  });

  test("a hung herdr is unavailable; a herdr error in JSON is unknown with herdr's code in the message", async () => {
    const hung = createHerdrRunner(memoryHost({ exec: scriptedExec(() => ({ code: 143, timedOut: true })) }), {}, { sleep: noSleep });
    expect(await hung.stop("w1:p1")).toEqual({ ok: false, failure: { code: "unavailable", message: "herdr pane close: no answer within 15s", retryable: true } });
    const err = createHerdrRunner(memoryHost({ exec: scriptedExec(() => ({ code: 1, stderr: '{"error":{"code":"internal","message":"boom"}}' })) }), {}, { sleep: noSleep });
    expect(await err.stop("w1:p1")).toEqual({ ok: false, failure: { code: "unknown", message: "herdr pane close: boom [herdr:internal]", retryable: false } });
  });

  test("every call carries the configured binary and session, bounded by a timeout", async () => {
    const exec = scriptedExec(() => ({ stdout: "" }));
    await createHerdrRunner(memoryHost({ exec }), { bin: "/opt/herdr", session: "norn" }).stop("w1:p1");
    expect(exec.calls).toEqual([{ argv: ["/opt/herdr", "--session", "norn", "pane", "close", "w1:p1"], opts: { timeoutMs: 15_000 } }]);
  });
});

describe("shellJoin", () => {
  test("quotes only words a shell would split or expand", () => {
    expect(shellJoin(["claude", "--x", "a b", "it's", "", "$HOME", "k=v"])).toBe(`claude --x 'a b' 'it'\\''s' '' '$HOME' k=v`);
  });
});
