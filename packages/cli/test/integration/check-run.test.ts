/**
 * gh-77: a check step runs in a detached `norn check-run`, not inside the tick (H6, C5, K1).
 * The tick that starts it returns at once; while the command runs, later ticks run (not `busy`),
 * keep the heartbeat fresh (R5.5) and wait on its run lease (`check.running`); the tick after the
 * process ends applies its `check` receipt. A step timeout still kills it as a `fail` with reason `timeout`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CheckOrder, ulid } from "@norn/schema";
import { acquireRunLease, leasesDir, listLeases, listReceipts, repoConfigPath, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { runCheckOrder } from "../../src/runtime/act/check.ts";
import { createHarness, type Harness, installBundledSkills, issue } from "../../../../test/support/harness.ts";

const workflow = (run: string, timeout: string) => `name: slow
start: test
steps:
  test:
    type: check
    run: ${run}
    timeout: ${timeout}
    outcomes: { pass: $done, fail: $stuck }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: slow
default_mode: auto
notifiers: []
watch_interval: 30s
`;

const acts = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => d.kind);
const rules = (r: TickReport) => r.decisions.map((d) => d.rule);

/** A harness whose stories (one per title) sit at a check step running `run`. */
async function atChecks(run: string, timeout: string, titles: string[]): Promise<{ h: Harness; runsDirs: string[] }> {
  const h = await createHarness();
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "slow.yaml"), workflow(run, timeout));
  installBundledSkills(h.root);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = titles.map((t, i) => issue(9 + i, t));
  let started = 0;
  for (let i = 0; i < 10 && started < titles.length; i++) {
    h.clock.advance(10_000);
    started += acts(await h.tick()).filter((k) => k === "start_unit").length;
  }
  if (started < titles.length) throw new Error("stories did not start");
  const runsDirs = titles.map((t, i) => {
    const dir = `gh-${9 + i}-${t.toLowerCase().replaceAll(" ", "-")}`;
    return join(`${h.root}-worktrees`, `${dir}/.agents/specs/${dir}/runs/_story`);
  });
  return { h, runsDirs };
}

async function atCheck(run: string, timeout: string): Promise<{ h: Harness; runsDir: string }> {
  const { h, runsDirs } = await atChecks(run, timeout, ["Slow check"]);
  return { h, runsDir: runsDirs[0]! };
}

const checks = (runsDir: string) => listReceipts(runsDir).receipts.filter((r) => r.receipt.kind === "check").map((r) => r.receipt);

describe("a long check (gh-77)", () => {
  let h: Harness;
  let runsDir: string;
  beforeAll(async () => ({ h, runsDir } = await atCheck('sleep 3 && echo "checked $USER $GH77_SECRET"', "1m")));
  afterAll(() => h.cleanup());

  test("the tick that starts it returns at once; ticks and the heartbeat go on while it runs; the receipt lands after", async () => {
    // an order a dead check-run left behind: its lease is gone, the next check step sweeps it
    const checksDir = join(h.home, "checks");
    const orphan = `${ulid(Date.now())}.json`;
    mkdirSync(checksDir, { recursive: true });
    writeFileSync(join(checksDir, orphan), "{}");
    process.env.GH77_SECRET = "s3cret";
    h.clock.advance(10_000);
    const started = await h.norn("tick"); // not h.tick(): that waits for `norn check-run`
    expect(started.exit).toBe(0);
    const r = started.value as TickReport;
    expect(acts(r)).toEqual(["run_check"]);
    expect(r.duration_ms).toBeLessThan(2500); // the command alone takes 3 s

    // the order holds only what the tick adds (.env.norn, NORN_HOME), never the process env; owner-only
    const orders = readdirSync(checksDir);
    expect(orders).not.toContain(orphan);
    expect(orders).toHaveLength(1);
    const orderFile = join(checksDir, orders[0]!);
    expect(statSync(orderFile).mode & 0o777).toBe(0o600);
    const env = (JSON.parse(readFileSync(orderFile, "utf8")) as { env: Record<string, string> }).env;
    expect(env.NORN_HOME).toBeDefined();
    expect(Object.keys(env)).not.toContain("GH77_SECRET");
    expect(Object.keys(env)).not.toContain("USER");
    expect(Object.keys(env)).not.toContain("PATH");

    // the watch loop's next tick, 3 × watch_interval later: not busy, and the heartbeat is up
    h.clock.advance(100_000);
    const during = await h.norn("tick");
    expect(during.exit).toBe(0);
    expect(rules(during.value as TickReport)).toContain("check.running");
    const inbox = (await h.norn("status", "--json")).value as { groups: { unblock: Array<{ title: string }>; running: Array<{ title: string }> } };
    expect(inbox.groups.unblock.map((i) => i.title)).not.toContainEqual(expect.stringContaining("no heartbeat"));
    expect(inbox.groups.running.map((i) => i.title)).toContain("test #1 (check running)");
    expect((await h.norn("story", "list")).stdout).toContain("test#1 (check running) 1m");
    expect(checks(runsDir)).toEqual([]);
    h.clock.advance(100_000); // past claim.renew (3m): the claim is kept while it runs
    expect(rules((await h.norn("tick")).value as TickReport)).toEqual(expect.arrayContaining(["claim.renew", "check.running"]));
    expect(checks(runsDir)).toEqual([]);

    await h.checksDone();
    expect(checks(runsDir)).toMatchObject([{ outcome: "pass", exit_code: 0, output_tail: "checked tester s3cret", tick_id: r.tick_id }]);
    h.clock.advance(10_000);
    delete process.env.GH77_SECRET;
    expect(acts(await h.tick())).toEqual(["apply_receipts"]);
    expect(h.state(runsDir)).toMatchObject({ status: "done", last_outcome: { step: "test", outcome: "pass" } });
  }, 20_000);
});

