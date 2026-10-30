/**
 * Runtime paths beyond the happy flow: repo discovery from a worktree (A3), throttled sync (H5),
 * silent → nudge into the same session (C1, B2), died → fresh session (C1), watch releasing
 * claims on a clean exit (T6), PR merged cleanup (GR6), uninstall, and check timeouts (C5).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NUDGE_TEXT } from "@norn/core";
import { ulid } from "@norn/schema";
import { appendReceipt, appendTrace, readTrace } from "@norn/store";
import { humanSummary, humanTickLines } from "../src/commands/watch.ts";
import { runShell, type TickReport } from "../src/index.ts";
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
    nudges: 1
    retries: 1
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn, sync_interval: 5m }
default_workflow: solo
default_mode: auto
`;

const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);

async function boot(h: Harness, n: number, title: string) {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(n, title)];
}

describe("runtime", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-9-fix-the-bug`;
  const runs = () => join(wt(), ".agents/specs/gh-9-fix-the-bug/runs/_story");
  beforeAll(async () => {
    h = await createHarness();
    await boot(h, 9, "Fix the bug");
  });
  afterAll(() => h.cleanup());

  test("remote calls are throttled (H5); `norn sync` forces one", async () => {
    expect(acted(await h.tick())).toEqual(["gh-9 intake_story"]);
    const calls = h.remote.calls.length;
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.sync.ran).toBe(false);
    expect(h.remote.calls.length).toBe(calls);
    h.clock.advance(10_000);
    const s = await h.norn("sync");
    expect(s.exit).toBe(0);
    expect((s.value as TickReport).sync).toEqual({ ran: true, ok: true });
    expect(h.remote.calls.length).toBeGreaterThan(calls);
  });

  test("commands work from inside a unit worktree (A3 marker → main checkout)", async () => {
    h.clock.advance(10_000);
    const r = await runChecked(["tick", "--offline"], { ...h.deps, cwd: join(wt(), ".agents") });
    expect(r.exit).toBe(0);
    expect(acted(r.value as TickReport).length).toBeGreaterThanOrEqual(0);
    expect(h.state(runs())).toMatchObject({ step: "implement" });
  });

  test("outside a repository the command refuses with do_instead (§9.3)", async () => {
    const away = realpathSync(mkdtempSync(join(tmpdir(), "norn-away-")));
    const r = await runChecked(["tick"], { ...h.deps, cwd: away });
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "not_in_repo", do_instead: expect.any(String) });
  });

  test("turn ended without a receipt → silent → nudge into the same session (C1, B2)", async () => {
    for (let i = 0; i < 3 && h.state(runs())?.status !== "running"; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    expect(h.state(runs())?.status).toBe("running");
    h.clock.advance(10_000);
    await h.tick(); // recovery commit of runs/ after the launch
    const st = h.state(runs());
    h.clock.advance(10_000);
    appendTrace(h.root, { type: "hook", id: ulid(h.clock.now()), fact: { event: "turn_end", at: h.clock.iso(), agent: "claude", native: "Stop", cwd: wt(), story: "gh-9", run_id: st?.run?.run_id as string } });
    h.clock.advance(1000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 nudge"]);
    expect(h.runner.sent).toEqual([{ session: { runner: "fake", session_id: "s-1", pane_id: "p-1" }, text: NUDGE_TEXT }]);
    expect(h.state(runs())).toMatchObject({ status: "running", nudges_used: 1 });
    expect(readdirSync(join(runs(), "receipts")).some((f) => f.endsWith("-classify.json"))).toBe(true);
  });

  test("pane gone → died → old session killed, fresh session launched (C1)", async () => {
    h.runner.pane = { alive: false, state: "unknown", since: null };
    h.clock.advance(10_000);
    const r = await h.tick();
    h.runner.pane = { alive: true, state: "working", since: null };
    expect(acted(r)).toEqual(["gh-9 retry_fresh"]);
    expect(h.runner.killed.map((s) => s.session_id)).toEqual(["s-1"]);
    expect(h.runner.launches).toHaveLength(2);
    expect(h.state(runs())).toMatchObject({ status: "running", retries_used: 1, run: { session: { session_id: "s-2" } } });
  });

  test("a stale receipt is rejected into the trace (T9); done → $done, waiting for the PR merge (GR6)", async () => {
    const st = h.state(runs());
    appendReceipt(runs(), { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st?.run?.run_id ?? null, step: "implement", attempt: 7, at: h.clock.iso(), by: "agent", outcome: "done", handoff: "old" });
    h.report(runs(), "done", { outcome: "done", handoff: "fixed" });
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 apply_receipts"]);
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    const rejects = readTrace(h.root, { types: ["reject"], unit: "gh-9" }).events;
    expect(rejects).toMatchObject([{ type: "reject", unit: "gh-9", reason: "stale: receipt for implement#7, cursor at implement#1" }]);
  });

  test("a receipt failing validation marks the unit corrupt and notifies once (S2, O3)", async () => {
    h.write(join(runs(), "receipts", "0042-done.json"), "{ not json");
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 mark_corrupt"]);
    expect(h.state(runs())).toMatchObject({ status: "corrupt", park: { kind: "corrupt" } });
    expect(h.notifier.items.filter((i) => i.id.startsWith("corrupt:gh-9"))).toHaveLength(1);
    h.clock.advance(10_000);
    await h.tick();
    expect(h.notifier.items.filter((i) => i.id.startsWith("corrupt:gh-9"))).toHaveLength(1);
    rmSync(join(runs(), "receipts", "0042-done.json"));
  });

  test("PR merged → worktree, branches, claim ref and slot removed (GR6)", async () => {
    h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-9-fix-the-bug", base_branch: "main", merged_at: h.clock.iso() }];
    h.clock.advance(10_000);
    const s = await h.norn("sync");
    expect(acted(s.value as TickReport)).toEqual(["gh-9 cleanup_merged_story"]);
    expect(existsSync(wt())).toBe(false);
    expect(h.git(["branch", "--list", "gh-9-fix-the-bug"])).toBe("");
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-9"])).toBe("");
    expect(readdirSync(join(h.home, "leases")).filter((f) => f.startsWith("slot-"))).toEqual([]);
  });

  test("uninstall removes norn-owned hooks and skills, keeps config", async () => {
    const r = await h.norn("uninstall");
    expect(r.exit).toBe(0);
    expect((r.value as { skills_removed: string[] }).skills_removed).toContain(join(h.root, ".agents/skills/norn-implement"));
    expect(existsSync(join(h.root, ".claude/skills/norn"))).toBe(false);
    expect(existsSync(join(h.root, ".agents/skills"))).toBe(false);
    expect(h.read(join(h.root, ".claude/settings.json"))).not.toContain("norn-owned");
    expect(existsSync(join(h.root, ".agents/norn/config.yaml"))).toBe(true);
  });
});

describe("watch", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h, 11, "Watch me");
  });
  afterAll(() => h.cleanup());

  test("loops ticks and releases held claims on a clean exit (T6)", async () => {
    await h.tick(); // intake
    h.clock.advance(1000);
    await h.tick(); // claim
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-11"])).not.toBe("");
    const lines: string[] = [];
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "2"], { ...h.deps, log: (l) => lines.push(l) });
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ticks: 2, released: [{ story: "gh-11", ok: true, pushed: ["gh-11-watch-me"] }] });
    expect(lines).toHaveLength(2);
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-11"])).toBe("");
  });

  test("--human prints a line per action and a sentence at exit; --json wins", async () => {
    expect((await h.norn("story", "checkout", "gh-11")).exit).toBe(0); // the first test released it
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-11"])).not.toBe("");
    const lines: string[] = [];
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "2", "--human"], { ...h.deps, log: (l) => lines.push(l) });
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ticks: 2, released: [{ story: "gh-11", ok: true }] });
    expect(r.stdout).toMatch(/^Stopped after 2 ticks \(0 failed actions\)\.\nReleased gh-11 \(pushed gh-11-watch-me\)\.\n$/);
    expect(lines[0]).toContain("a tick every 1ms");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1)) expect(l).toMatch(/^\d\d:\d\d:\d\d {2}gh-11 {2}\S+ → \S+$/);
    expect(lines.some((l) => l.startsWith("{"))).toBe(false);

    const json = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1", "--human", "--json", "--keep-claims"], { ...h.deps, log: () => {} });
    expect(JSON.parse(json.stdout)).toMatchObject({ ticks: 1, released: [] });
  });

  test("humanSummary names failed releases and kept claims", () => {
    const base = { ticks: 1, failed_actions: 1, skipped_busy: 2 };
    expect(humanSummary({ ...base, released: [{ story: "gh-1", ok: false, pushed: [], error: "push rejected" }] }, false)).toBe(
      "Stopped after 1 tick (1 failed action, 2 skipped while another tick ran).\nCould not release gh-1: push rejected.",
    );
    expect(humanSummary({ ...base, released: [] }, true)).toContain("Kept the claims");
    expect(humanTickLines([{ unit: "gh-1/02", rule: "agent.start", kind: "start_run", ok: false, error: "no pane" }], "2026-10-26T10:00:00Z")[0]).toMatch(
      /^\d\d:\d\d:\d\d {2}gh-1\/02 {2}agent\.start → start_run {2}FAILED: no pane$/,
    );
  });

  test("bad --interval is a usage error", async () => {
    expect((await h.norn("watch", "--interval", "soon")).exit).toBe(2);
  });
});

describe("check runner (C5)", () => {
  test("a timeout kills the process group and has no exit code", async () => {
    const r = await runShell("echo start; sleep 5; echo never", { cwd: tmpdir(), env: process.env, timeoutMs: 200 });
    expect(r).toMatchObject({ exit_code: null, timed_out: true });
    expect(r.output).toContain("start");
    expect(r.output).not.toContain("never");
    expect(r.duration_ms).toBeLessThan(3000);
  });
  test("stderr is merged and the exit code kept", async () => {
    const r = await runShell("echo out; echo err >&2; exit 3", { cwd: tmpdir(), env: process.env, timeoutMs: 5000 });
    expect(r).toMatchObject({ exit_code: 3, timed_out: false });
    expect(r.output).toBe("out\nerr\n");
  });
});
