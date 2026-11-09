import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAgent } from "../../../src/codex/index.ts";
import type { HookAnswer } from "@norn/core";
import type { HookFact } from "@norn/schema";
import payloads from "./fixtures/hook-payloads.json";

const FIX = join(import.meta.dir, "fixtures");
const AT = "2026-10-23T10:00:00.000Z";
const ENV = { NORN_STORY: "gh-12" };

describe("codex adapter", () => {
  test("tier and parse", () => {
    expect(codexAgent.tier).toBe("blocking");
    const f = (arg: string, p: unknown) => codexAgent.parseHookEvent(arg, p, ENV, AT);
    expect(f("session-start", payloads.SessionStart)).toMatchObject({ event: "session_start", agent_session_id: "019a-codex", story: "gh-12" });
    expect(f("pre-tool-use", payloads.PreToolUse)).toMatchObject({ event: "tool_use", tool: "Bash", command: "bun test" });
    expect(f("permission-request", payloads.PermissionRequest)).toMatchObject({ event: "permission_prompt", command: "git push" });
    expect(f("stop", payloads.Stop)).toMatchObject({ event: "turn_end", message: "Done.", transcript: payloads.Stop.transcript_path });
  });

  test("SessionStart carries its source in message, the session note's trigger", () => {
    const f = (p: unknown) => codexAgent.parseHookEvent("session-start", p, ENV, AT);
    expect(f(payloads.SessionStart)).toMatchObject({ event: "session_start", native: "SessionStart", message: "startup" });
    expect(f(payloads.SessionStartResume)).toMatchObject({ event: "session_start", native: "SessionStart", message: "resume", agent_session_id: "019a-codex" });
  });

  test("Stop block response", () => {
    const fact = codexAgent.parseHookEvent("stop", payloads.Stop, ENV, AT)!;
    expect(JSON.parse(codexAgent.hookResponse(fact, { kind: "block", reason: "report" }).stdout)).toEqual({ decision: "block", reason: "report" });
    expect(codexAgent.hookResponse(fact, { kind: "allow" }).stdout).toBe("");
  });

  test("deny on PreToolUse and context on SessionStart and UserPromptSubmit; allow for the rest", () => {
    const f = (arg: string, p: unknown) => codexAgent.parseHookEvent(arg, p, ENV, AT)!;
    const out = (fact: HookFact, a: HookAnswer) => JSON.parse(codexAgent.hookResponse(fact, a).stdout);
    expect(out(f("pre-tool-use", payloads.PreToolUse), { kind: "deny", reason: "only norn pushes" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "only norn pushes" },
    });
    expect(out(f("session-start", payloads.SessionStartResume), { kind: "context", text: "t" })).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "t" } });
    expect(out(f("user-prompt-submit", payloads.UserPromptSubmit), { kind: "context", text: "t" })).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "t" } });
    expect(codexAgent.hookResponse(f("permission-request", payloads.PermissionRequest), { kind: "deny", reason: "r" }).stdout).toBe("");
    expect(codexAgent.hookResponse(f("pre-tool-use", payloads.PreToolUse), { kind: "context", text: "t" }).stdout).toBe("");
    expect(codexAgent.hookResponse(f("stop", payloads.Stop), { kind: "deny", reason: "r" }).stdout).toBe("");
  });

  test("toolCall: the shell tool's full command and apply_patch's files; anything else null", () => {
    const call = (p: { hook_event_name: string }) => codexAgent.toolCall(p.hook_event_name, p);
    expect(call(payloads.PreToolUse)).toEqual({ kind: "shell", command: "bun test" });
    expect(call(payloads.PreToolUseApplyPatch)).toEqual({ kind: "file_write", paths: ["src/new.ts", "src/old.ts", "src/moved.ts", "src/gone.ts"] });
    expect(call(payloads.PreToolUseOther)).toBeNull();
    expect(call(payloads.PermissionRequest)).toBeNull();
    expect(call(payloads.Stop)).toBeNull();
  });

  test("hooks.json round-trip preserves user hooks", async () => {
    const repo = mkdtempSync(join(tmpdir(), "norn-codex-"));
    const path = join(repo, ".codex", "hooks.json");
    mkdirSync(join(repo, ".codex"));
    const user = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    writeFileSync(path, JSON.stringify(user));
    await codexAgent.installHooks(repo, "norn hook");
    expect(await codexAgent.hooksInstalled(repo)).toBe(true);
    const stop = JSON.parse(readFileSync(path, "utf8")).hooks.Stop;
    expect(stop).toHaveLength(2);
    expect(stop[1].hooks[0].command).toBe("norn hook stop --agent codex # norn-owned");
    expect((await codexAgent.installHooks(repo, "norn hook")).changed).toEqual([]);
    await codexAgent.uninstallHooks(repo);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(user);
  });

  test("launch", () => {
    const req = { cwd: "/w", prompt: "P", env: {}, config: {} };
    expect(codexAgent.launchCommand(req).argv).toEqual(["codex", "P"]);
    expect(codexAgent.launchCommand({ ...req, resume: "019a" }).argv).toEqual(["codex", "resume", "019a", "P"]);
    expect(codexAgent.launchCommand({ ...req, headless: true, model: "gpt-5" }).argv).toEqual(["codex", "exec", "--model", "gpt-5", "P"]);
    expect(codexAgent.skillDir("/r")).toBe("/r/.agents/skills");
  });

  test("last assistant message from rollout", async () => {
    expect(await codexAgent.lastAssistantMessage(join(FIX, "rollout.jsonl"))).toBe("Slice implemented; tests green.");
  });
});
