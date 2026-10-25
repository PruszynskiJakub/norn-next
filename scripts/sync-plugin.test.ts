/** X3: the Claude Code plugin ships the /norn command only, versioned with @norn/cli (scripts/sync-plugin.ts). */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pluginDrift } from "./sync-plugin.ts";

const PLUGIN = resolve(import.meta.dir, "..", "plugins", "claude-code");

test("plugin has no skills of its own and the @norn/cli version (run `bun run sync:plugin`)", () => {
  expect(pluginDrift()).toEqual([]);
});

test("plugin ships the /norn command and no logic", () => {
  const cmd = readFileSync(join(PLUGIN, "commands", "norn.md"), "utf8");
  expect(cmd).toContain("norn skill");
  expect(cmd).toContain("norn brief");
  for (const dir of ["hooks", "scripts", "bin", "skills"]) expect(existsSync(join(PLUGIN, dir))).toBe(false);
});
