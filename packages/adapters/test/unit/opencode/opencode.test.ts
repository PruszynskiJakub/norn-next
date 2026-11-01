import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencodeAgent, pluginPath } from "../../../src/opencode/index.ts";
import payloads from "./fixtures/hook-payloads.json";

const FIX = join(import.meta.dir, "fixtures");
const AT = "2026-10-23T10:00:00.000Z";

describe("opencode adapter", () => {
  test("tier hooks; parse plugin payloads", () => {
    expect(opencodeAgent.tier).toBe("hooks");
    const f = (arg: string, p: unknown) => opencodeAgent.parseHookEvent(arg, p, {}, AT);
    expect(f("session.idle", payloads["session.idle"])).toMatchObject({ event: "turn_end", agent_session_id: "ses_01" });
    expect(f("permission.asked", payloads["permission.asked"])).toMatchObject({ event: "permission_prompt", command: "bash: git push" });
    expect(f("tool.execute.before", payloads["tool.execute.before"])).toMatchObject({ event: "tool_use", tool: "bash", command: "bun test" });
    expect(opencodeAgent.hookResponse(f("session.idle", payloads["session.idle"])!, { block: true })).toEqual({ stdout: "", exit_code: 0 });
  });

  test("plugin install/uninstall; never touches a foreign file", async () => {
    const repo = mkdtempSync(join(tmpdir(), "norn-opencode-"));
    expect((await opencodeAgent.installHooks(repo, "norn hook")).changed).toEqual([pluginPath(repo)]);
    expect(readFileSync(pluginPath(repo), "utf8")).toContain('const HOOK = "norn hook"');
    expect(await opencodeAgent.hooksInstalled(repo)).toBe(true);
    expect((await opencodeAgent.installHooks(repo, "norn hook")).changed).toEqual([]);
    await opencodeAgent.uninstallHooks(repo);
    expect(existsSync(pluginPath(repo))).toBe(false);

    mkdirSync(join(repo, ".opencode", "plugins"), { recursive: true });
    writeFileSync(pluginPath(repo), "export const Mine = 1;\n");
    await expect(opencodeAgent.installHooks(repo, "norn hook")).rejects.toMatchObject({ code: "not_norn_owned" });
    expect((await opencodeAgent.uninstallHooks(repo)).changed).toEqual([]);
  });

  test("launch and export transcript", async () => {
    const req = { cwd: "/w", prompt: "P", env: {}, config: {} };
    expect(opencodeAgent.launchCommand(req).argv).toEqual(["opencode", "--prompt", "P"]);
    expect(opencodeAgent.launchCommand({ ...req, headless: true, resume: "ses_01" }).argv).toEqual(["opencode", "run", "--session", "ses_01", "P"]);
    expect(await opencodeAgent.lastAssistantMessage(join(FIX, "export.json"))).toBe("Implemented.");
  });
});
