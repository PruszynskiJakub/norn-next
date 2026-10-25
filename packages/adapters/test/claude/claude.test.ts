import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAgent, shared, withPendingCommands } from "../../src/claude/index.ts";
import payloads from "./fixtures/hook-payloads.json";

const FIX = join(import.meta.dir, "fixtures");
const AT = "2026-10-23T10:00:00.000Z";
const ENV = { NORN_STORY: "gh-12", NORN_SLICE: "gh-12/03", NORN_RUN: "01JABCDEFGHJKMNPQRSTVWXYZ0", PWD: "/elsewhere" };
const tmp = () => mkdtempSync(join(tmpdir(), "norn-claude-"));
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("claude parseHookEvent", () => {
  test("normalizes each recorded payload", () => {
    const f = (arg: string, p: unknown) => claudeAgent.parseHookEvent(arg, p, ENV, AT);
    expect(f("session-start", payloads.SessionStart)).toEqual({
      event: "session_start", at: AT, agent: "claude", native: "SessionStart", cwd: "/repo/.worktrees/gh-12",
      story: "gh-12", slice: "gh-12/03", run_id: ENV.NORN_RUN, agent_session_id: "abc123",
      transcript: "/home/u/.claude/projects/-repo/abc123.jsonl", message: "startup",
    });
    expect(f("user-prompt-submit", payloads.UserPromptSubmit)?.event).toBe("turn_start");
    expect(f("pre-tool-use", payloads.PreToolUse)).toMatchObject({ event: "tool_use", tool: "Bash", command: "bun test" });
    expect(f("post-tool-use", payloads.PostToolUse)).toMatchObject({ event: "tool_use", tool: "Edit" });
    const perm = f("notification", payloads.NotificationPermission);
    expect(perm).toMatchObject({ event: "permission_prompt", message: "Claude needs your permission to use Bash" });
    expect(perm?.command).toBeUndefined(); // filled from the PreToolUse by withPendingCommands
    // idle_prompt fires ~60 s after the turn ended: a turn end, not a question (A2, §10 silent → nudge)
    expect(f("notification", payloads.NotificationIdle)).toMatchObject({ event: "turn_end", native: "Notification" });
    expect(f("stop", payloads.Stop)).toMatchObject({ event: "turn_end", native: "Stop", message: "All tests pass." });
    expect(f("session-end", payloads.SessionEnd)).toMatchObject({ event: "session_end", message: "prompt_input_exit" });
  });

  test("drops malformed norn env, ignores unknown events, needs a cwd", () => {
    const fact = claudeAgent.parseHookEvent("stop", payloads.Stop, { NORN_STORY: "nope", NORN_RUN: "x" }, AT);
    expect(fact?.story).toBeUndefined();
    expect(fact?.run_id).toBeUndefined();
    expect(claudeAgent.parseHookEvent("bogus", {}, ENV, AT)).toBeNull();
    expect(claudeAgent.parseHookEvent("stop", null, {}, AT)).toBeNull();
    expect(claudeAgent.parseHookEvent("stop", null, { PWD: "/w" }, AT)?.cwd).toBe("/w");
  });
});

describe("claude Notification types (A2)", () => {
  const n = (notification_type: string | undefined, message = "x") =>
    claudeAgent.parseHookEvent("notification", { ...payloads.NotificationIdle, notification_type, message }, ENV, AT)?.event ?? null;
  test("dialogs that wait on a person are waiting_input; permission is permission_prompt", () => {
    expect(n("permission_prompt")).toBe("permission_prompt");
    for (const t of ["elicitation_dialog", "elicitation_url_dialog", "agent_needs_input", "quota_auto_resume_stale"]) expect(n(t)).toBe("waiting_input");
  });
  test("idle_prompt is a turn end", () => expect(n("idle_prompt")).toBe("turn_end"));
  test("informational and unknown types are ignored", () => {
    for (const t of ["auth_success", "elicitation_complete", "elicitation_response", "agent_completed", "quota_auto_resume_fired", "quota_auto_resume_disabled", "plugin_notification", "something_new"])
      expect(n(t)).toBeNull();
  });
  test("untyped (older Claude Code) falls back on the message", () => {
    expect(n(undefined, "Claude needs your permission to use Bash")).toBe("permission_prompt");
    expect(n(undefined, "Claude is waiting for your input")).toBe("turn_end");
    expect(n(undefined, "Please pick an option")).toBe("waiting_input");
  });
});

