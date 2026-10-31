import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiAgent } from "../../../src/gemini/index.ts";
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

  test("AfterAgent deny response", () => {
    const fact = geminiAgent.parseHookEvent("after-agent", payloads.AfterAgent, {}, AT)!;
    expect(JSON.parse(geminiAgent.hookResponse(fact, { block: true, reason: "report" }).stdout)).toEqual({ decision: "deny", reason: "report" });
    expect(geminiAgent.hookResponse(fact, { block: false }).stdout).toBe("{}\n");
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
