/**
 * Runtime paths beyond the happy flow: repo discovery from a worktree, throttled sync,
 * silent → nudge into the same session, died → fresh session, watch releasing
 * claims on a clean exit, PR merged cleanup (also after the round finished and the claim was
 * released), uninstall, and check timeouts.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NUDGE_TEXT } from "@norn/core";
import { ulid } from "@norn/schema";
import { appendHookTrace, appendReceipt, readTrace, repoConfigPath, workflowsDir, writeState } from "@norn/store";
import { humanSummary, humanTickLines } from "../../src/commands/watch.ts";
import { runShell, type TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

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

const CONFIG = `provider: gh
workflow: solo
mode: auto
`;

const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);

async function boot(h: Harness, n: number, title: string) {
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(n, title)];
}

describe("runtime", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-9-fix-the-bug`;
  const runs = () => runStateOf(join(wt(), ".agents/specs/gh-9-fix-the-bug"));
  beforeAll(async () => {
    h = await createHarness();
    await boot(h, 9, "Fix the bug");
  });
  afterAll(() => h.cleanup());

  test("remote calls are throttled; `norn sync` forces one", async () => {
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

  test("outside a repository the command refuses with do_instead", async () => {
    const away = realpathSync(mkdtempSync(join(tmpdir(), "norn-away-")));
    const r = await runChecked(["tick"], { ...h.deps, cwd: away });
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "not_in_repo", do_instead: expect.any(String) });
  });

  test("turn ended without a receipt → silent → nudge into the same session", async () => {
    for (let i = 0; i < 3 && h.state(runs())?.status !== "running"; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    expect(h.state(runs())?.status).toBe("running");
    h.clock.advance(10_000);
    await h.tick(); // recovery commit of runs/ after the launch
    const st = h.state(runs());
    h.clock.advance(10_000);
    appendHookTrace(h.root, { story: "gh-9" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "turn_end", at: h.clock.iso(), agent: "claude", native: "Stop", cwd: wt(), story: "gh-9", run_id: st?.run?.run_id as string } });
    h.clock.advance(1000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 nudge"]);
    expect(h.runner.sent).toEqual([{ session: { runner: "fake", session_id: "s-1", pane_id: "p-1" }, text: NUDGE_TEXT }]);
    expect(h.state(runs())).toMatchObject({ status: "running", nudges_used: 1 });
    expect(readdirSync(join(runs(), "receipts")).some((f) => f.endsWith("-classify.json"))).toBe(true);
  });

  test("pane gone → died → old session killed, fresh session launched", async () => {
    h.runner.pane = { alive: false, state: "unknown" };
    h.clock.advance(10_000);
    const r = await h.tick();
    h.runner.pane = { alive: true, state: "working" };
    expect(acted(r)).toEqual(["gh-9 retry_fresh"]);
    expect(h.runner.killed.map((s) => s.session_id)).toEqual(["s-1"]);
    expect(h.runner.launches).toHaveLength(2);
    expect(h.state(runs())).toMatchObject({ status: "running", retries_used: 1, run: { session: { session_id: "s-2" } } });
  });

  test("a stale receipt is rejected into the trace; done → $done, a finished round", async () => {
    const st = h.state(runs());
    appendReceipt(runs(), { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st?.run?.run_id ?? null, step: "implement", attempt: 7, at: h.clock.iso(), by: "agent", outcome: "done", handoff: "old" });
    h.report(runs(), "done", { outcome: "done", handoff: "fixed" });
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 apply_receipts"]);
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    const rejects = readTrace(h.root, { types: ["reject"], unit: "gh-9" }).events;
    expect(rejects).toMatchObject([{ type: "reject", unit: "gh-9", reason: "stale: receipt for implement#7, cursor at implement#1" }]);
  });

  test("a receipt failing validation marks the unit corrupt and notifies once", async () => {
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

  test("PR merged → worktree, branches, claim ref and slot removed; a unit parked at merge time recorded done", async () => {
    const parked = h.state(runs());
    if (!parked) throw new Error("no state");
    writeState(runs(), { ...parked, status: "parked", park: { kind: "gate", reason: "PR ready?", since: h.clock.iso() } });
    const runsDir = runs();
    h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-9-fix-the-bug", base_branch: "main", merged_at: h.clock.iso() }];
    h.clock.advance(10_000);
    const s = await h.norn("sync");
    expect(acted(s.value as TickReport)).toEqual(["gh-9 cleanup_merged_story"]);
    expect(existsSync(wt())).toBe(false);
    expect(h.git(["branch", "--list", "gh-9-fix-the-bug"])).toBe("");
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-9"])).toBe("");
    expect(readdirSync(join(h.home, "leases")).filter((f) => f.startsWith("slot-"))).toEqual([]);
    expect(h.state(runsDir)).toMatchObject({ status: "done", park: null, run: null });
  });

  test("uninstall removes norn-owned hooks and skills, keeps config", async () => {
    const r = await h.norn("uninstall");
    expect(r.exit).toBe(0);
    expect((r.value as { skills_removed: string[] }).skills_removed).toContain(join(h.root, ".agents/skills/norn-implement"));
    expect(existsSync(join(h.root, ".claude/skills/norn"))).toBe(false);
    expect(existsSync(join(h.root, ".agents/skills"))).toBe(false);
    expect(h.read(join(h.root, ".claude/settings.json"))).not.toContain("norn-owned");
    expect(existsSync(repoConfigPath(h.root))).toBe(true);
  });
});

describe("PR merged after the round finished", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-9-fix-the-bug`;
  const runs = () => runStateOf(join(wt(), ".agents/specs/gh-9-fix-the-bug"));
  beforeAll(async () => {
    h = await createHarness();
    await boot(h, 9, "Fix the bug");
  });
  afterAll(() => h.cleanup());

  test("round at $done, claim released by watch's clean exit, then the PR merges → sync cleans up and records done", async () => {
    for (let i = 0; i < 3; i++) {
      await h.tick();
      h.clock.advance(1000);
    }
    h.report(runs(), "done", { outcome: "done", handoff: "fixed" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    const runsDir = runs();

    const w = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1"], { ...h.deps, log: () => {} });
    expect(w.value).toMatchObject({ released: [{ story: "gh-9", ok: true }] });
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-9"])).toBe("");

    // the PR merges for real: the story branch watch pushed lands on main on the remote (not pulled here)
    const merger = join(h.dir, "merger");
    const id = ["-c", "user.email=m@x", "-c", "user.name=m"];
    h.git(["clone", "-q", h.remoteDir, merger], h.dir);
    h.git([...id, "merge", "-q", "--no-ff", "-m", "merge PR #1", "origin/gh-9-fix-the-bug"], merger);
    h.git(["push", "-q", "origin", "main"], merger);
    h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-9-fix-the-bug", base_branch: "main", merged_at: h.clock.iso() }];
    h.remote.issues = h.remote.issues.map((i) => ({ ...i, state: "closed" as const }));
    h.clock.advance(60_000);
    const gh9 = (r: TickReport) => r.decisions.filter((d) => d.unit === "gh-9" && d.kind !== "noop").map((d) => `${d.kind} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
    // the sync takes the released claim back; holding it, the next sync (the PR fact comes with a sync) runs the merge cleanup
    expect(gh9((await h.norn("sync")).value as TickReport)).toEqual(["claim claim.reacquire.merged"]);
    h.clock.advance(60_000);
    expect(gh9((await h.norn("sync")).value as TickReport)).toEqual(["cleanup_merged_story remote.pr_merged"]);
    expect(existsSync(wt())).toBe(false);
    expect(h.state(runsDir)).toMatchObject({ status: "done" });
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["show", "origin/main:.agents/specs/gh-9-fix-the-bug/spec.md"])).toMatch(/^status: done$/m);
  });
});

describe("watch", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h, 11, "Watch me");
  });
  afterAll(() => h.cleanup());

  test("loops ticks and releases held claims on a clean exit", async () => {
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

describe("check runner", () => {
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
