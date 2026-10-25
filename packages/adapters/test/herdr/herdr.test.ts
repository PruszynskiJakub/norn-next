import { describe, expect, test } from "bun:test";
import type { ProcessPort, SessionRef } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHerdrRunner, herdrFactory, openStatusPane, parsePanePrompt } from "../../src/herdr/index.ts";
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
      ["--session norn pane process-info", () => ok(calls.filter((c) => c.includes("process-info")).length === 1 ? fx.process_info_idle : fx.process_info_busy)],
    ]);
    const ref = await createHerdrRunner({ exec, session: "norn", process: fakeProcess(), sleep: noSleep, startWaitMs: 500 }).launch(spec);
    expect(calls[1]!.slice(0, 5)).toEqual(["herdr", "--session", "norn", "workspace", "create"]);
    expect(ref).toMatchObject({ runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1", process: { pid: 59610 } });
  });

  test("a command that never takes the pane's foreground is a failed launch: screen in the reason, pane closed (R4.3, B2)", async () => {
    // B2: a launch line longer than the tty's MAX_CANON, typed while the pane's zsh still read its
    // rc files, is cut off and never runs — the shell stays in the foreground (screen derived from
    // the dogfood rerun's pane w15, paths scrubbed)
    const screen = readFileSync(join(import.meta.dir, "fixtures", "pane-launch-truncated.txt"), "utf8");
    const { exec, calls } = fakeExec([
      ["workspace list", ok(fx.workspace_list_empty)],
      ["workspace create", ok(fx.workspace_create)],
      ["pane run", empty],
      ["pane process-info", ok(fx.process_info_idle)],
      ["pane read", ok(screen)],
      ["pane close", ok(fx.pane_close)],
    ]);
    const err = await createHerdrRunner({ exec, process: fakeProcess(), sleep: noSleep, startWaitMs: 500 }).launch(spec).catch((e) => e);
    expect(err).toMatchObject({ code: "launch_failed" });
    expect(err.message).toContain("never started in herdr pane w1:p1");
    expect(err.message).toContain("quote>");
    expect(calls.at(-1)).toEqual(["herdr", "pane", "close", "w1:p1"]);
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

  test("paneState parses the prompt off a recorded permission dialog (R6.2, L1)", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    const screen = pane("pane-permission-prompt.txt");
    const blocked = fakeExec([
      ["pane get", ok(fx.pane_get_blocked)],
      ["pane process-info", ok(fx.process_info_busy)],
      ["pane read", ok(screen)],
    ]);
    const st = await createHerdrRunner({ exec: blocked.exec }).paneState(session);
    expect(st.detail).toBe(screen.trim());
    expect(st.prompt).toEqual({
      question: "Contains brace with quote character (expansion obfuscation) Do you want to proceed?",
      options: ["Yes", "Yes, and switch to auto mode · auto mode handles these prompts for you", "No"],
      choice: { numbered: true, cursor: 0 },
    });
    expect(blocked.calls.at(-1)).toEqual(["herdr", "pane", "read", "w1:p1", "--source", "visible", "--lines", "30"]);
  });

  test("sendKeys types text and presses named keys in the pane; reach is the attach command (R6.2, R6.3)", async () => {
    const session: SessionRef = { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" };
    const { exec, calls } = fakeExec([
      ["--session norn pane send-text", empty],
      ["--session norn pane send-keys", empty],
    ]);
    const runner = createHerdrRunner({ exec, session: "norn" });
    await runner.sendKeys?.(session, [{ text: "2" }, { key: "enter" }]);
    await runner.sendKeys?.(session, [{ key: "down" }, { key: "enter" }]);
    expect(calls).toEqual([
      ["herdr", "--session", "norn", "pane", "send-text", "w1:p1", "2"],
      ["herdr", "--session", "norn", "pane", "send-keys", "w1:p1", "enter"],
      ["herdr", "--session", "norn", "pane", "send-keys", "w1:p1", "down", "enter"],
    ]);
    expect(runner.reach?.(session)).toBe("herdr --session norn agent attach w1:p1");
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

  test("interactive runs the cockpit (HC10)", async () => {
    const { exec, calls } = fakeExec([["pane split", ok(fx.pane_split)], ["pane rename", empty], ["pane run", empty]]);
    await openStatusPane("/repo", { exec, env: {}, interactive: true, interval: "10s" });
    expect(calls[2]).toEqual(["herdr", "pane", "run", "w1:p3", "norn pane --interactive --interval 10s"]);
  });

  test("a split without a pane id is a launch failure", async () => {
    const { exec } = fakeExec([["pane split", ok({ result: {} })]]);
    expect(await openStatusPane("/repo", { exec, env: {} }).catch((e) => e)).toMatchObject({ code: "launch_failed" });
  });
});

const pane = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

describe("parsePanePrompt (recorded Claude Code dialogs in herdr panes, A4, A7)", () => {
  test("trust dialog: unnumbered menu, answered by arrows from the cursor", () => {
    expect(parsePanePrompt(pane("pane-trust-dialog.txt"))).toEqual({
      question:
        "Accessing workspace: /Users/u/Projects/norn-sandbox-todoist-b-worktrees/gh-9-keyboard-shortcut-q-focuses-quick-add Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first. Claude Code'll be able to read, edit, and execute files here. Security guide",
      options: ["No, exit", "Yes, I trust this folder"],
      choice: { numbered: false, cursor: 0 },
    });
  });

  test("permission prompt: numbered options, the question block without the command box", () => {
    const p = parsePanePrompt(pane("pane-permission-dont-ask.txt"));
    expect(p?.question).toBe("This command requires approval Do you want to proceed?");
    expect(p?.options).toEqual([
      "Yes",
      "Yes, and don’t ask again for: python3 - .agents/specs/gh-9-keyboard-shortcut-q-focuses-quick-add/runs/_story/handoff.md",
      "Yes, and switch to auto mode · auto mode handles these prompts for you",
      "No",
    ]);
    expect(p?.choice).toEqual({ numbered: true, cursor: 0 });
    // the command box's top is cut off the screen: no first command line is guessed
    expect(p?.command).toBeUndefined();
  });

  test("the pending command is the first line of a box whose top is on screen", () => {
    const screen = ["", " Bash command", "", " │ rm -rf build", " │ bun test", "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel"].join("\n");
    expect(parsePanePrompt(screen)).toEqual({ question: "Do you want to proceed?", command: "rm -rf build", options: ["Yes", "No"], choice: { numbered: true, cursor: 0 } });
  });

  test("no dialog (no footer or no cursor) → null", () => {
    expect(parsePanePrompt(fx.pane_read_visible)).toBeNull();
    expect(parsePanePrompt("working…\n  1. a list item\n Esc to cancel")).toBeNull();
  });
});