describe("two long checks (K1, K3)", () => {
  let h: Harness;
  let runsDirs: string[];
  beforeAll(async () => ({ h, runsDirs } = await atChecks("sleep 3", "1m", ["Slow check", "Other check"])));
  afterAll(() => h.cleanup());

  test("one tick starts both, up to max_checks, and they run at once; a check-run that dies is started again", async () => {
    h.clock.advance(10_000);
    const started = await h.norn("tick");
    const r = started.value as TickReport;
    expect(acts(r)).toEqual(["run_check", "run_check"]);
    expect(r.duration_ms).toBeLessThan(2500);
    const running = (await listLeases(h.home)).live.filter((e) => e.lease.kind === "check");
    expect(running.map((e) => e.lease.story).sort()).toEqual(["gh-10", "gh-9"]);
    expect(readdirSync(join(h.home, "checks"))).toHaveLength(2);

    // K3: the first one dies (crash, reboot): its lease is dead, the next tick starts its check again
    const dead = running.find((e) => e.lease.story === "gh-9")!;
    process.kill(-dead.lease.holder.pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
    h.clock.advance(10_000);
    const again = await h.tick(); // waits for every check-run this tick started and the ones before
    expect(acts(again)).toEqual(["reclaim_leases", "run_check"]);
    expect(again.decisions.filter((d) => d.kind !== "reclaim_leases").map((d) => [d.unit, d.rule])).toEqual([["gh-10", "check.running"], ["gh-9", "check.run"]]);
    expect(checks(runsDirs[0]!)).toMatchObject([{ outcome: "pass" }]);
    expect(checks(runsDirs[1]!)).toMatchObject([{ outcome: "pass" }]);
  }, 30_000);
});

describe("a check past its step timeout (C5)", () => {
  let h: Harness;
  let runsDir: string;
  beforeAll(async () => ({ h, runsDir } = await atCheck("sleep 30", "1s")));
  afterAll(() => h.cleanup());

  test("norn check-run kills it and writes a fail with reason timeout", async () => {
    h.clock.advance(10_000);
    expect(acts(await h.tick())).toEqual(["run_check"]);
    expect(checks(runsDir)).toMatchObject([{ outcome: "fail", exit_code: null, reason: "timeout" }]);
  }, 20_000);
});

describe("a check-run that fails on its own side (C5)", () => {
  test("still writes a fail receipt with the error, so the step ends instead of rerunning", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-check-run-")));
    try {
      const runsDir = join(dir, "runs");
      mkdirSync(runsDir);
      writeFileSync(join(runsDir, "logs"), "not a dir"); // writeLog cannot write the failing check's log
      const t = Date.parse("2026-01-01T00:00:00Z");
      const order: CheckOrder = {
        version: 1,
        home: join(dir, "home"),
        lease_file: "check-1.json",
        runs_dir: runsDir,
        run_id: ulid(t),
        step: "test",
        attempt: 1,
        tick_id: ulid(t + 1),
        who: "tester@box",
        command: "echo nope; exit 1",
        cwd: dir,
        env: { NORN_HOME: dir },
        timeout_ms: 10_000,
        ports: null,
      };
      const r = await runCheckOrder(order, () => t);
      expect(r).toMatchObject({ outcome: "fail", run_id: order.run_id });
      expect(checks(runsDir)).toMatchObject([{ outcome: "fail", run_id: order.run_id, output_tail: expect.stringContaining("norn check-run failed") }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a check-run the tick could not identify (K1, K3)", () => {
  test("takes its run's lease over itself while it runs, and releases it after", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-check-run-")));
    try {
      const home = join(dir, "home");
      const runsDir = join(dir, "runs");
      mkdirSync(runsDir);
      const t = Date.parse("2026-01-01T00:00:00Z");
      const runId = ulid(t);
      const tickHolder = { pid: 999_999, pid_start: "the tick" };
      const lease = await acquireRunLease(home, "check", 1, { repo: dir, story: "gh-9", slice: null, run_id: runId, holder: tickHolder, liveness: () => true });
      if (!lease.ok) throw new Error("no lease");
      const order: CheckOrder = {
        version: 1,
        home,
        lease_file: lease.entry.file,
        runs_dir: runsDir,
        run_id: runId,
        step: "test",
        attempt: 1,
        tick_id: ulid(t + 1),
        who: "tester@box",
        command: `cat "${join(leasesDir(home), lease.entry.file)}"; exit 1`,
        cwd: dir,
        env: { NORN_HOME: dir },
        timeout_ms: 10_000,
        ports: null,
      };
      const r = await runCheckOrder(order, () => t);
      expect(JSON.parse(r.output_tail).holder).toMatchObject({ pid: process.pid });
      expect((await listLeases(home, () => true)).live).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
