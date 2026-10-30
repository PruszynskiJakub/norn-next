/**
 * Runtime regressions from the audit: notifications from post-act facts (O3), answers to a gone
 * session resume the agent session (B2), `unstick --to` kills the live run (S7/O2), and the GR6
 * base-branch record retried on later ticks until it lands.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@norn/schema";
import { appendTrace, pendingRecordsPath, repoConfigPath, workflowsDir } from "@norn/store";
import type { TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

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

describe("audit: runtime", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-4-audit-me`;
  const spec = ".agents/specs/gh-4-audit-me";
  const runs = () => join(wt(), spec, "runs/_story");
  const step = (ms = 10_000) => h.clock.advance(ms);

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.write(repoConfigPath(h.root), CONFIG);
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
    appendTrace(h.root, { type: "hook", id: ulid(h.clock.now()), fact: { event: "turn_end", at: h.clock.iso(), agent: "claude", native: "Stop", cwd: wt(), story: "gh-4", run_id: st?.run?.run_id as string, agent_session_id: "cs-1" } });
    h.runner.pane = { alive: false, state: "unknown", since: null };
    h.report(runs(), "answer", { answer: "use github oauth" }, "human");
    step();
    const r = await h.tick();
    h.runner.pane = { alive: true, state: "working", since: null };
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
