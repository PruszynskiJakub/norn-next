import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { AGENTS_DIR, REPO_LOCAL_FILE } from "../../src/index.ts";

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const r = await nodeExec(argv, { cwd });
  if (r.code !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A fresh repository and an empty norn home beside it, both under the temp folder. */
async function setup(): Promise<{ root: string; home: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-host-")));
  const root = join(dir, "repo");
  await sh(dir, "git", "init", "-q", "-b", "main", root);
  await sh(root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return { root, home: join(dir, "home") };
}

/** The binary from source; HERDR_ENV emptied so a person's running herdr is never probed. */
async function norn(s: { root: string; home: string }, ...args: string[]) {
  const r = await nodeExec(["bun", MAIN, ...args], { cwd: s.root, env: { NORN_HOME_DIR: s.home, HERDR_ENV: "" }, timeoutMs: 60_000 });
  return { code: r.code, body: JSON.parse(r.stdout) as Record<string, unknown>, stderr: r.stderr };
}

interface Check {
  name: string;
  ok: boolean;
}

describe("the host commands over a real repository", () => {
  test("init, config show, doctor and tick", async () => {
    const s = await setup();

    const init = await norn(s, "init", "--tracker", "local", "--forge", "none", "--store", "local", "--executor", "claude", "--runner", "headless", "--yes", "--json");
    expect(init.code).toBe(0);
    expect(init.body).toMatchObject({ layer: "local", exclude: "added", chose: { tracker: "local", forge: "none", store: "local", executor: "claude", runner: "headless", base: "main" } });
    expect(readFileSync(join(s.root, REPO_LOCAL_FILE), "utf8")).toContain("use: local");
    expect(readFileSync(join(s.root, ".git", "info", "exclude"), "utf8").split("\n")).toContain(AGENTS_DIR);
    // the config is kept out of git: the checkout stays clean
    expect(await sh(s.root, "git", "status", "--porcelain")).toBe("");

    const show = await norn(s, "config", "show", "--json");
    expect(show.code).toBe(0);
    expect(show.body).toMatchObject({ valid: true, config: { tracker: { use: "local" }, vcs: { use: "git" } }, origins: { "tracker.use": "local", "vcs.use": "default" } });

    const doctor = await norn(s, "doctor", "--json");
    const checks = (doctor.body as { checks: Check[] }).checks;
    const passing = Object.fromEntries(checks.map((c) => [c.name, c.ok]));
    expect(passing).toMatchObject({ config: true, plugins: true, slots: true, workflows: true, hooks: true, "tool git": true });
    // claude may or may not be on this machine; the exit code follows whether it is
    expect(doctor.code).toBe(passing["tool claude"] ? 0 : 1);

    const tick = await norn(s, "tick", "--json");
    expect(tick.code).toBe(0);
    expect(tick.body).toMatchObject({ decisions: [], outcomes: [], problems: [] });
    expect(typeof tick.body.tick_id).toBe("string");
  });
});
