import { describe, expect, test } from "bun:test";
import type { ProcessPort, SessionRef } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";
import { createHerdrRunner, herdrFactory, openStatusPane } from "../../src/herdr/index.ts";
import type { Exec, ExecResult } from "../../src/process/exec.ts";
import fx from "./fixtures/herdr.json";

const WT = "/repo/.agents/worktrees/gh-1-01";
const ok = (v: unknown): ExecResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
const fail = (v: unknown): ExecResult => ({ code: 1, stdout: "", stderr: JSON.stringify(v) });
const empty: ExecResult = { code: 0, stdout: "", stderr: "" };

/** Fake exec: first matching rule (by the args after `herdr`) answers; every call is recorded. */
function fakeExec(rules: Array<[string, ExecResult | (() => ExecResult)]>) {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => {
    calls.push(argv);
    const key = argv.slice(1).join(" ");
    const rule = rules.find(([prefix]) => key.startsWith(prefix));
    if (!rule) throw new Error(`unexpected herdr call: ${key}`);
    return typeof rule[1] === "function" ? rule[1]() : rule[1];
  };
  return { exec, calls };
}

function fakeProcess(alive = true): ProcessPort & { identified: number[] } {
  const identified: number[] = [];
  return {
    identified,
    async identify(pid) {
      identified.push(pid);
      return { pid, pid_start: "Fri Oct 23 16:19:26 2026" };
    },
    async isAlive() {
      return alive;
    },
    self: (): ProcessIdentity => ({ pid: 1, pid_start: "x" }),
  };
}

const spec = {
  cwd: WT,
  argv: ["claude", "--model", "opus", "Use the norn skill, then run `norn brief`."],
  env: { NORN_HOME: "/home/u/.norn", NORN_STORY: "gh-1", NORN_SLICE: "01-x", NORN_RUN: "01JRUN" },
  title: "gh-1/01 implement",
  run_id: "01JRUN",
};
const noSleep = async () => {};

