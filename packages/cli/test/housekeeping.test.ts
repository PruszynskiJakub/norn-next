/**
 * Housekeeping and machine checks: agent leases outlive the launching tick so max_agents holds
 * across ticks (K1, K3), orphans reported by every tick and cleaned by `norn tidy` (K5), the
 * GR6 record on the base branch, and `norn doctor` (A7).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { git as gitAdapter } from "@norn/adapters";
import { type StoryFrontmatter, ulid } from "@norn/schema";
import { appendReceipt, leasesDir, readState, safeUnlink, writeStoryFile } from "@norn/store";
import { pluginLinkHint } from "../src/commands/doctor.ts";
import { assetsDir } from "../src/runtime/assets.ts";
import { markStoryOnBase } from "../src/runtime/record.ts";
import { type TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue, T0 } from "./harness.ts";
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

  test("deferred while the spec file is not on the base branch", async () => {
    expect(await markStoryOnBase(opts(h))).toMatchObject({ state: "deferred" });
  });

  test("after the merge: committed in a throwaway worktree and pushed to the base branch; main checkout untouched (story.md an older norn wrote, GR2)", async () => {
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

  test("GR2: a story intaken as spec.md is marked done in spec.md", async () => {
    const other = join(h.dir, "merger-spec");
    h.git(["clone", "-q", h.remoteDir, other], h.dir);
    writeStoryFile(join(other, ".agents/specs/gh-6-merged/spec.md"), { ...fm, id: "gh-6", number: 6 }, "\nspec\n");
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "add", "-A"], other);
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "commit", "-q", "-m", "merge story"], other);
    h.git(["push", "-q", "origin", "main"], other);

    const r = await markStoryOnBase({ ...opts(h), spec_dir: ".agents/specs/gh-6-merged", story: "gh-6" });
    expect(r).toMatchObject({ state: "pushed", branch: "main" });
    expect(h.git(["show", "origin/main:.agents/specs/gh-6-merged/spec.md"])).toContain("status: done");
    expect(h.git(["ls-tree", "--name-only", "origin/main", ".agents/specs/gh-6-merged/"])).not.toContain("story.md");
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

describe("trace retention: norn tidy prunes day pairs older than trace.retain (B23–B27, B31–B34)", () => {
  let h: Harness;
  const DAY = 86_400_000;
  const trace = () => join(h.root, ".agents/norn/trace");
  const dayOf = (age: number) => new Date(h.clock.now() - age * DAY).toISOString().slice(0, 10);
  /** Day files (and chunks files where `chunks`) `ages` days ago, each `size` bytes of blank lines the readers skip. */
  const stage = (ages: number[], opts: { chunks?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 100;
    const body = `${" ".repeat(size - 1)}\n`;
    for (const a of ages) {
      h.write(join(trace(), `${dayOf(a)}.jsonl`), body);
      if (opts.chunks) h.write(join(trace(), `${dayOf(a)}.chunks.jsonl`), body);
    }
  };
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  /** Ages (days before the fake now) of the day files left, youngest first. */
  const ages = () =>
    readdirSync(trace())
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .map((n) => Math.round((Date.parse(dayOf(0)) - Date.parse(n.slice(0, 10))) / DAY))
      .sort((a, b) => a - b);
  const chunkFiles = () => readdirSync(trace()).filter((n) => n.endsWith(".chunks.jsonl"));
  const clear = () => {
    mkdirSync(trace(), { recursive: true });
    for (const n of readdirSync(trace())) if (/^\d{4}-\d{2}-\d{2}(\.chunks)?\.jsonl$/.test(n)) safeUnlink(join(trace(), n));
  };
  const setRetain = (retain: string | null) => {
    const user = join(h.home, "config.yaml");
    h.write(user, retain === null ? "" : `trace: { retain: ${retain} }\n`);
  };
  type Tidy = { trace: { retain: string; days: Array<{ day: string; files: string[]; bytes: number }>; hook_files: unknown[]; runs: unknown[]; bytes: number } };

  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("no trace.retain: tidy deletes the 26 oldest of 41 day pairs and keeps the last 14 days and trace/workflows (B23, B27)", async () => {
    setRetain(null);
    clear();
    stage(range(0, 40), { chunks: true });
    h.write(join(trace(), "workflows/abc.yaml"), "name: old\n");
    const r = await h.norn("tidy");
    expect(r.exit).toBe(0);
    const v = r.value as Tidy;
    expect(v.trace.retain).toBe("14d");
    expect(v.trace.days).toHaveLength(26);
    expect(v.trace.days[0]).toEqual({ day: dayOf(40), files: [`${dayOf(40)}.chunks.jsonl`, `${dayOf(40)}.jsonl`], bytes: 200 });
    expect(v.trace.bytes).toBe(26 * 200);
    expect(ages()).toEqual(range(0, 14));
    expect(chunkFiles()).toHaveLength(15);
    expect(existsSync(join(trace(), "workflows/abc.yaml"))).toBe(true);
  });

  test("trace.retain: 30d prunes only what is older than 30 days (B23)", async () => {
    setRetain("30d");
    clear();
    stage(range(0, 40));
    const r = await h.norn("tidy");
    expect(r.exit).toBe(0);
    expect((r.value as Tidy).trace.retain).toBe("30d");
    expect(ages()).toEqual(range(0, 30));
  });

  test("--retain overrides trace.retain for that run (B24)", async () => {
    setRetain("14d");
    clear();
    stage(range(0, 40));
    const r = await h.norn("tidy", "--retain", "30d");
    expect(r.exit).toBe(0);
    expect((r.value as Tidy).trace.retain).toBe("30d");
    expect(ages()).toEqual(range(0, 30));
  });

  test("a window under 14d, from the flag or the config, is refused and nothing is deleted; doctor warns, config still loads (B25)", async () => {
    setRetain(null);
    clear();
    stage(range(0, 40));
    const flag = await h.norn("tidy", "--retain", "7d", "--json");
    expect(flag.exit).toBe(3);
    expect(flag.value).toMatchObject({ error: expect.stringContaining("the trace window must be at least 14d"), do_instead: expect.stringContaining("14d") });
    expect(ages()).toEqual(range(0, 40));

    setRetain("7d");
    const cfg = await h.norn("tidy", "--json");
    expect(cfg.exit).toBe(3);
    expect(cfg.value).toMatchObject({ error: expect.stringContaining("the trace window must be at least 14d"), do_instead: expect.stringContaining("14d") });
    expect(ages()).toEqual(range(0, 40));
    expect((await h.norn("config", "get", "trace", "--json")).exit).toBe(0);
    const doc = await h.norn("doctor", "--json");
    expect((doc.value as { warnings: string[] }).warnings).toEqual(expect.arrayContaining([expect.stringContaining("trace.retain 7d")]));
    expect((doc.value as { warnings: string[] }).warnings.find((w) => w.includes("trace.retain"))).toContain("14d");
    setRetain(null);
  });

  test("a value that is not a duration is refused naming the expected form, nothing deleted (B26)", async () => {
    setRetain(null);
    clear();
    stage(range(0, 40));
    const flag = await h.norn("tidy", "--retain", "soon", "--json");
    expect(flag.exit).toBe(2);
    expect(flag.value).toMatchObject({ error: expect.stringContaining("soon"), do_instead: expect.stringContaining("14d") });
    setRetain("soon");
    const cfg = await h.norn("tidy", "--json");
    expect(cfg.exit).toBe(3);
    expect(cfg.value).toMatchObject({ error: expect.stringContaining("soon"), do_instead: expect.stringContaining("14d") });
    expect(ages()).toEqual(range(0, 40));
    setRetain(null);
  });

  test("--dry-run lists each day pair with its bytes and the total, and deletes nothing (B31)", async () => {
    setRetain(null);
    clear();
    stage(range(0, 16), { chunks: true, size: 300 });
    stage([20], { size: 50 });
    const r = await h.norn("tidy", "--dry-run");
    expect(r.exit).toBe(0);
    expect((r.value as Tidy).trace).toEqual({
      retain: "14d",
      days: [
        { day: dayOf(20), files: [`${dayOf(20)}.jsonl`], bytes: 50 },
        { day: dayOf(16), files: [`${dayOf(16)}.chunks.jsonl`, `${dayOf(16)}.jsonl`], bytes: 600 },
        { day: dayOf(15), files: [`${dayOf(15)}.chunks.jsonl`, `${dayOf(15)}.jsonl`], bytes: 600 },
      ],
      hook_files: [],
      runs: [],
      bytes: 1250,
    });
    expect(ages()).toEqual([...range(0, 16), 20]);
    expect(chunkFiles()).toHaveLength(17);
  });

  test("a second tidy prunes nothing from the trace (B32)", async () => {
    setRetain(null);
    clear();
    stage(range(0, 40));
    expect(((await h.norn("tidy")).value as Tidy).trace.days).toHaveLength(26);
    const again = await h.norn("tidy");
    expect(again.exit).toBe(0);
    expect((again.value as Tidy).trace).toEqual({ retain: "14d", days: [], hook_files: [], runs: [], bytes: 0 });
  });

  test("doctor hints, without failing a check, how many days and bytes lie beyond the window; none within it (B33)", async () => {
    setRetain("14d");
    clear();
    stage(range(0, 44), { size: 1000 });
    const r = await h.norn("doctor", "--json");
    const v = r.value as { hints: string[]; warnings: string[] };
    expect(v.hints).toEqual([expect.stringMatching(/^trace keeps 30 days \(30\.0 KB\) beyond trace\.retain 14d — run `norn tidy`/)]);
    expect(v.warnings.join("\n")).not.toContain("norn tidy");
    const md = await h.norn("doctor");
    expect(md.exit).toBe(r.exit);
    expect(md.stdout).toContain("trace keeps 30 days (30.0 KB) beyond trace.retain 14d — run `norn tidy`");
    // whether every other check passes depends on the machine; the hint never fails one
    const ok = (await h.norn("doctor", "--json")).value as { ok: boolean };
    await h.norn("tidy");
    const after = await h.norn("doctor", "--json");
    expect((after.value as { hints: string[] }).hints).toEqual([]);
    expect((after.value as { ok: boolean }).ok).toBe(ok.ok);
  });

  test("ticks over 30 fake-clock days never delete a day file; only tidy prunes (B34)", async () => {
    setRetain(null);
    clear();
    stage(range(20, 40));
    const before = readdirSync(trace()).filter((n) => n.endsWith(".jsonl")).sort();
    for (let d = 0; d < 30; d += 5) {
      h.clock.advance(5 * DAY);
      await h.tick("--offline");
    }
    const after = readdirSync(trace()).filter((n) => n.endsWith(".jsonl"));
    for (const f of before) expect(after).toContain(f);
  });
});

