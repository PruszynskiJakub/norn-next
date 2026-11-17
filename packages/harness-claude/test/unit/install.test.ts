import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_HOOKS, claudeHarness, hookCommandFor, NORN_MARKER, settingsLocalPath } from "../../src/index.ts";

const HOOK_COMMAND = "norn hook";
let wt: string;
const local = () => settingsLocalPath(wt);
const committed = () => join(wt, ".claude", "settings.json");
const read = () => JSON.parse(readFileSync(local(), "utf8"));
const write = (path: string, value: unknown) => {
  mkdirSync(join(wt, ".claude"), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

/** A person's own local settings, with hooks of their own on events norn also wires. */
const PERSON = {
  permissions: { allow: ["Bash(bun test:*)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/guard.sh" }] }],
    Stop: [{ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff" }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "./scripts/log-prompt.sh" }] }],
  },
  model: "sonnet",
};

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "norn-harness-claude-"));
});
afterEach(() => rmSync(wt, { recursive: true, force: true }));

describe("claude install", () => {
  test("writes one norn entry per wired hook into settings.local.json, matchers on tool hooks", async () => {
    expect(await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).toEqual({ changed: [local()] });
    const hooks = read().hooks;
    expect(Object.keys(hooks)).toEqual([...CLAUDE_HOOKS]);
    expect(hooks.PreToolUse).toEqual([{ matcher: "*", hooks: [{ type: "command", command: `norn hook claude PreToolUse ${NORN_MARKER}` }] }]);
    expect(hooks.Stop).toEqual([{ hooks: [{ type: "command", command: hookCommandFor(HOOK_COMMAND, "Stop") }] }]);
    expect(existsSync(committed())).toBe(false);
  });
  test("is idempotent: a second install changes nothing", async () => {
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    const first = readFileSync(local(), "utf8");
    expect(await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).toEqual({ changed: [] });
    expect(readFileSync(local(), "utf8")).toBe(first);
  });
  test("merges with the person's settings, keeping their keys and hooks first", async () => {
    write(local(), PERSON);
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    const s = read();
    expect(Object.keys(s)).toEqual(["permissions", "hooks", "model"]);
    expect(s.permissions).toEqual(PERSON.permissions);
    expect(s.hooks.PreToolUse).toEqual([...PERSON.hooks.PreToolUse, { matcher: "*", hooks: [{ type: "command", command: hookCommandFor(HOOK_COMMAND, "PreToolUse") }] }]);
    expect(s.hooks.Stop[0]).toEqual(PERSON.hooks.Stop[0]);
    expect(s.hooks.Stop).toHaveLength(2);
  });
  test("a changed hook command replaces norn's entries instead of adding more", async () => {
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await claudeHarness.install({ worktree: wt, hookCommand: "bunx norn hook" })).toEqual({ changed: [local()] });
    expect(read().hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "bunx norn hook claude Stop # norn-owned" }] }]);
  });
  test("writes through a temp file it renames into place, leaving no temp file behind", async () => {
    write(local(), PERSON);
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    await claudeHarness.uninstall({ worktree: wt });
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(readdirSync(join(wt, ".claude"))).toEqual(["settings.local.json"]);
  });
  test("creates the .claude folder when the worktree has none", async () => {
    expect(existsSync(join(wt, ".claude"))).toBe(false);
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(Object.keys(read().hooks)).toEqual([...CLAUDE_HOOKS]);
  });
  test("never touches the committed settings.json", async () => {
    write(committed(), { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo shared" }] }] } });
    const before = readFileSync(committed(), "utf8");
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    await claudeHarness.uninstall({ worktree: wt });
    expect(readFileSync(committed(), "utf8")).toBe(before);
  });
  test("refuses a settings file that is not a JSON object or has malformed hooks, leaving it as it was", async () => {
    write(local(), "{ not json");
    await expect(claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(local(), "utf8")).toBe("{ not json");
    write(local(), "[1]");
    await expect(claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).rejects.toThrow(/JSON object/);
    write(local(), { hooks: { Stop: "x" } });
    await expect(claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).rejects.toThrow(/hooks.Stop/);
    expect(read()).toEqual({ hooks: { Stop: "x" } });
  });
});

describe("claude uninstall", () => {
  test("removes only norn's entries, restoring the person's settings", async () => {
    write(local(), PERSON);
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await claudeHarness.uninstall({ worktree: wt })).toEqual({ changed: [local()] });
    expect(read()).toEqual(PERSON);
  });
  test("keeps a person's hook that shares a group with norn's", async () => {
    write(local(), { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }, { type: "command", command: hookCommandFor(HOOK_COMMAND, "Stop") }] }] } });
    await claudeHarness.uninstall({ worktree: wt });
    expect(read()).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } });
  });
  test("removes the file when only norn's entries were in it", async () => {
    await claudeHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await claudeHarness.uninstall({ worktree: wt })).toEqual({ changed: [local()] });
    expect(existsSync(local())).toBe(false);
  });
  test("changes nothing when there is no file or no norn entry", async () => {
    expect(await claudeHarness.uninstall({ worktree: wt })).toEqual({ changed: [] });
    write(local(), PERSON);
    const before = readFileSync(local(), "utf8");
    expect(await claudeHarness.uninstall({ worktree: wt })).toEqual({ changed: [] });
    expect(readFileSync(local(), "utf8")).toBe(before);
  });
});
