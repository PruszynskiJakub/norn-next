/**
 * The checkout's machine-local files live in `<norn home>/repos/<folder>-<hash8>/` (B5, B6, D1–D3):
 * trace, locks, heartbeat and caches, shared by every unit worktree, never in the working tree or
 * `.git`; `norn doctor` warns about a machine dir orphaned by a moved repo folder.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { acquireTickLock, leasesDir, listLeases, repoConfigPath, unbindNornHome, userConfigPath, workflowsDir } from "@norn/store";
import { type CliResult } from "../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh } from "./harness.ts";

// whole flows over real git, several ticks each
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
default_mode: manual
notifiers: []
`;

/** D2, computed here independently: `<folder>-<first 8 hex of sha256(real path of the git common dir)>`. */
function machineDirOf(home: string, checkout: string): string {
  const common = realpathSync(resolve(checkout, sh(checkout, ["rev-parse", "--git-common-dir"]).trim()));
  const hash = createHash("sha256").update(common).digest("hex").slice(0, 8);
  // the main checkout's folder name, from a unit worktree too
  return join(home, "repos", `${basename(dirname(common))}-${hash}`);
}

/** Where the machine-local files lived before B5: `.agents/norn/trace/`. */
const oldTraceDir = (root: string) => join(dirname(workflowsDir(root)), "trace");

async function boot(h: Harness) {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
}

/** Every path under `dir` (outside `.git/objects`) named like a file the machine dir holds, or a trace day file. */
function machineFilesUnder(dir: string, machine: string): string[] {
  const files = readdirSync(machine, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  const names = new Set(files.map((e) => e.name));
  for (const n of ["tick.lock", "failures.json", "notices.json", "pr.json", "remote.json", "inbox.json", "heartbeat.json", "checkout.json"]) names.add(n);
  return (readdirSync(dir, { recursive: true }) as string[]).filter((p) => !p.startsWith(`.git${"/"}objects`) && (names.has(basename(p)) || p.endsWith(".jsonl")));
}

describe("machine-local files in the norn home (B5, B6)", () => {
  let h: Harness;
  let machine: string;
  const wt = () => `${h.root}-worktrees/gh-4-four`;
  beforeAll(async () => {
    h = await createHarness();
    // B6: what the home already holds before norn uses repos/
    mkdirSync(h.home, { recursive: true });
    writeFileSync(userConfigPath(h.home), "max_agents: 3\n");
    await boot(h);
    h.remote.issues = [issue(4, "Four")];
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    machine = machineDirOf(h.home, h.root);
  });
  afterAll(() => h.cleanup());

  test("after init and a tick: trace, heartbeat and caches under repos/<folder>-<hash8>/ with checkout.json; none in the tree or .git (AC1)", () => {
    const files = readdirSync(machine);
    expect(files.some((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))).toBe(true);
    expect(files).toContain("heartbeat.json");
    expect(files).toContain("remote.json");
    expect(JSON.parse(readFileSync(join(machine, "checkout.json"), "utf8"))).toMatchObject({ checkout: h.root });
    expect(machineFilesUnder(h.root, machine)).toEqual([]);
    expect(existsSync(oldTraceDir(h.root))).toBe(false);
    expect(h.git(["status", "--porcelain"])).toBe("");
    const ignore = h.read(join(h.root, ".gitignore")).split("\n");
    expect(ignore).toContain(".env.norn");
    expect(ignore).toContain(".norn-unit");
    expect(ignore.filter((l) => l.includes("trace"))).toEqual([]);
  });

  test("the tick lock is taken in the machine dir (AC1)", async () => {
    const lock = await acquireTickLock(h.root, { note: "test", now: () => new Date().toISOString() });
    if (!lock.ok) throw new Error("tick lock held");
    try {
      expect(existsSync(join(machine, "tick.lock"))).toBe(true);
      const r = await h.norn("tick", "--json");
      expect(r.value).toMatchObject({ code: "tick_locked" });
    } finally {
      lock.release();
    }
  });

  test("a unit worktree uses the main checkout's machine dir and writes nothing machine-local of its own; one heartbeat id (AC2)", async () => {
    expect(existsSync(wt())).toBe(true);
    const heartbeat = JSON.parse(readFileSync(join(machine, "heartbeat.json"), "utf8")).heartbeat_id;
    const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
    for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
    const inWt = (argv: string[], stdin?: string): Promise<CliResult> => runChecked(argv, { ...h.deps, cwd: wt(), env, ...(stdin ? { stdin } : {}) });
    // hook is repo: false: drop the binding earlier commands in this process left, so only its own can find the home
    unbindNornHome(wt());
    expect((await inWt(["hook", "session-start"], JSON.stringify({ session_id: "s1-ac2", cwd: wt(), hook_event_name: "SessionStart" }))).exit).toBe(0);
    const brief = await inWt(["brief", "--json"]);
    expect(brief.exit).toBe(0);
    expect((await runChecked(["tick", "--json"], { ...h.deps, cwd: wt() })).exit).toBe(0);
    expect(machineDirOf(h.home, wt())).toBe(machine);
    expect(machineFilesUnder(wt(), machine)).toEqual([]);
    expect(existsSync(oldTraceDir(wt()))).toBe(false);
    // the hook was traced into the main checkout's machine dir
    const events = readdirSync(machine)
      .filter((f) => f.endsWith(".jsonl"))
      .flatMap((f) => readFileSync(join(machine, f), "utf8").split("\n").filter(Boolean))
      .map((l) => JSON.parse(l) as { type: string; fact?: { agent_session_id?: string } });
    expect(events.some((e) => e.type === "hook" && e.fact?.agent_session_id === "s1-ac2")).toBe(true);
    expect(JSON.parse(readFileSync(join(machine, "heartbeat.json"), "utf8")).heartbeat_id).toBe(heartbeat);
    expect(readdirSync(join(h.home, "repos"))).toEqual([basename(machine)]);
  });

  test("the user config and machine leases stay where they were and are read as before; only repos/ is added (AC4)", async () => {
    const cfg = await h.norn("config", "list", "--json");
    expect(JSON.stringify(cfg.value)).toContain(userConfigPath(h.home));
    expect(readFileSync(userConfigPath(h.home), "utf8")).toBe("max_agents: 3\n");
    // the gh-4 worktree's slot lease, read back from the home's leases dir
    const leases = await listLeases(h.home, () => true);
    expect(leases.live.some((e) => e.lease.kind === "slot" && e.lease.worktree === wt())).toBe(true);
    expect(readdirSync(leasesDir(h.home)).length).toBeGreaterThan(0);
    const top = readdirSync(h.home);
    expect(top).toContain("repos");
    expect(top).toContain("config.yaml");
    expect(top).toContain("leases");
    expect(top.filter((n) => n.endsWith(".jsonl") || n === "heartbeat.json")).toEqual([]);
  });
});

describe("two clones of one remote (AC3)", () => {
  let h: Harness;
  let other: string;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
    other = join(h.dir, "clone2", basename(h.root));
    mkdirSync(join(h.dir, "clone2"));
    sh(h.dir, ["clone", "-q", h.remoteDir, other]);
  });
  afterAll(() => h.cleanup());

  test("each clone gets its own machine dir and its own heartbeat id", async () => {
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    expect((await runChecked(["tick", "--json"], { ...h.deps, cwd: other })).exit).toBe(0);
    const a = machineDirOf(h.home, h.root);
    const b = machineDirOf(h.home, other);
    expect(a).not.toBe(b);
    expect(basename(a).startsWith(`${basename(h.root)}-`)).toBe(true);
    expect(basename(b).startsWith(`${basename(h.root)}-`)).toBe(true);
    const id = (dir: string) => JSON.parse(readFileSync(join(dir, "heartbeat.json"), "utf8")).heartbeat_id;
    expect(id(a)).toMatch(/^[0-9A-Z]{26}$/);
    expect(id(b)).toMatch(/^[0-9A-Z]{26}$/);
    expect(id(a)).not.toBe(id(b));
  });
});

