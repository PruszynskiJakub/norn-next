import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiAgent } from "../../../src/gemini/index.ts";
import type { HookAnswer } from "@norn/core";
import type { HookFact } from "@norn/schema";
import payloads from "./fixtures/hook-payloads.json";

const FIX = join(import.meta.dir, "fixtures");
const AT = "2026-10-23T10:00:00.000Z";

describe("gemini adapter", () => {
  test("parse", () => {
    const f = (arg: string, p: unknown) => geminiAgent.parseHookEvent(arg, p, {}, AT);
    expect(f("before-tool", payloads.BeforeTool)).toMatchObject({ event: "tool_use", tool: "run_shell_command", command: "bun test" });
    expect(f("notification", payloads.Notification)).toMatchObject({ event: "permission_prompt", command: "Allow run_shell_command: git push?" });
    expect(f("after-agent", payloads.AfterAgent)).toMatchObject({ event: "turn_end", native: "AfterAgent", message: "Finished.", agent_session_id: "gem-1" });
  });

  test("SessionStart carries its source in message, the session note's trigger", () => {
    const f = (p: unknown) => geminiAgent.parseHookEvent("session-start", p, {}, AT);
    expect(f(payloads.SessionStart)).toMatchObject({ event: "session_start", native: "SessionStart", message: "resume", agent_session_id: "gem-1" });
    expect(f(payloads.SessionStartClear)).toMatchObject({ event: "session_start", native: "SessionStart", message: "clear", agent_session_id: "gem-2" });
  });

  test("AfterAgent deny response", () => {
    const fact = geminiAgent.parseHookEvent("after-agent", payloads.AfterAgent, {}, AT)!;
    expect(JSON.parse(geminiAgent.hookResponse(fact, { kind: "block", reason: "report" }).stdout)).toEqual({ decision: "deny", reason: "report" });
    expect(geminiAgent.hookResponse(fact, { kind: "allow" }).stdout).toBe("{}\n");
  });

  test("deny on BeforeTool and context on SessionStart and BeforeAgent; {} for the rest", () => {
    const f = (arg: string, p: unknown) => geminiAgent.parseHookEvent(arg, p, {}, AT)!;
    const out = (fact: HookFact, a: HookAnswer) => JSON.parse(geminiAgent.hookResponse(fact, a).stdout);
    expect(out(f("before-tool", payloads.BeforeTool), { kind: "deny", reason: "only norn pushes" })).toEqual({ decision: "deny", reason: "only norn pushes" });
    expect(out(f("session-start", payloads.SessionStart), { kind: "context", text: "t" })).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "t" } });
    expect(out(f("before-agent", payloads.BeforeAgent), { kind: "context", text: "t" })).toEqual({ hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: "t" } });
    expect(out(f("before-tool", payloads.BeforeTool), { kind: "context", text: "t" })).toEqual({});
    expect(out(f("notification", payloads.Notification), { kind: "deny", reason: "r" })).toEqual({});
    expect(out(f("after-agent", payloads.AfterAgent), { kind: "context", text: "t" })).toEqual({});
  });

  test("toolCall: run_shell_command's full command, write_file and replace's path; anything else null", () => {
    const call = (p: { hook_event_name: string }) => geminiAgent.toolCall(p.hook_event_name, p);
    expect(call(payloads.BeforeTool)).toEqual({ kind: "shell", command: "bun test" });
    expect(call(payloads.BeforeToolWriteFile)).toEqual({ kind: "file_write", paths: ["/repo/.worktrees/gh-12/src/a.ts"] });
    expect(call(payloads.BeforeToolReplace)).toEqual({ kind: "file_write", paths: ["/repo/.worktrees/gh-12/src/b.ts"] });
    expect(call(payloads.BeforeToolReadFile)).toBeNull();
    expect(call(payloads.AfterAgent)).toBeNull();
  });

  test("settings.json round-trip", async () => {
    const repo = mkdtempSync(join(tmpdir(), "norn-gemini-"));
    const path = join(repo, ".gemini", "settings.json");
    mkdirSync(join(repo, ".gemini"));
    const user = { theme: "Dracula", hooks: { BeforeTool: [{ matcher: "write_file", hooks: [{ type: "command", command: "./lint.sh" }] }] } };
    writeFileSync(path, JSON.stringify(user));
    await geminiAgent.installHooks(repo, "norn hook");
    const s = JSON.parse(readFileSync(path, "utf8"));
    expect(s.hooks.AfterAgent[0].hooks[0]).toEqual({ type: "command", command: "norn hook after-agent --agent gemini # norn-owned", name: "norn-after-agent" });
    expect(s.hooks.BeforeTool).toHaveLength(2);
    await geminiAgent.uninstallHooks(repo);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(user);
  });

  test("launch and transcript", async () => {
    const req = { cwd: "/w", prompt: "P", env: {}, config: {} };
    expect(geminiAgent.launchCommand(req).argv).toEqual(["gemini", "-i", "P"]);
    expect(geminiAgent.launchCommand({ ...req, headless: true, resume: "latest" }).argv).toEqual(["gemini", "--resume", "latest", "-p", "P"]);
    expect(await geminiAgent.lastAssistantMessage(join(FIX, "chat.json"))).toBe("All checks pass.");
  });
});