describe("herdr runner", () => {
  test("available iff `status server` reports running", async () => {
    expect(await createHerdrRunner({ exec: fakeExec([["status server", ok(fx.status_server)]]).exec }).available()).toBe(true);
    expect(await createHerdrRunner({ exec: fakeExec([["status server", { code: 127, stdout: "", stderr: "ENOENT" }]]).exec }).available()).toBe(false);
  });

  test("launch adds a tab to the worktree's workspace, runs argv with A6 env, records agent pid", async () => {
    let infoCalls = 0;
    const { exec, calls } = fakeExec([
      ["workspace list", ok(fx.workspace_list)],
      ["tab create", ok({ ...fx.tab_create })],
      ["pane run", empty],
      ["pane process-info", () => ok(++infoCalls === 1 ? fx.process_info_idle : fx.process_info_busy)],
    ]);
    const proc = fakeProcess();
    const ref = await createHerdrRunner({ exec, process: proc, sleep: noSleep }).launch(spec);

    expect(calls[1]).toEqual([
      "herdr", "tab", "create", "--workspace", "wA", "--cwd", WT, "--label", "gh-1/01 implement",
      "--env", "NORN_HOME=/home/u/.norn", "--env", "NORN_STORY=gh-1", "--env", "NORN_SLICE=01-x", "--env", "NORN_RUN=01JRUN",
      "--no-focus",
    ]);
    expect(calls[2]).toEqual(["herdr", "pane", "run", "w1:p2", "claude --model opus 'Use the norn skill, then run `norn brief`.'"]);
    // idle shell first (fg group == shell), then `cat` took the foreground → pid 59610
    expect(proc.identified).toEqual([59610]);
    expect(ref).toEqual({ runner: "herdr", session_id: "w1:p2", pane_id: "w1:p2", process: { pid: 59610, pid_start: "Fri Oct 23 16:19:26 2026" } });
  });

  test("launch creates a workspace when none matches, honours --session", async () => {
    const { exec, calls } = fakeExec([
      ["--session norn workspace list", ok(fx.workspace_list_empty)],
      ["--session norn workspace create", ok(fx.workspace_create)],
      ["--session norn pane run", empty],
      ["--session norn pane process-info", ok(fx.process_info_idle)],
    ]);
    const ref = await createHerdrRunner({ exec, session: "norn", process: fakeProcess(), sleep: noSleep, startWaitMs: 500 }).launch(spec);
    expect(calls[1]!.slice(0, 5)).toEqual(["herdr", "--session", "norn", "workspace", "create"]);
    expect(ref).toEqual({ runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" }); // agent never took the foreground
  });

  test("send with submit uses `agent prompt`; falls back to raw text + enter when no agent is recognized", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    const a = fakeExec([["agent prompt", ok({ id: "cli:agent:prompt", result: { type: "ok" } })]]);
    await createHerdrRunner({ exec: a.exec }).send(session, "keep going", { submit: true });
    expect(a.calls).toEqual([["herdr", "agent", "prompt", "w1:p1", "keep going"]]);

    const b = fakeExec([["agent prompt", fail(fx.error_agent_not_found)], ["pane send-text", empty], ["pane send-keys", empty]]);
    await createHerdrRunner({ exec: b.exec }).send(session, "keep going", { submit: true });
    expect(b.calls.slice(1)).toEqual([
      ["herdr", "pane", "send-text", "w1:p1", "keep going"],
      ["herdr", "pane", "send-keys", "w1:p1", "enter"],
    ]);

    const c = fakeExec([["pane send-text", empty]]);
    await createHerdrRunner({ exec: c.exec }).send(session, "partial");
    expect(c.calls).toEqual([["herdr", "pane", "send-text", "w1:p1", "partial"]]);
  });

  test("capabilities: send and resume (R4.1)", () => {
    expect(createHerdrRunner({ exec: fakeExec([]).exec }).capabilities).toEqual({ send: true, resume: true });
  });

  test("findSessions: agent panes whose cwd is the worktree, with pid and agent session (R5.1)", async () => {
    const { exec, calls } = fakeExec([
      ["pane list", ok(fx.pane_list)],
      ["pane process-info", ok(fx.process_info_busy)],
    ]);
    const found = await createHerdrRunner({ exec, process: fakeProcess() }).findSessions?.({ run_id: "01JRUN", cwd: WT });
    expect(calls.map((c) => c.slice(1, 3).join(" "))).toEqual(["pane list", "pane process-info"]);
    // the shell-only pane (no agent) in the same worktree and the pane elsewhere are not candidates
    expect(found).toEqual([
      {
        session: { runner: "herdr", session_id: "wA:p1", pane_id: "wA:p1", process: { pid: 59610, pid_start: "Fri Oct 23 16:19:26 2026" } },
        agent_session_id: "f90b97b5-4c27-4470-be49-002210dd3279",
      },
    ]);
  });

  test("send never types into a blocked dialog: typed session_blocked error", async () => {
    const { exec } = fakeExec([["agent prompt", fail(fx.error_agent_blocked)]]);
    const err = await createHerdrRunner({ exec })
      .send({ runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" }, "x", { submit: true })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "session_blocked", retryable: true });
  });

  test("paneState maps herdr status; blocked → waiting_input with visible screen as detail", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    const blocked = fakeExec([
      ["pane get", ok(fx.pane_get_blocked)],
      ["pane process-info", ok(fx.process_info_busy)],
      ["pane read", ok(fx.pane_read_visible)],
    ]);
    expect(await createHerdrRunner({ exec: blocked.exec }).paneState(session)).toEqual({
      alive: true,
      state: "waiting_input",
      since: null,
      detail: fx.pane_read_visible.trim(),
    });

    const working = fakeExec([["pane get", ok(fx.pane_get_working)]]);
    expect(await createHerdrRunner({ exec: working.exec, process: fakeProcess(false) }).paneState({ ...session, process: { pid: 5, pid_start: "a" } }))
      .toEqual({ alive: false, state: "working", since: null }); // herdr's status is reported, liveness comes from the pid

    const gone = fakeExec([["pane get", fail(fx.error_pane_not_found)]]);
    expect(await createHerdrRunner({ exec: gone.exec }).paneState(session)).toEqual({ alive: false, state: "unknown", since: null });
  });

  test("isAlive: pid + start time when recorded, else foreground process ≠ shell", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    expect(await createHerdrRunner({ exec: fakeExec([["pane process-info", ok(fx.process_info_busy)]]).exec }).isAlive(session)).toBe(true);
    expect(await createHerdrRunner({ exec: fakeExec([["pane process-info", ok(fx.process_info_idle)]]).exec }).isAlive(session)).toBe(false);
    expect(await createHerdrRunner({ exec: fakeExec([["pane process-info", fail(fx.error_pane_not_found)]]).exec }).isAlive(session)).toBe(false);
    const withPid = { ...session, process: { pid: 7, pid_start: "a" } };
    expect(await createHerdrRunner({ exec: fakeExec([]).exec, process: fakeProcess(true) }).isAlive(withPid)).toBe(true);
  });

  test("kill closes the pane and is idempotent", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    const a = fakeExec([["pane close", ok(fx.pane_close)]]);
    await createHerdrRunner({ exec: a.exec }).kill(session);
    expect(a.calls).toEqual([["herdr", "pane", "close", "w1:p1"]]);
    await createHerdrRunner({ exec: fakeExec([["pane close", fail(fx.error_pane_not_found)]]).exec }).kill(session);
  });

  test("other herdr errors surface as PortError with herdr's code", async () => {
    const { exec } = fakeExec([["pane close", fail({ error: { code: "server_unavailable", message: "no server" } })]]);
    const err = await createHerdrRunner({ exec }).kill({ runner: "herdr", session_id: "w1:p1" }).catch((e) => e);
    expect(err).toMatchObject({ code: "herdr_server_unavailable", retryable: false });
  });

  test("factory reads RunnerConfig options", () => {
    const ctx = {} as Parameters<typeof herdrFactory>[0];
    expect(herdrFactory(ctx, { adapter: "herdr", options: { session: "norn" } }).name).toBe("herdr");
  });
});

