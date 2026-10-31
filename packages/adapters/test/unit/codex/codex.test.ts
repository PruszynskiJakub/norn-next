import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAgent } from "../../../src/codex/index.ts";
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

  test("Stop block response", () => {
    const fact = codexAgent.parseHookEvent("stop", payloads.Stop, ENV, AT)!;
    expect(JSON.parse(codexAgent.hookResponse(fact, { block: true, reason: "report" }).stdout)).toEqual({ decision: "block", reason: "report" });
    expect(codexAgent.hookResponse(fact, { block: false }).stdout).toBe("");
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
