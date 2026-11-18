import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeHarness } from "../../src/index.ts";

let root: string;
let repo: string;

/** No global or XDG git config, so no machine-wide ignore of Claude Code's local settings hides the file. */
function git(...args: string[]): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", XDG_CONFIG_HOME: join(root, "xdg") };
  const r = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "norn-harness-claude-git-"));
  repo = join(root, "repo");
  Bun.spawnSync(["git", "init", "-q", repo]);
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("the installed hooks leave the worktree clean and out of `git add -A`, and uninstall leaves nothing behind", async () => {
  await claudeHarness.install({ worktree: repo, hookCommand: "norn hook claude" });
  expect(git("status", "--porcelain")).toBe("");
  git("add", "-A");
  expect(git("diff", "--cached", "--name-only")).toBe("");
  await claudeHarness.uninstall({ worktree: repo });
  expect(git("status", "--porcelain", "--ignored")).toBe("");
});