describe("claude withPendingCommands (§10 implicit ask shows the command)", () => {
  const f = (arg: string, p: unknown) => claudeAgent.parseHookEvent(arg, p, ENV, AT)!;
  const pre = f("pre-tool-use", payloads.PreToolUse);
  const perm = f("notification", payloads.NotificationPermission);
  test("tool facts carry a summary of the tool input", () => {
    expect(pre.command).toBe("bun test");
    expect(f("post-tool-use", payloads.PostToolUse).command).toBe("/repo/a.ts");
  });
  test("a permission prompt takes tool and command from the latest PreToolUse of its session", () => {
    const out = withPendingCommands([f("session-start", payloads.SessionStart), pre, perm]);
    expect(out[2]).toMatchObject({ event: "permission_prompt", tool: "Bash", command: "Bash(bun test)", message: "Claude needs your permission to use Bash" });
    expect(out.slice(0, 2)).toEqual([f("session-start", payloads.SessionStart), pre]);
  });
  test("no pending tool when the latest tool fact is a PostToolUse or another session's", () => {
    const post = f("post-tool-use", payloads.PostToolUse);
    expect(withPendingCommands([pre, post, perm])[2]).toEqual(perm);
    const other = { ...pre, agent_session_id: "zzz" };
    expect(withPendingCommands([other, perm])[1]).toEqual(perm);
  });
  test("other agents' facts are untouched", () => {
    const codexPerm = { ...perm, agent: "codex" };
    expect(withPendingCommands([pre, codexPerm])[1]).toEqual(codexPerm);
  });
});

describe("claude hookResponse (A4)", () => {
  const stop = claudeAgent.parseHookEvent("stop", payloads.Stop, ENV, AT)!;
  test("block encodes Claude Code decision JSON", () => {
    const r = claudeAgent.hookResponse(stop, { block: true, reason: "Run norn done" });
    expect(r.exit_code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ decision: "block", reason: "Run norn done" });
  });
  test("allow and non-stop events are silent", () => {
    expect(claudeAgent.hookResponse(stop, { block: false })).toEqual({ stdout: "", exit_code: 0 });
    const tool = claudeAgent.parseHookEvent("pre-tool-use", payloads.PreToolUse, ENV, AT)!;
    expect(claudeAgent.hookResponse(tool, { block: true })).toEqual({ stdout: "", exit_code: 0 });
    const idle = claudeAgent.parseHookEvent("notification", payloads.NotificationIdle, ENV, AT)!;
    expect(claudeAgent.hookResponse(idle, { block: true })).toEqual({ stdout: "", exit_code: 0 });
  });
});

