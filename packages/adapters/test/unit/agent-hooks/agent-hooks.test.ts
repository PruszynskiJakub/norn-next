import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasNornHooks, jsonHookInstaller, mergeNornHooks, readJsonObject, removeNornHooks, writeJsonIfChanged } from "../../../src/agent-hooks/index.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "norn-agent-hooks-"));
const SPECS = [{ native: "Stop", arg: "stop" }];

describe("hook config merge (A1)", () => {
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
    const out = mergeNornHooks(settings, SPECS, "norn hook", "claude") as any;
    expect(out.hooks.Stop[0].hooks[0].command).toBe("norn hook stop --agent claude # norn-owned");
    expect(out.hooks.Stop[1].hooks[0].command).toBe("user");
    expect(out.hooks.SubagentStop).toBeUndefined();
  });

  test("merge is idempotent and remove restores the user's settings", () => {
    const user = { model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] } };
    const once = mergeNornHooks(user, SPECS, "norn hook", "claude");
    expect(mergeNornHooks(once, SPECS, "norn hook", "claude")).toEqual(once);
    expect(hasNornHooks(once, SPECS)).toBe(true);
    expect(removeNornHooks(once)).toEqual(user);
  });
});

describe("settings files (S1, S2)", () => {
  test("readJsonObject: missing → {}, invalid → PortError", () => {
    const dir = tmp();
    expect(readJsonObject(join(dir, "none.json"))).toEqual({});
    writeFileSync(join(dir, "bad.json"), "{ nope");
    expect(() => readJsonObject(join(dir, "bad.json"))).toThrow(expect.objectContaining({ code: "invalid_json" }));
    writeFileSync(join(dir, "arr.json"), "[]");
    expect(() => readJsonObject(join(dir, "arr.json"))).toThrow(expect.objectContaining({ code: "invalid_json" }));
  });

  test("writeJsonIfChanged writes atomically, only on change, leaving no temp files", () => {
    const dir = tmp();
    const path = join(dir, "nested", "settings.json");
    expect(writeJsonIfChanged(path, { a: 1 })).toBe(true);
    expect(writeJsonIfChanged(path, { a: 1 })).toBe(false);
    expect(readFileSync(path, "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(readdirSync(join(dir, "nested"))).toEqual(["settings.json"]);
  });

  test("jsonHookInstaller: install, detect, uninstall", async () => {
    const repo = tmp();
    const installer = jsonHookInstaller("claude", (r) => join(r, ".x", "settings.json"), SPECS);
    expect(await installer.uninstallHooks(repo)).toEqual({ changed: [] });
    expect((await installer.installHooks(repo, "norn hook")).changed).toHaveLength(1);
    expect(await installer.installHooks(repo, "norn hook")).toEqual({ changed: [] });
    expect(await installer.hooksInstalled(repo)).toBe(true);
    await installer.uninstallHooks(repo);
    expect(await installer.hooksInstalled(repo)).toBe(false);
  });
});