describe("herdr openStatusPane (O1)", () => {
  test("splits the calling pane without focus, names it, runs `norn pane` read-only", async () => {
    const { exec, calls } = fakeExec([["pane split", ok(fx.pane_split)], ["pane rename", empty], ["pane run", empty]]);
    const r = await openStatusPane("/repo", { exec, env: { HERDR_PANE_ID: "w1:p1" } });
    expect(r).toEqual({ pane_id: "w1:p3" });
    expect(calls).toEqual([
      ["herdr", "pane", "split", "--current", "--direction", "down", "--ratio", "0.3", "--cwd", "/repo", "--no-focus"],
      ["herdr", "pane", "rename", "w1:p3", "norn"],
      ["herdr", "pane", "run", "w1:p3", "norn pane"],
    ]);
  });

  test("outside herdr splits the focused pane; custom command, session and interval", async () => {
    const { exec, calls } = fakeExec([["--session s pane split", ok(fx.pane_split)], ["--session s pane rename", fail(fx.error_pane_not_found)], ["--session s pane run", empty]]);
    await openStatusPane("/repo", { exec, env: {}, session: "s", command: ["bunx", "norn"], interval: "10s", direction: "right" });
    expect(calls[0]).toEqual(["herdr", "--session", "s", "pane", "split", "--direction", "right", "--ratio", "0.3", "--cwd", "/repo", "--no-focus"]);
    expect(calls[2]).toEqual(["herdr", "--session", "s", "pane", "run", "w1:p3", "bunx norn pane --interval 10s"]);
  });

  test("a split without a pane id is a launch failure", async () => {
    const { exec } = fakeExec([["pane split", ok({ result: {} })]]);
    expect(await openStatusPane("/repo", { exec, env: {} }).catch((e) => e)).toMatchObject({ code: "launch_failed" });
  });
});