describe("claude hooks install (A1)", () => {
  test("merge into user settings, re-run is idempotent, uninstall restores the original", async () => {
    const repo = tmp();
    const path = join(repo, ".claude", "settings.json");
    cpSync(join(FIX, "settings-user.json"), path, { recursive: true });
    const original = read(path);

    expect(await claudeAgent.hooksInstalled(repo)).toBe(false);
    expect((await claudeAgent.installHooks(repo, "norn hook")).changed).toEqual([path]);
    expect(await claudeAgent.hooksInstalled(repo)).toBe(true);
    const s = read(path);
    expect(s.permissions).toEqual(original.permissions);
    expect(s.model).toBe("sonnet");
    expect(s.hooks.Stop).toEqual([
      original.hooks.Stop[0],
      { hooks: [{ type: "command", command: "norn hook stop --agent claude # norn-owned" }] },
    ]);
    expect(s.hooks.PreToolUse[1]).toEqual({ matcher: "*", hooks: [{ type: "command", command: "norn hook pre-tool-use --agent claude # norn-owned" }] });
    expect(Object.keys(s.hooks).sort()).toEqual(
      ["Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"],
    );

    expect((await claudeAgent.installHooks(repo, "norn hook")).changed).toEqual([]);
    // a changed hook command updates in place, never duplicates
    await claudeAgent.installHooks(repo, "/opt/norn hook");
    const s2 = read(path);
    expect(s2.hooks.Stop).toHaveLength(2);
    expect(s2.hooks.Stop[1].hooks[0].command).toBe("/opt/norn hook stop --agent claude # norn-owned");
    // a configured agent name (e.g. `fast: { adapter: claude }`) is what `norn hook --agent` receives
    await claudeAgent.installHooks(repo, "norn hook", "fast");
    expect(read(path).hooks.Stop[1].hooks[0].command).toBe("norn hook stop --agent fast # norn-owned");

    expect((await claudeAgent.uninstallHooks(repo)).changed).toEqual([path]);
    expect(read(path)).toEqual(original);
    expect((await claudeAgent.uninstallHooks(repo)).changed).toEqual([]);
  });

  test("fresh repo: install creates the file, uninstall leaves an empty object", async () => {
    const repo = tmp();
    await claudeAgent.installHooks(repo, "norn hook");
    await claudeAgent.uninstallHooks(repo);
    expect(read(join(repo, ".claude", "settings.json"))).toEqual({});
  });

  test("keeps the norn group position and removes norn hooks from events no longer installed", () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "old stop # norn-owned" }] },
          { hooks: [{ type: "command", command: "user" }] },
        ],
        SubagentStop: [{ hooks: [{ type: "command", command: "old sub # norn-owned" }] }],
      },
    };
    const out = shared.mergeNornHooks(settings, [{ native: "Stop", arg: "stop" }], "norn hook", "claude") as any;
    expect(out.hooks.Stop[0].hooks[0].command).toBe("norn hook stop --agent claude # norn-owned");
    expect(out.hooks.Stop[1].hooks[0].command).toBe("user");
    expect(out.hooks.SubagentStop).toBeUndefined();
  });

  test("invalid settings JSON is refused, not overwritten", async () => {
    const repo = tmp();
    const path = join(repo, ".claude", "settings.json");
    cpSync(join(FIX, "settings-user.json"), path);
    writeFileSync(path, "{ nope");
    await expect(claudeAgent.installHooks(repo, "norn hook")).rejects.toMatchObject({ code: "invalid_json" });
    expect(readFileSync(path, "utf8")).toBe("{ nope");
  });
});

describe("claude skills (SK1)", () => {
  test("reads skills from the repo's .claude/skills", () => {
    expect(claudeAgent.skillDir("/r")).toBe("/r/.claude/skills");
  });
});

describe("claude launchCommand (B2, B5)", () => {
  const base = { cwd: "/w", prompt: "Use the norn skill, then run `norn brief`.", env: { NORN_RUN: "r" }, config: {} };
  test("interactive, headless, resume, config overrides", () => {
    expect(claudeAgent.launchCommand(base)).toEqual({ argv: ["claude", "--", base.prompt], env: { NORN_RUN: "r" } });
    expect(claudeAgent.launchCommand({ ...base, headless: true, model: "opus" }).argv).toEqual(["claude", "-p", "--model", "opus", "--", base.prompt]);
    expect(
      claudeAgent.launchCommand({ ...base, resume: "abc123", config: { command: "/bin/claude", args: ["--permission-mode", "acceptEdits"], env: { A: "1", NORN_RUN: "x" } } }),
    ).toEqual({
      argv: ["/bin/claude", "--resume", "abc123", "--permission-mode", "acceptEdits", "--", base.prompt],
      env: { A: "1", NORN_RUN: "r" },
    });
  });
  test("a variadic flag in the configured args cannot swallow the prompt (B3)", () => {
    // the dogfood config: `claude -p` read the prompt as one more allowed tool and exited at once
    const args = ["--permission-mode", "acceptEdits", "--allowedTools", "Bash(norn:*)", "Bash(git:*)"];
    const argv = claudeAgent.launchCommand({ ...base, headless: true, config: { args } }).argv;
    expect(argv).toEqual(["claude", "-p", ...args, "--", base.prompt]);
    expect(argv.indexOf("--")).toBe(argv.length - 2);
  });
});

describe("claude lastAssistantMessage (C4)", () => {
  test("joins text blocks of the last assistant message, skipping sidechains and tool-only turns", async () => {
    expect(await claudeAgent.lastAssistantMessage(join(FIX, "transcript.jsonl"))).toBe(
      "Implemented the slice.\nTests are green; reporting done.",
    );
  });
  test("missing file → null", async () => {
    expect(await claudeAgent.lastAssistantMessage(join(FIX, "nope.jsonl"))).toBeNull();
  });
});
