import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_MARKER, extensionDir, extensionPath, extensionSource, gitignorePath, piHarness } from "../../src/index.ts";

const HOOK_COMMAND = "norn hook pi";
let wt: string;
const ext = () => extensionPath(wt);
const ignore = () => gitignorePath(wt);
const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "norn-harness-pi-"));
});
afterEach(() => rmSync(wt, { recursive: true, force: true }));

describe("pi install", () => {
  test("writes norn's extension and a .gitignore that keeps the folder out of git", async () => {
    expect(await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).toEqual({ changed: [ignore(), ext()] });
    expect(ext()).toBe(join(wt, ".pi", "extensions", "norn", "index.ts"));
    expect(readFileSync(ext(), "utf8")).toBe(extensionSource(HOOK_COMMAND));
    expect(readFileSync(ext(), "utf8").startsWith(EXTENSION_MARKER)).toBe(true);
    expect(readFileSync(ignore(), "utf8").split("\n")).toContain("*");
    expect(readdirSync(extensionDir(wt)).sort()).toEqual([".gitignore", "index.ts"]);
  });
  test("is idempotent: a second install changes nothing", async () => {
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    const first = readFileSync(ext(), "utf8");
    expect(await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).toEqual({ changed: [] });
    expect(readFileSync(ext(), "utf8")).toBe(first);
  });
  test("a changed hook command rewrites the extension alone", async () => {
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await piHarness.install({ worktree: wt, hookCommand: "bunx norn hook pi" })).toEqual({ changed: [ext()] });
    expect(readFileSync(ext(), "utf8")).toContain(JSON.stringify("bunx norn hook pi"));
  });
  test("the hook command is embedded as typed, `$&` and quotes included", async () => {
    const odd = `/opt/n o"rn/$&bin hook`;
    await piHarness.install({ worktree: wt, hookCommand: odd });
    expect(readFileSync(ext(), "utf8")).toContain(`const HOOK = ${JSON.stringify(odd)};`);
  });
  test("leaves the person's own extensions beside it alone", async () => {
    const mine = join(wt, ".pi", "extensions", "mine.ts");
    write(mine, "export default function () {}\n");
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    await piHarness.uninstall({ worktree: wt });
    expect(readFileSync(mine, "utf8")).toBe("export default function () {}\n");
    expect(existsSync(extensionDir(wt))).toBe(false);
  });
  test("writes through a temp file it renames into place, leaving no temp file behind", async () => {
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    await piHarness.install({ worktree: wt, hookCommand: "other hook pi" });
    expect(readdirSync(extensionDir(wt)).sort()).toEqual([".gitignore", "index.ts"]);
  });
  test("refuses an extension or .gitignore there that norn did not write, leaving it as it was", async () => {
    write(ext(), "export default function (pi) {}\n");
    await expect(piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).rejects.toThrow(/not norn's/);
    expect(readFileSync(ext(), "utf8")).toBe("export default function (pi) {}\n");
    expect(existsSync(ignore())).toBe(false);
    rmSync(ext());
    write(ignore(), "node_modules\n");
    await expect(piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND })).rejects.toThrow(/not norn's/);
    expect(readFileSync(ignore(), "utf8")).toBe("node_modules\n");
    expect(existsSync(ext())).toBe(false);
  });
});

describe("pi uninstall", () => {
  test("removes norn's files and the folders they leave empty", async () => {
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await piHarness.uninstall({ worktree: wt })).toEqual({ changed: [ext(), ignore()] });
    expect(existsSync(join(wt, ".pi"))).toBe(false);
  });
  test("keeps a .pi folder holding the person's settings", async () => {
    const settings = join(wt, ".pi", "settings.json");
    write(settings, "{}\n");
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    await piHarness.uninstall({ worktree: wt });
    expect(existsSync(settings)).toBe(true);
    expect(existsSync(join(wt, ".pi", "extensions"))).toBe(false);
  });
  test("keeps a person's file in norn's folder, and the folder with it", async () => {
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    const notes = join(extensionDir(wt), "notes.md");
    write(notes, "x");
    await piHarness.uninstall({ worktree: wt });
    expect(readdirSync(extensionDir(wt))).toEqual(["notes.md"]);
  });
  test("changes nothing when there is no extension or only a person's", async () => {
    expect(await piHarness.uninstall({ worktree: wt })).toEqual({ changed: [] });
    write(ext(), "export default function (pi) {}\n");
    expect(await piHarness.uninstall({ worktree: wt })).toEqual({ changed: [] });
    expect(readFileSync(ext(), "utf8")).toBe("export default function (pi) {}\n");
  });
});

describe("pi hook config", () => {
  test("is norn's extension as installed, null without it, and changes with any edit to it", async () => {
    expect(await piHarness.hookConfig?.(wt)).toBeNull();
    await piHarness.install({ worktree: wt, hookCommand: HOOK_COMMAND });
    expect(await piHarness.hookConfig?.(wt)).toBe(extensionSource(HOOK_COMMAND));
    write(ext(), `${extensionSource(HOOK_COMMAND)}\n// off\n`);
    expect(await piHarness.hookConfig?.(wt)).not.toBe(extensionSource(HOOK_COMMAND));
  });
});
