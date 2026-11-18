import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost, nodeExec } from "@norn/host-node";
import { CliContext, type CliIo, configPaths, importFromPluginsDir } from "../../src/index.ts";
import { LOCAL_CONFIG } from "../unit/support.ts";
import { AGENT_STEP, RUN, runEnv, seedIn } from "../unit/units.ts";

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");

/** Claude Code's Stop payload, as recorded from a real session. */
const STOP = JSON.stringify({
  session_id: "abc123",
  transcript_path: "/home/u/.claude/projects/-repo/abc123.jsonl",
  cwd: "/repo/.worktrees/gh-12",
  permission_mode: "default",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "All tests pass.",
});

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const r = await nodeExec(argv, { cwd });
  if (r.code !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A temp repo with a repo-local config and a temp norn home, the unit's agent run live on its record. */
async function liveRun(): Promise<{ root: string; env: Record<string, string> }> {
  // realpath: macOS hands out /var under /private, and git names the canonical path
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-hook-")));
  const root = join(dir, "repo");
  const home = join(dir, "home");
  await sh(dir, "git", "init", "-q", "-b", "main", root);
  await sh(root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: dir, NORN_HOME_DIR: home, USER: "t" };
  const io: CliIo = {
    env,
    cwd: root,
    userHome: dir,
    stdin: async () => "",
    self: ["bun", MAIN],
    version: "0.0.0",
    hosts: { host: createNodeHost, exec: nodeExec },
    importer: importFromPluginsDir,
  };
  const ctx = new CliContext(io);
  await (await ctx.host()).files.write(configPaths(home, root).local, LOCAL_CONFIG);
  await seedIn(await ctx.runtimeEnv(), { step: AGENT_STEP });
  return { root, env };
}

async function norn(root: string, env: Record<string, string>, argv: string[], input = "") {
  return nodeExec(["bun", MAIN, ...argv], { cwd: root, env, input });
}

describe("norn hook claude over a live run", () => {
  test("a recorded Stop payload is blocked until the run reports done, then allowed", async () => {
    const { root, env } = await liveRun();
    const agent = { ...env, ...runEnv() };
    const blocked = await norn(root, agent, ["hook", "claude", "Stop"], STOP);
    expect(blocked.code).toBe(0);
    const reply = Bun.JSONL.parse(blocked.stdout)[0] as { decision: string; reason: string };
    expect(reply.decision).toBe("block");
    expect(reply.reason).toContain("norn done");

    const done = await norn(root, agent, ["done", "done", "--json"]);
    expect({ code: done.code, body: Bun.JSONL.parse(done.stdout)[0] }).toMatchObject({ code: 0, body: { run_id: RUN, outcome: "done", replayed: false } });

    const allowed = await norn(root, agent, ["hook", "claude", "Stop"], STOP);
    expect({ code: allowed.code, stdout: allowed.stdout }).toEqual({ code: 0, stdout: "" });
  });
});
