import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencodeAgent, pluginPath } from "../../../src/opencode/index.ts";

describe("opencode adapter", () => {
  test("generated plugin is valid JS and calls `<hook> <event> --agent <name>`", async () => {
    const repo = mkdtempSync(join(tmpdir(), "norn-opencode-"));
    const calls = join(repo, "calls");
    await opencodeAgent.installHooks(repo, `printf '%s\\n' >> '${calls}'`, "oc");
    const mod = await import(pluginPath(repo));
    const hooks = await mod.NornPlugin({ directory: repo });
    expect(Object.keys(hooks).sort()).toEqual(["chat.message", "event", "tool.execute.after", "tool.execute.before"]);
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    expect(readFileSync(calls, "utf8")).toBe("session.idle\n--agent\noc\n");
  });
});
