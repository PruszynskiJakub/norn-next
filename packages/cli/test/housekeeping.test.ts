/**
 * Housekeeping and machine checks: agent leases outlive the launching tick so max_agents holds
 * across ticks (K1, K3), orphans reported by every tick and cleaned by `norn tidy` (K5), the
 * GR6 record on the base branch, and `norn doctor` (A7).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { git as gitAdapter } from "@norn/adapters";
import type { StoryFrontmatter } from "@norn/schema";
import { appendReceipt, leasesDir, readState, writeStoryFile } from "@norn/store";
import { pluginLinkHint } from "../src/commands/doctor.ts";
import { assetsDir } from "../src/runtime/assets.ts";
import { markStoryOnBase } from "../src/runtime/record.ts";
import { type TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";
import { runChecked } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
max_agents: 1
notifiers: []
`;

const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);

async function boot(h: Harness) {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
}

describe("max_agents holds across ticks when the runner reports no process (K1, K3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
    h.remote.issues = [issue(1, "First"), issue(2, "Second")];
  });
  afterAll(() => h.cleanup());

  test("the second story stays queued after the launching tick is gone; it starts when the first run ends", async () => {
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    const runs1 = join(`${h.root}-worktrees/gh-1-first`, ".agents/specs/gh-1-first/runs/_story");
    const runs2 = join(`${h.root}-worktrees/gh-2-second`, ".agents/specs/gh-2-second/runs/_story");
    expect(readState(runs1).ok && (readState(runs1) as { value: { status: string } }).value.status).toBe("running");
    expect(h.runner.launches).toHaveLength(1);

    // the tick that launched the pane-runner agent has exited: its pid is dead
    const file = join(leasesDir(h.home), "agent-1.json");
    const lease = JSON.parse(readFileSync(file, "utf8"));
    expect(lease.worktree).toBe(`${h.root}-worktrees/gh-1-first`);
    h.write(file, JSON.stringify({ ...lease, holder: { pid: 999_999, pid_start: "Thu Jan  1 00:00:00 1970" } }));

    for (let i = 0; i < 2; i++) {
      h.clock.advance(10_000);
      const r = await h.tick();
      expect(kinds(r).filter((k) => !k.endsWith("commit_push"))).toEqual([]);
      expect(r.decisions.find((d) => d.unit === "gh-2")?.rule).toBe("agent.queued");
    }
    expect(existsSync(file)).toBe(true);
    expect(h.runner.launches).toHaveLength(1);

    const st = readState(runs1);
    if (!st.ok) throw new Error("no state");
    appendReceipt(runs1, { kind: "done", receipt_id: "01KA0000000000000000000001", run_id: st.value.run?.run_id ?? null, step: st.value.step, attempt: st.value.attempt, at: h.clock.iso(), by: "agent", outcome: "done", handoff: "done" });
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    expect(kinds(await h.tick())).toContain("gh-2 start_run");
    expect(readState(runs2).ok).toBe(true);
  });
});

describe("orphans (K5): reported by every tick, cleaned by norn tidy", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
    h.remote.issues = [issue(3, "Third")];
  });
  afterAll(() => h.cleanup());

  test("tick reports orphan branches and worktrees; tidy --dry-run lists, tidy removes only what is safe", async () => {
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      await h.tick("--offline");
      if (i === 0) await h.tick("--sync");
    }
    h.git(["branch", "gh-99-old-story", "main"]); // story unknown here, commits on main → safe
    h.git(["branch", "gh-98/01-lost", "main"]);
    const lost = `${h.root}-lost`;
    h.git(["worktree", "add", "-q", lost, "gh-98/01-lost"]);
    h.write(join(lost, "x.txt"), "unique\n");
    h.git(["add", "-A"], lost);
    h.git(["commit", "-q", "-m", "unique work"], lost);
    h.git(["worktree", "remove", lost]);
    const orphanWt = `${h.root}-worktrees/gh-97-gone`;
    h.git(["worktree", "add", "-q", "-b", "gh-97-gone", orphanWt, "main"]);
    // a leftover receipt reservation
    const runs = join(`${h.root}-worktrees/gh-3-third`, ".agents/specs/gh-3-third/runs/_story/receipts");
    const reserve = join(runs, ".0042.reserve");
    h.write(reserve, "01KA0000000000000000000002");
    utimesSync(reserve, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));

    h.clock.advance(10_000);
    const t = await h.tick("--offline");
    expect(t.orphans).toEqual({ worktrees: [orphanWt], branches: ["gh-98/01-lost", "gh-99-old-story"] });
    // a lease whose holder died after that tick (ticks reclaim these too)
    h.write(join(leasesDir(h.home), "check-2.json"), JSON.stringify({ version: 1, kind: "check", repo: h.root, story: "gh-3", slice: null, run_id: null, holder: { pid: 999_999, pid_start: "x" }, created_at: h.clock.iso() }));

    const dry = await h.norn("tidy", "--dry-run");
    expect(dry.exit).toBe(0);
    expect(dry.value).toMatchObject({
      dry_run: true,
      would_remove: { worktrees: [orphanWt], branches: ["gh-99-old-story"], leases: ["check-2.json"], reserve_files: [reserve] },
      kept: [{ item: "gh-98/01-lost", reason: expect.stringContaining("nowhere else") }],
    });
    expect(existsSync(orphanWt)).toBe(true);

    const real = await h.norn("tidy");
    expect(real.exit).toBe(0);
    expect(real.value).toMatchObject({ dry_run: false, removed: { worktrees: [orphanWt], branches: ["gh-99-old-story"], leases: ["check-2.json"], reserve_files: [reserve] } });
    expect(existsSync(orphanWt)).toBe(false);
    expect(existsSync(reserve)).toBe(false);
    expect(h.git(["branch", "--list", "gh-99-old-story"])).toBe("");
    expect(h.git(["branch", "--list", "gh-98/01-lost"])).not.toBe("");
    expect(readdirSync(leasesDir(h.home))).not.toContain("check-2.json");
    h.clock.advance(10_000);
    expect((await h.tick("--offline")).orphans).toEqual({ worktrees: [], branches: ["gh-97-gone", "gh-98/01-lost"] });
  });
});

describe("GR6 record on the base branch", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.cleanup());

  const fm: StoryFrontmatter = {
    id: "gh-5",
    slug: "merged",
    provider: "gh",
    number: 5,
    url: "https://github.com/o/r/issues/5",
    title: "Merged",
    assignee: "tester",
    labels: ["norn"],
    workflow: "solo",
    status: "active",
    intake_at: "2099-01-15T10:00:00.000Z",
    body_hash: "0".repeat(64),
  };
  const opts = (h: Harness) => ({ root: h.root, remote: "origin", git: gitAdapter.createGit(), base: "main", spec_dir: ".agents/specs/gh-5-merged", story: "gh-5", status: "done" as const, trailers: { "Norn-Story": "gh-5" } });

  test("deferred while story.md is not on the base branch", async () => {
    expect(await markStoryOnBase(opts(h))).toMatchObject({ state: "deferred" });
  });

  test("after the merge: committed in a throwaway worktree and pushed to the base branch; main checkout untouched", async () => {
    // a merged story PR: the spec folder reaches main on the remote (not pulled here)
    const other = join(h.dir, "merger");
    h.git(["clone", "-q", h.remoteDir, other], h.dir);
    writeStoryFile(join(other, ".agents/specs/gh-5-merged/story.md"), fm, "\nspec\n");
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "add", "-A"], other);
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "commit", "-q", "-m", "merge story"], other);
    h.git(["push", "-q", "origin", "main"], other);

    const head = h.git(["rev-parse", "HEAD"]);
    const r = await markStoryOnBase(opts(h));
    expect(r).toMatchObject({ state: "pushed", branch: "main" });
    expect(h.git(["rev-parse", "HEAD"])).toBe(head);
    expect(h.git(["status", "--porcelain"])).toBe("");
    expect(h.git(["show", "origin/main:.agents/specs/gh-5-merged/story.md"])).toContain("status: done");
    expect(h.git(["log", "-1", "--format=%(trailers:only)", "origin/main"])).toContain("Norn-Story: gh-5");
    expect(h.git(["worktree", "list"]).split("\n")).toHaveLength(1);
    expect(await markStoryOnBase(opts(h))).toMatchObject({ state: "unchanged" });
  });
});

describe("norn doctor (A7)", () => {
  let h: Harness;
  const main = join(import.meta.dir, "../src/main.ts");
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("reports agents, hooks (installed and firing through the hook command), remote auth and runner", async () => {
    const env = { ...h.deps.env, NORN_HOOK_COMMAND: `${process.execPath} ${main} hook` };
    const r = await runChecked(["doctor"], { ...h.deps, env });
    const v = r.value as {
      ok: boolean;
      live: boolean;
      git: { ok: boolean };
      agents: Array<{ name: string; tier: string; hooks_installed: boolean; hook_fires: { ok: boolean; recorded: number }; binary: { command: string } }>;
      remote: { ok: boolean; provider: string; user: string; git_remote: { name: string; url: string | null } };
      runner: { ok: boolean; available: boolean };
    };
    expect(r.exit).toBe(v.ok ? 0 : 1);
    expect(v.live).toBe(false);
    expect(v.git.ok).toBe(true);
    expect(v.agents).toHaveLength(1);
    expect(v.agents[0]).toMatchObject({ name: "claude", tier: "blocking", hooks_installed: true, binary: { command: "claude" }, hook_fires: { ok: true, recorded: 1 } });
    expect(v.remote).toEqual({ ok: true, provider: "gh", user: "tester", git_remote: { name: "origin", url: h.remoteDir } });
    expect(v.runner).toMatchObject({ ok: true, available: true });
    // R8.2: `command -v norn` in a throwaway runner session resolves to this norn's shim
    const shim = join(h.home, "bin", "norn");
    expect(v.runner).toMatchObject({ norn_on_path: { ok: true, expected: shim, resolved: shim } });
    // R7.3: the harness names its machine with NORN_MACHINE — a test aid doctor warns about
    expect(r.value).toMatchObject({ machine: { holder: "tester@box", override: "box" }, warnings: [expect.stringContaining("NORN_MACHINE=box")] });
  });

  test("prints the report for a person, with the same exit code as --json", async () => {
    const env = { ...h.deps.env, NORN_HOOK_COMMAND: `${process.execPath} ${main} hook` };
    const r = await runChecked(["doctor"], { ...h.deps, env });
    const json = await runChecked(["doctor", "--json"], { ...h.deps, env });
    // whether every check passes depends on the machine (a CI runner has no `claude`), as above
    const ok = (json.value as { ok: boolean }).ok;
    expect(r.exit).toBe(json.exit);
    expect(r.value).toEqual(json.value);
    expect(r.stdout).toStartWith(ok ? "norn doctor: every check passes\n" : "norn doctor: ");
    expect(r.stdout).toMatch(/(ok {3}|FAIL )agent claude .* · hooks fire/);
    expect(r.stdout).toMatch(/ok {3}remote +gh as tester/);
    expect(r.stdout).toContain("Warnings\n  ! NORN_MACHINE=box");
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  test("missing hooks and an unusable hook command fail the check with what to do", async () => {
    expect((await h.norn("uninstall")).exit).toBe(0);
    const r = await runChecked(["doctor"], { ...h.deps, env: { ...h.deps.env, NORN_HOOK_COMMAND: "norn-missing-binary hook" } });
    expect(r.exit).toBe(1);
    expect(r.value).toMatchObject({
      ok: false,
      agents: [{ name: "claude", ok: false, hooks_installed: false, hook_fires: { ok: false, error: expect.stringContaining("not found on PATH") }, notes: expect.arrayContaining(["run norn init to install hooks"]) }],
    });
    const t = await runChecked(["doctor"], { ...h.deps, env: { ...h.deps.env, NORN_HOOK_COMMAND: "norn-missing-binary hook" } });
    expect(t.exit).toBe(1);
    expect(t.stdout).toMatch(/^norn doctor: \d+ checks? failed \(.*agent claude.*\)/);
    expect(t.stdout).toMatch(/FAIL agent claude .* · hooks missing/);
    expect(t.stdout).toContain("· run norn init to install hooks");
  });
});

describe("norn doctor: a fresh repository", () => {
  let h: Harness;
  const main = join(import.meta.dir, "../src/main.ts");
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("no git remote fails the remote check with the command that adds one", async () => {
    h.git(["remote", "rename", "origin", "upstream"]);
    try {
      const env = { ...h.deps.env, NORN_HOOK_COMMAND: `${process.execPath} ${main} hook` };
      const r = await runChecked(["doctor"], { ...h.deps, env });
      expect(r.exit).toBe(1);
      expect(r.value).toMatchObject({ ok: false, remote: { ok: false, git_remote: { name: "origin", url: null }, do_instead: "git remote add origin <url>" } });
      expect(r.stdout).toMatch(/FAIL remote +gh as tester/);
      expect(r.stdout).toContain("! this repository has no git remote named origin");
      expect(r.stdout).toContain("→ git remote add origin <url>");
    } finally {
      h.git(["remote", "rename", "upstream", "origin"]);
    }
  });

  test("in manual mode an unavailable runner is a warning, not a failed check (MO2)", async () => {
    h.runner.availableResult = false;
    const env = { ...h.deps.env, NORN_HOOK_COMMAND: `${process.execPath} ${main} hook` };
    try {
      // auto mode starts agents through the runner: there it fails the check
      const auto = await runChecked(["doctor"], { ...h.deps, env });
      expect(auto.exit).toBe(1);
      expect(auto.value).toMatchObject({ ok: false, runner: { ok: false, required: true } });
      expect(auto.stdout).toMatch(/FAIL runner +fake not available/);
      h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG.replace("default_mode: auto", "default_mode: manual"));
      const r = await runChecked(["doctor"], { ...h.deps, env });
      const v = r.value as { runner: Record<string, unknown>; agents: Array<{ ok: boolean }> };
      expect(v.runner).toMatchObject({ ok: false, required: false, available: false });
      expect(r.stdout).toMatch(/warn runner +fake not available/);
      expect(r.stdout).toContain("only auto mode needs a runner");
      expect(r.stdout).not.toMatch(/failed \(.*runner/);
    } finally {
      h.runner.availableResult = true;
      h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
    }
  });
});

describe("norn doctor: the cockpit plugin hint (HC11)", () => {
  test("links this checkout's plugins/herdr when norn runs from source, else installs it from GitHub", () => {
    const repo = join(import.meta.dir, "..", "..", "..");
    expect(pluginLinkHint(assetsDir())).toBe(`herdr plugin link ${join(repo, "plugins", "herdr")} (optional: the cockpit of norn status --watch, HC9)`);
    expect(pluginLinkHint("/nowhere/a/b/c")).toBe("herdr plugin install PruszynskiJakub/norn-next/plugins/herdr (optional: the cockpit of norn status --watch, HC9)");
  });
});