describe("trace retention: norn tidy prunes old hook files, briefings and transcripts, never a live run's (B28–B32)", () => {
  let h: Harness;
  let liveRun: string;
  const DAY = 86_400_000;
  const trace = () => join(h.root, ".agents/norn/trace");
  const OLD = ulid(T0 - 20 * DAY);
  const RECENT = ulid(T0 - DAY);
  /** A trace file `age` days old (by the fake clock), `text` its content. */
  const put = (rel: string, age: number, text = "x\n") => {
    const file = join(trace(), rel);
    h.write(file, text);
    const at = new Date(h.clock.now() - age * DAY);
    utimesSync(file, at, at);
  };
  /** Every file under the trace dir with its size and mtime, sorted. */
  const listing = () =>
    (readdirSync(trace(), { recursive: true }) as string[])
      .filter((n) => statSync(join(trace(), n)).isFile())
      .sort()
      .map((n) => ({ n, size: statSync(join(trace(), n)).size, mtime: statSync(join(trace(), n)).mtimeMs }));
  const exists = (rel: string) => existsSync(join(trace(), rel));
  /** gh-3 merged 30 days ago, gh-4 touched two days ago, gh-9 live since 20 days ago; runs that ended 20 days ago and yesterday. */
  const stage = () => {
    for (const d of ["hooks", "briefings", "transcripts"]) rmSync(join(trace(), d), { recursive: true, force: true });
    for (const n of readdirSync(trace())) if (/^\d{4}-\d{2}-\d{2}(\.chunks)?\.jsonl$/.test(n)) safeUnlink(join(trace(), n)); // the ticks' day pairs, pruned by 08's tests
    put("hooks/gh-3/_story.jsonl", 30, "a".repeat(40));
    put("hooks/gh-3/01.jsonl", 30, "b".repeat(10));
    put("hooks/gh-4/_story.jsonl", 2);
    put("hooks/gh-9/_story.jsonl", 20);
    put(`briefings/${OLD}/01.md`, 20, "c".repeat(30));
    put(`transcripts/${OLD}/01.txt`, 20, "d".repeat(20));
    put(`briefings/${RECENT}/01.md`, 1);
    put(`transcripts/${RECENT}/01.txt`, 1);
    put(`briefings/${liveRun}/01.md`, 20);
    put(`transcripts/${liveRun}/01.txt`, 20);
    put("workflows/abc.yaml", 60, "name: old\n");
    put("backfill.json", 60, "{}\n");
    put("integrate-gh-3.lock", 60, "{}\n");
  };
  type Pruned = { unit: string; file: string; bytes: number };
  type RunPruned = { run_id: string; files: string[]; bytes: number };
  type Tidy = { trace: { retain: string; days: unknown[]; hook_files: Pruned[]; runs: RunPruned[]; bytes: number } };
  const HOOKS: Pruned[] = [
    { unit: "gh-3/01", file: "hooks/gh-3/01.jsonl", bytes: 10 },
    { unit: "gh-3", file: "hooks/gh-3/_story.jsonl", bytes: 40 },
  ];
  const RUNS: RunPruned[] = [{ run_id: OLD, files: [`briefings/${OLD}`, `transcripts/${OLD}`], bytes: 50 }];

  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
    h.remote.issues = [issue(9, "Ninth")];
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    const st = readState(join(`${h.root}-worktrees/gh-9-ninth`, ".agents/specs/gh-9-ninth/runs/_story"));
    if (!st.ok || st.value.status !== "running" || !st.value.run) throw new Error("gh-9 has no live run");
    liveRun = st.value.run.run_id;
    h.clock.advance(20 * DAY); // the live run started 20 days ago
  });
  afterAll(() => h.cleanup());

  test("the hook files of units with no live run and no change within the window are deleted; a live unit's are kept (B28)", async () => {
    stage();
    const r = await h.norn("tidy");
    expect(r.exit).toBe(0);
    expect((r.value as Tidy).trace.hook_files).toEqual(HOOKS);
    expect(exists("hooks/gh-3")).toBe(false);
    expect(exists("hooks/gh-9/_story.jsonl")).toBe(true);
    expect(exists("hooks/gh-4/_story.jsonl")).toBe(true);
  });

  test("the briefings and transcripts of a run that ended 20 days ago are deleted, yesterday's kept (B29)", async () => {
    stage();
    const r = await h.norn("tidy");
    expect(r.exit).toBe(0);
    expect((r.value as Tidy).trace.runs).toEqual(RUNS);
    expect(exists(`briefings/${OLD}`)).toBe(false);
    expect(exists(`transcripts/${OLD}`)).toBe(false);
    expect(exists(`briefings/${RECENT}/01.md`)).toBe(true);
    expect(exists(`transcripts/${RECENT}/01.txt`)).toBe(true);
  });

  test("a live run 20 days old keeps its hook file, briefings and transcripts; workflows, backfill.json, caches and locks are untouched (B30)", async () => {
    stage();
    const kept = ["hooks/gh-9/_story.jsonl", `briefings/${liveRun}/01.md`, `transcripts/${liveRun}/01.txt`, "workflows/abc.yaml", "backfill.json", "integrate-gh-3.lock"];
    const before = listing().filter((f) => kept.includes(f.n));
    expect(before.map((f) => f.n)).toEqual(expect.arrayContaining(kept));
    expect((await h.norn("tidy")).exit).toBe(0);
    const after = listing();
    for (const f of before) expect(after).toContainEqual(f);
  });

  test("--dry-run lists the hook files and runs with their bytes and deletes nothing; a second tidy prunes nothing (B31, B32)", async () => {
    stage();
    // observe refreshes the caches (base.json, remote.json); the prunable parts must not change
    const prunable = () => listing().filter((f) => /^(hooks|briefings|transcripts)\//.test(f.n));
    const before = prunable();
    const dry = await h.norn("tidy", "--dry-run");
    expect(dry.exit).toBe(0);
    expect((dry.value as Tidy).trace).toEqual({ retain: "14d", days: [], hook_files: HOOKS, runs: RUNS, bytes: 100 });
    expect(prunable()).toEqual(before);
    expect(((await h.norn("tidy")).value as Tidy).trace.bytes).toBe(100);
    const again = await h.norn("tidy");
    expect(again.exit).toBe(0);
    expect((again.value as Tidy).trace).toEqual({ retain: "14d", days: [], hook_files: [], runs: [], bytes: 0 });
  });
});
