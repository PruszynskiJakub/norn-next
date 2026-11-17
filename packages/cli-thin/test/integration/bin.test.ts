import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { bundledNames, locateRepo } from "../../src/index.ts";

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const r = await nodeExec(argv, { cwd });
  if (r.code !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

async function repo(): Promise<string> {
  // realpath: macOS hands out /var under /private, and git names the canonical path
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-thin-")));
  const root = join(dir, "repo");
  await sh(dir, "git", "init", "-q", "-b", "main", root);
  await sh(root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return root;
}

describe("the machine dir over real git", () => {
  test("a linked worktree, elsewhere on disk, shares its repository's id and root; a second clone does not", async () => {
    const root = await repo();
    const wt = join(root, "..", "wt");
    await sh(root, "git", "worktree", "add", "-q", "-b", "side", wt);
    const main = await locateRepo(nodeExec, root);
    expect(main.root).toBe(root);
    expect(await locateRepo(nodeExec, wt)).toEqual(main);
    const other = await repo();
    expect((await locateRepo(nodeExec, other)).id).not.toBe(main.id);
  });
});

describe("the norn-thin binary", () => {
  test("--version prints the norn, plugin API and bundled plugin versions as one JSON value", async () => {
    const r = await nodeExec(["bun", MAIN, "--version", "--json"], { cwd: tmpdir() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ plugin_api: PLUGIN_API_VERSION, bundled: bundledNames() });
  });

  test("outside a repo a command refuses with exit 3, and a hook still answers with exit 0", async () => {
    const tick = await nodeExec(["bun", MAIN, "tick", "--json"], { cwd: tmpdir() });
    expect({ code: tick.code, body: JSON.parse(tick.stdout) }).toMatchObject({ code: 3, body: { code: "not_a_repo" } });
    const hook = await nodeExec(["bun", MAIN, "hook", "claude", "Stop"], { cwd: tmpdir(), input: "{}" });
    expect({ code: hook.code, stdout: hook.stdout }).toEqual({ code: 0, stdout: "" });
  });
});
