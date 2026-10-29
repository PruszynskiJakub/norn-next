/**
 * `norn run cancel` and `norn run rerun` (B48–B53, D4): a person stops a running agent with a human
 * `stuck` receipt written before the session is killed, and resumes or moves a stuck, parked or
 * gate-waiting unit; `unstick` is gone (B5).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Receipt } from "@norn/schema";
import { type CliDeps, type CliResult, runCli } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue, sh } from "./harness.ts";

setDefaultTimeout(30_000);

const FLOW = `name: flow
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: qa, means: "built" }, stuck: { to: qa, means: "an agent hands it on" } }
  qa:
    type: agent
    skill: norn-qa
    outcomes: { pass: { to: review, means: "it works" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: implement, counter: loop } }
counters: { loop: { max: 2 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: flow
default_mode: auto
notifiers: []
`;

let h: Harness;
const spec5 = ".agents/specs/gh-5-pay-invoices";
const spec6 = ".agents/specs/gh-6-export-report";
const wt5 = () => `${h.root}-worktrees/gh-5-pay-invoices`;
const wt6 = () => `${h.root}-worktrees/gh-6-export-report`;
const runs5 = () => join(wt5(), spec5, "runs/_story");
const runs6 = () => join(wt6(), spec6, "runs/_story");
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runCli(argv, { ...h.deps, ...deps });
const refused = (r: CliResult, code: string, doInstead?: string) => {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code, do_instead: doInstead ?? expect.any(String) });
};
const receipts = (runs: string) => readdirSync(join(runs, "receipts")).sort();
type Verb = { unit: string; receipt: Receipt; killed?: boolean };
type Inbox = { groups: Record<string, Array<{ story: string; slice: string | null }>> };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/flow.yaml"), FLOW);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report")];
  for (let i = 0; i < 4; i++) await tick();
  expect(h.state(runs5())).toMatchObject({ step: "implement", status: "running" });
  expect(h.state(runs6())).toMatchObject({ step: "implement", status: "running" });
});
afterAll(() => h.cleanup());

describe("a person's stuck at the cursor of a running unit (B51, D4)", () => {
  test("the next tick ends the run there: stuck under Unblock, not relaunched, retried or nudged", async () => {
    const session = h.state(runs5())?.run?.session?.session_id;
    // the workflow's own `stuck` edge is the agent's; a person stopping the run never takes it
    h.report(runs5(), "stuck", { reason: "cancelled by person" }, "human");
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: 1, status: "stuck", park: { kind: "stuck", reason: "cancelled by person" } });
    // past the stalled window and the deadline, with the pane gone: still stuck, nothing typed or started
    h.runner.pane = { alive: false, state: "done", since: null };
    for (let i = 0; i < 3; i++) {
      h.clock.advance(2 * 60 * 60_000);
      await h.tick();
    }
    h.runner.pane = { alive: true, state: "working", since: null };
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: 1, status: "stuck" });
    expect(h.runner.launches.filter((l) => l.cwd === wt5()).length).toBe(1);
    expect(h.runner.sent.filter((s) => s.session.session_id === session)).toEqual([]);
    const inbox = (await h.norn("status", "--json")).value as Inbox;
    expect(inbox.groups.unblock).toContainEqual(expect.objectContaining({ story: "gh-5", slice: null }));
  });
});

describe("run rerun (B48, B50)", () => {
  test("a stuck unit resumes its step in a fresh session; --reset and --reason are journaled", async () => {
    refused(await h.norn("run", "rerun", "gh-5", "--reset", "bogus"), "unknown_counter");
    const r = await h.norn("run", "rerun", "gh-5", "--reset", "loop", "--reason", "go on");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", reset: ["loop"], comment: "go on", step: "implement", attempt: 1 });
    refused(await h.norn("run", "rerun", "gh-5"), "already_recorded");
    const before = h.runner.launches.length;
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: 2, status: "running", counters: { loop: 0 } });
    expect(h.runner.launches.slice(before).map((l) => l.cwd)).toContain(wt5());
  });

  test("a running unit is refused: stopping it is run cancel", async () => {
    refused(await h.norn("run", "rerun", "gh-5"), "running", "norn run cancel gh-5");
  });
});

describe("run cancel (B51–B53)", () => {
  test("writes the stuck receipt first, then kills the session; everything else stays; rerun resumes", async () => {
    // work in progress: a commit and an uncommitted change
    writeFileSync(join(wt5(), "pay.ts"), "export const pay = 1;\n");
    sh(wt5(), ["add", "pay.ts"]);
    sh(wt5(), ["commit", "-q", "-m", "pay"]);
    const head = sh(wt5(), ["rev-parse", "HEAD"]);
    writeFileSync(join(wt5(), "draft.ts"), "wip\n");
    const run = h.state(runs5())?.run;
    let atKill: string[] = [];
    const kill = h.runner.kill.bind(h.runner);
    h.runner.kill = async (s) => {
      atKill = receipts(runs5());
      return kill(s);
    };
    const killedBefore = h.runner.killed.length;
    const r = await h.norn("run", "cancel", "gh-5");
    h.runner.kill = kill;
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.receipt).toMatchObject({ kind: "stuck", by: "human", reason: "cancelled by person", run_id: run?.run_id, step: "implement", attempt: 2 });
    // P6: the receipt existed when the session was killed
    expect(atKill.at(-1)).toMatch(/-stuck\.json$/);
    expect(h.runner.killed.slice(killedBefore)).toEqual([expect.objectContaining({ session_id: run?.session?.session_id })]);
    const launches = h.runner.launches.length;
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: 2, status: "stuck", park: { reason: "cancelled by person" } });
    expect(h.runner.launches.length).toBe(launches);
    // B52: commits, uncommitted changes, branch and claim are still there
    expect(sh(wt5(), ["log", "--format=%H"]).split("\n")).toContain(head);
    expect(existsSync(join(wt5(), "draft.ts"))).toBe(true);
    expect(sh(h.root, ["branch", "--list", "gh-5-pay-invoices"])).toContain("gh-5-pay-invoices");
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-5"])).toContain("refs/norn/claims/gh-5");
    // and run rerun resumes implement in a fresh session
    expect((await h.norn("run", "rerun", "gh-5")).exit).toBe(0);
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: 3, status: "running" });
    expect(h.runner.launches.slice(launches).map((l) => l.cwd)).toContain(wt5());
  });

  test("a unit waiting at a gate has nothing to cancel; a unit that is not started either", async () => {
    h.report(runs6(), "done", { outcome: "done", handoff: "built" });
    await tick();
    await tick();
    h.report(runs6(), "done", { outcome: "pass", handoff: "works" });
    await tick();
    expect(h.state(runs6())).toMatchObject({ step: "review", status: "parked", park: { kind: "gate" } });
    refused(await h.norn("run", "cancel", "gh-6"), "nothing_to_cancel");
  });

  test("without a target a terminal is offered only the running units", async () => {
    const terminal = new FakeInteraction();
    terminal.answers = [null];
    const r = await norn({ interaction: terminal }, "run", "cancel");
    expect(terminal.picks).toHaveLength(1);
    expect(terminal.picks[0]?.choices.map((c) => c.value)).toEqual(["gh-5"]);
    expect(r.exit).toBe(3);
  });

  test("a claim another machine holds is refused: check the story out first", async () => {
    const bRoot = join(h.dir, "colleague");
    const bHome = join(h.dir, "colleague-home");
    mkdirSync(bHome);
    sh(h.dir, ["clone", "-q", h.remoteDir, bRoot]);
    const deps = { cwd: bRoot, env: { ...h.deps.env, NORN_HOME_DIR: bHome, USER: "colleague", NORN_MACHINE: "laptop" } };
    const killed = h.runner.killed.length;
    const r = await norn(deps, "run", "cancel", "gh-5");
    refused(r, "not_holder", "norn story checkout gh-5");
    expect(h.runner.killed.length).toBe(killed);
    expect(h.state(runs5())).toMatchObject({ status: "running" });
  });

  test("a session this checkout cannot stop is said, with the receipt, never skipped (B51)", async () => {
    const killed = h.runner.killed.length;
    // the run was started by another runner than the one configured here now
    const runner = h.runner as { name: string };
    runner.name = "other";
    const r = await h.norn("run", "cancel", "gh-5", "--json");
    runner.name = "fake";
    expect(r.exit).toBe(1);
    const last = receipts(runs5()).at(-1) as string;
    expect(last).toMatch(/-stuck\.json$/);
    expect(r.value).toMatchObject({
      code: "not_stopped",
      error: expect.stringContaining("it runs in fake"),
      do_instead: "stop the agent by hand; the next tick will not restart it, then norn run rerun gh-5",
      details: { receipt_id: expect.any(String), file: expect.stringContaining(last) },
    });
    expect(h.runner.killed.length).toBe(killed);
    // a kill that throws says the same, with its own code
    await tick();
    expect((await h.norn("run", "rerun", "gh-5")).exit).toBe(0);
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ status: "running" });
    const kill = h.runner.kill.bind(h.runner);
    h.runner.kill = async () => {
      throw new Error("pane gone");
    };
    const f = await h.norn("run", "cancel", "gh-5", "--json");
    h.runner.kill = kill;
    expect(f.exit).toBe(1);
    expect(f.value).toMatchObject({ code: "kill_failed", error: expect.stringContaining("pane gone"), details: { receipt_id: expect.any(String) } });
    await tick();
    expect(h.state(runs5())).toMatchObject({ status: "stuck", park: { reason: "cancelled by person" } });
    expect((await h.norn("run", "rerun", "gh-5")).exit).toBe(0);
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ status: "running" });
  });
});

describe("run rerun --step (B49)", () => {
  test("a unit stuck at qa moves to implement", async () => {
    h.report(runs5(), "done", { outcome: "done", handoff: "built" });
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "qa", status: "running" });
    h.report(runs5(), "stuck", { reason: "no browser" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "qa", status: "stuck" });
    refused(await h.norn("run", "rerun", "gh-5", "--step", "nope"), "unknown_step");
    const r = await h.norn("run", "rerun", "gh-5", "--step", "implement");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", to: "implement" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement" });
  });

  test("a gate-waiting unit resumes as unstick resumed it", async () => {
    const r = await h.norn("run", "rerun", "gh-6");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", step: "review" });
    await tick();
    expect(h.state(runs6())).toMatchObject({ step: "review", attempt: 2, status: "parked", park: { kind: "gate" } });
  });

  test("a unit parked on an ask resumes as unstick resumed it", async () => {
    h.report(runs5(), "ask", { question: "Which currency?", options: [] });
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", status: "parked", park: { kind: "ask" } });
    const attempt = h.state(runs5())?.attempt as number;
    const r = await h.norn("run", "rerun", "gh-5");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", step: "implement", attempt });
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "implement", attempt: attempt + 1, status: "running" });
  });

  test("a unit that is not stuck, parked or at a gate is refused", async () => {
    expect((await h.norn("approve", "gh-6")).exit).toBe(0);
    await tick();
    await tick();
    expect(h.state(runs6())).toMatchObject({ status: "done" });
    refused(await h.norn("run", "rerun", "gh-6"), "not_stuck");
  });
});

describe("the surface (B2, B5)", () => {
  test("unstick is an unknown command; run lists rerun and cancel", async () => {
    const r = await h.norn("unstick", "gh-5");
    expect(r.exit).toBe(2);
    expect(r.value).toMatchObject({ error: "Unknown command: unstick", code: "unknown_command" });
    const run = await h.norn("run");
    expect(run.exit).toBe(0);
    expect((run.value as { verbs: Array<{ command: string }> }).verbs.map((v) => v.command)).toEqual(expect.arrayContaining(["run rerun", "run cancel"]));
  });
});
