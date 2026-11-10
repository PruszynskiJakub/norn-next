/**
 * Runtime regressions from the audit: notifications from post-act facts, answers to a gone
 * session resume the agent session, `unstick --to` kills the live run, the GR6
 * base-branch record retried on later ticks until it lands, and an owed record the base keeps
 * refusing stopped and handed to the person.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@norn/schema";
import { appendHookTrace, type PendingRecord, pendingRecordsPath, readPendingRecords, repoConfigPath, workflowsDir, writePendingRecords } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
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

describe("audit: runtime", () => {
  let h: Harness;
  const wt = () => h.worktree("gh-4-audit-me");
  const spec = ".agents/specs/gh-4-audit-me";
  const runs = () => runStateOf(join(wt(), spec));
  const step = (ms = 10_000) => h.clock.advance(ms);

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config(CONFIG);
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(4, "Audit me")];
    for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) {
      step();
      await h.tick();
    }
    expect(h.state(runs())?.status).toBe("running");
    step();
    await h.tick(); // recovery commit of runs/ after the launch
  });
  afterAll(() => h.cleanup());

  test("O3: an item created by this tick's act is notified in the same tick", async () => {
    h.report(runs(), "ask", { question: "Which provider?" });
    step();
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-4 apply_receipts"]);
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask" } });
    expect(h.notifier.items.map((i) => i.group)).toContain("answer");
    expect(r.notified.length).toBeGreaterThan(0);
  });

  test("B2: an answer to a gone session resumes the agent session with the answer as the prompt", async () => {
    const st = h.state(runs());
    appendHookTrace(h.root, { story: "gh-4" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "turn_end", at: h.clock.iso(), agent: "claude", native: "Stop", cwd: wt(), story: "gh-4", run_id: st?.run?.run_id as string, agent_session_id: "cs-1" } });
    h.runner.pane = { alive: false, state: "unknown" };
    h.report(runs(), "answer", { answer: "use github oauth" }, "human");
    step();
    const r = await h.tick();
    h.runner.pane = { alive: true, state: "working" };
    expect(acted(r)).toEqual(["gh-4 apply_receipts"]);
    const argv = h.runner.launches.at(-1)?.argv ?? [];
    expect(argv).toContain("--resume");
    expect(argv).toContain("cs-1");
    expect(argv.join(" ")).toContain("use github oauth");
    expect(h.runner.sent).toEqual([]);
    expect(h.state(runs())).toMatchObject({ status: "running", retries_used: 0, run: { run_id: st?.run?.run_id, session: { session_id: `s-${h.runner.launches.length}` } } });
  });

  test("S7/O2: unstick --to off a live run kills it and releases its agent lease", async () => {
    step();
    await h.tick(); // recovery commit
    const live = h.state(runs())?.run?.session?.session_id;
    h.report(runs(), "stuck", { reason: "need a person" });
    step();
    await h.tick();
    expect(h.state(runs())?.status).toBe("stuck");
    h.report(runs(), "unstick", { to: "implement" }, "human");
    step();
    const r = await h.tick();
    expect(acted(r)[0]).toBe("gh-4 apply_receipts");
    expect(h.runner.killed.map((s) => s.session_id)).toContain(live as string);
  });

  test("GR6: a deferred base-branch record is retried on later ticks until it lands", async () => {
    for (let i = 0; i < 3 && h.state(runs())?.status !== "running"; i++) {
      step();
      await h.tick();
    }
    h.report(runs(), "done", { outcome: "done", handoff: "done" });
    step();
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "done" });
    step();
    await h.tick(); // push the final state
    h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-4-audit-me", base_branch: "main", merged_at: h.clock.iso() }];
    step();
    const s = await h.norn("sync");
    expect(acted(s.value as TickReport)).toEqual(["gh-4 cleanup_merged_story"]);
    const records = pendingRecordsPath(h.root);
    expect(JSON.parse(readFileSync(records, "utf8")).records).toMatchObject([{ story: "gh-4", attempts: 1 }]);

    // the merge reaches the base branch on the remote later
    const other = join(h.dir, "merger");
    h.git(["clone", "-q", h.remoteDir, other], h.dir);
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "merge", "-q", "--no-edit", "origin/gh-4-audit-me"], other);
    h.git(["push", "-q", "origin", "main"], other);

    step(60_000);
    expect((await h.tick()).records).toBeUndefined(); // throttled
    step(5 * 60_000);
    const r = await h.tick();
    expect(r.records).toEqual([{ story: "gh-4", state: "pushed" }]);
    expect(h.git(["show", `origin/main:${spec}/spec.md`])).toContain("status: done");
    expect(JSON.parse(readFileSync(records, "utf8")).records).toEqual([]);
    step(10 * 60_000);
    expect((await h.tick()).records).toBeUndefined();
    expect(existsSync(wt())).toBe(false);
  });
});

describe("owed base records the base keeps refusing", () => {
  let h: Harness;
  const wt = () => h.worktree("gh-4-audit-me");
  const spec = ".agents/specs/gh-4-audit-me";
  const runs = () => runStateOf(join(wt(), spec));
  const step = (ms = 10_000) => h.clock.advance(ms);
  const retry = () => step(5 * 60_000 + 1_000);
  const hook = () => join(h.remoteDir, "hooks", "pre-receive");
  const remoteMain = () => h.git(["rev-parse", "main"], h.remoteDir).trim();
  type Item = { id: string; command: string };
  const owedItems = async () => {
    const v = (await h.norn("status", "--json")).value as { groups: Record<string, Item[]> };
    return (v.groups.unblock ?? []).filter((i) => i.id.startsWith("record_owed:"));
  };
  let other: string;

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config(CONFIG);
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(4, "Audit me")];
    for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) {
      step();
      await h.tick();
    }
    expect(h.state(runs())?.status).toBe("running");
    step();
    await h.tick();
    h.report(runs(), "done", { outcome: "done", handoff: "done" });
    step();
    await h.tick();
    expect(h.state(runs())).toMatchObject({ status: "done" });
    step();
    await h.tick(); // push the final state
    h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-4-audit-me", base_branch: "main", merged_at: h.clock.iso() }];
    step();
    const s = await h.norn("sync");
    expect(acted(s.value as TickReport)).toEqual(["gh-4 cleanup_merged_story"]);
    expect(readPendingRecords(h.root)).toMatchObject([{ story: "gh-4", attempts: 1 }]);
    // the merge reaches the base, which then refuses every push to main
    other = join(h.dir, "merger");
    h.git(["clone", "-q", h.remoteDir, other], h.dir);
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "merge", "-q", "--no-edit", "origin/gh-4-audit-me"], other);
    h.git(["push", "-q", "origin", "main"], other);
    writeFileSync(hook(), `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/heads/main) echo "main is protected" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook(), 0o755);
  });
  afterAll(() => h.cleanup());

  test("three refusals stop the retries with a notified Unblock item; the base reading done clears it without a push", async () => {
    const lines = [];
    for (let i = 0; i < 3; i++) {
      retry();
      lines.push((await h.tick()).records);
    }
    expect(lines.map((l) => l?.[0]?.state)).toEqual(["failed", "failed", "failed"]);
    expect(lines.map((l) => l?.[0]?.stopped)).toEqual([undefined, undefined, true]);
    expect(readPendingRecords(h.root)).toMatchObject([{ story: "gh-4", refusals: 3, stopped_at: h.clock.now() }]);
    // notified in the tick that stopped it, from the post-act facts
    expect(h.notifier.items.some((i) => i.id === "record_owed:gh-4")).toBe(true);
    expect(await owedItems()).toMatchObject([{ id: "record_owed:gh-4", command: "norn sync" }]);
    step(30 * 60_000);
    expect((await h.tick()).records).toBeUndefined();

    // the person lands status: done on the base themselves
    rmSync(hook(), { force: true });
    const file = join(other, spec, "spec.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: \S+$/m, "status: done"));
    h.git(["-c", "user.email=m@x", "-c", "user.name=m", "commit", "-q", "-am", "gh-4 done by hand"], other);
    h.git(["push", "-q", "origin", "main"], other);
    const head = remoteMain();
    step();
    const r = (await h.norn("sync")).value as TickReport;
    expect(r.records).toEqual([{ story: "gh-4", state: "unchanged" }]);
    expect(readPendingRecords(h.root)).toEqual([]);
    expect(await owedItems()).toEqual([]);
    expect(remoteMain()).toBe(head);
  });

  test("tidy drops a stopped record whose story is gone, never one whose story is present nor one still retried", async () => {
    const at = h.clock.now();
    const owe = (story: string, stopped: boolean): PendingRecord => ({
      story,
      spec_dir: `.agents/specs/${story}-x`,
      status: "done",
      attempted_at: at,
      attempts: 4,
      reason: "push to main rejected (rejected)",
      ...(stopped ? { refusals: 3, stopped_at: at } : {}),
    });
    writePendingRecords(h.root, [owe("gh-99", true), owe("gh-4", true), owe("gh-98", false)]);
    const dry = (await h.norn("tidy", "--dry-run", "--json")).value as { would_remove: { owed_records?: string[] } };
    expect(dry.would_remove.owed_records).toEqual(["gh-99"]);
    expect(readPendingRecords(h.root)).toHaveLength(3);
    const wet = (await h.norn("tidy", "--json")).value as { removed: { owed_records?: string[] } };
    expect(wet.removed.owed_records).toEqual(["gh-99"]);
    expect(readPendingRecords(h.root).map((r) => r.story)).toEqual(["gh-4", "gh-98"]);
  });

  test("an unreachable remote never counts as a refusal", async () => {
    writePendingRecords(h.root, [{ story: "gh-98", spec_dir: ".agents/specs/gh-98-x", status: "done", attempted_at: h.clock.now() - 10 * 60_000, attempts: 1, reason: "x" }]);
    const aside = `${h.remoteDir}.aside`;
    renameSync(h.remoteDir, aside);
    try {
      for (let i = 0; i < 4; i++) {
        retry();
        const line = (await h.tick()).records?.find((l) => l.story === "gh-98");
        expect(line?.reason).toContain("fetch main");
        expect(line?.stopped).toBeUndefined();
      }
    } finally {
      renameSync(aside, h.remoteDir);
    }
    const [r] = readPendingRecords(h.root);
    expect(r).toMatchObject({ story: "gh-98", attempts: 5 });
    expect(r).not.toHaveProperty("refusals");
    expect(r).not.toHaveProperty("stopped_at");
    retry();
    const line = (await h.tick()).records?.find((l) => l.story === "gh-98");
    expect(line?.reason).toContain("is not on origin/main yet");
  });
});