describe("norn doctor: an orphaned machine dir (AC5, D3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
    h.clock.advance(10_000);
    await h.tick();
  });
  afterAll(() => h.cleanup());

  test("a machine dir whose checkout.json names a vanished path with this folder name: warned, with the command that adopts it; nothing moved until it runs", async () => {
    const mine = machineDirOf(h.home, h.root);
    const gone = join(h.dir, "old place", basename(h.root));
    const orphan = join(h.home, "repos", `${basename(h.root)}-0badc0de`);
    const adopted = "01J00000000000000000000000";
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, "checkout.json"), JSON.stringify({ checkout: gone }));
    writeFileSync(join(orphan, "heartbeat.json"), JSON.stringify({ heartbeat_id: adopted }));
    // another repo's dir, and a same-named dir whose checkout still exists, are no orphans of this one
    const unrelated = join(h.home, "repos", "other-12345678");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "checkout.json"), JSON.stringify({ checkout: join(h.dir, "nowhere", "other") }));
    const alive = join(h.dir, "elsewhere", basename(h.root));
    mkdirSync(alive, { recursive: true });
    const sibling = join(h.home, "repos", `${basename(h.root)}-abcdef12`);
    mkdirSync(sibling);
    writeFileSync(join(sibling, "checkout.json"), JSON.stringify({ checkout: alive }));

    const r = await runChecked(["doctor", "--json"], h.deps);
    const warnings = (r.value as { warnings: string[] }).warnings.filter((w) => w.includes("orphan"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(gone);
    const adopt = /: (rm -rf .+)$/.exec(warnings[0] ?? "")?.[1] ?? "";
    expect(adopt).toContain(orphan);
    const text = await runChecked(["doctor"], h.deps);
    expect(text.stdout).toContain(adopt);
    expect(existsSync(join(orphan, "heartbeat.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(mine, "heartbeat.json"), "utf8")).heartbeat_id).not.toBe(adopted);

    // running the printed command adopts the dir: the next tick keeps its heartbeat and names this checkout
    expect(Bun.spawnSync(["sh", "-c", adopt]).exitCode).toBe(0);
    expect(existsSync(orphan)).toBe(false);
    h.clock.advance(10_000);
    await h.tick();
    expect(JSON.parse(readFileSync(join(mine, "heartbeat.json"), "utf8")).heartbeat_id).toBe(adopted);
    expect(JSON.parse(readFileSync(join(mine, "checkout.json"), "utf8"))).toEqual({ checkout: h.root });
    expect(readdirSync(mine)).not.toContain(basename(orphan));
  });
});
