/**
 * Observe snapshots and inbox parity (refactor Phase 0.3) at five fixed points of one story:
 * fresh intake, a running slice, a slice parked on an ask, a slice waiting at a gate, and the story
 * merged into the base. At each point the normalised observe Facts must match the committed
 * snapshot, and the inbox `norn inbox` shows (`loadProjectView`, X1) must equal `buildInbox` over
 * observe's Facts at the same instant (the tick notifies from those, O3).
 * Real git (temp repo + bare remote); fake RemotePort, RunnerPort and notifier.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import type { TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue, sh } from "./harness.ts";
import { expectFactsSnapshot, inboxParity, observeNow } from "./observe-snapshot.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: open-pr, stuck: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: $done }
`;

const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: test, means: "tests pass" } }
  test:
    type: check
    run: test -f pass.flag && echo checked
    timeout: 1m
    outcomes: { pass: human-qa, fail: { to: implement, counter: test_loop } }
  human-qa:
    type: gate
    prompt: "Try it"
    outcomes: { approve: integrate, reject: { to: implement, counter: test_loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: story
default_mode: auto
notifiers: []
`;

describe("observe snapshots and inbox parity (refactor Phase 0.3)", () => {
  let h: Harness;
  const storyWt = () => `${h.root}-worktrees/gh-7-add-login-form`;
  const sliceWt = () => `${storyWt()}--01-form`;
  const spec = ".agents/specs/gh-7-add-login-form";
  const storyRuns = () => join(storyWt(), spec, "runs/_story");
  const sliceRuns = () => join(sliceWt(), spec, "runs/01-form");
  const step = (ms = 10_000) => h.clock.advance(ms);
  const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);
  /** tick until `pred` holds (at most 12 ticks) */
  const until = async (pred: () => boolean, label: string) => {
    const seen: string[] = [];
    for (let i = 0; i < 12 && !pred(); i++) {
      step();
      seen.push(...acted(await h.tick()));
    }
    if (!pred()) throw new Error(`${label} not reached:\n${seen.join("\n")}`);
  };
  /** Snapshot observe's Facts at this point and check the view's inbox against them; returns the inbox ids by group. */
  const fixedPoint = async (name: string) => {
    const obs = await observeNow(h);
    expectFactsSnapshot(h, obs.facts, name);
    const { view, observed } = await inboxParity(h, obs);
    return { view, observed, ids: Object.fromEntries(Object.entries(observed.groups).filter(([, l]) => l.length).map(([g, l]) => [g, l.map((i) => i.id)])) };
  };

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.write(repoConfigPath(h.root), CONFIG);
    h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
    h.write(join(workflowsDir(h.root), "slice.yaml"), SLICE);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form", ["norn", "norn:wf:mini"])];
  });
  afterAll(() => h.cleanup());

  test("fresh intake: story worktree and story.md, no claim yet", async () => {
    expect(acted(await h.tick())).toEqual(["gh-7 intake_story"]);
    const p = await fixedPoint("fresh-intake");
    expect(p.ids).toEqual({});
    expect(p.view).toEqual(p.observed);
  });

  test("running slice: the slice agent runs in its own worktree", async () => {
    await until(() => h.state(storyRuns())?.status === "running", "story plan running");
    h.write(join(storyWt(), spec, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Login form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: the form renders.\n");
    h.report(storyRuns(), "done", { outcome: "done", handoff: "planned one slice" });
    await until(() => h.state(sliceRuns())?.status === "running", "slice running");
    step();
    await h.tick(); // the launch's recovery commit: a steady running slice
    const p = await fixedPoint("running-slice");
    expect(p.ids).toEqual({ running: ["running:gh-7:slices#1", "running:gh-7/01:implement#1"] });
    expect(p.view).toEqual(p.observed);
  });

  test("parked ask: the slice agent asked a question", async () => {
    h.report(sliceRuns(), "ask", { question: "Which provider?" });
    step();
    expect(acted(await h.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(h.state(sliceRuns())).toMatchObject({ status: "parked", park: { kind: "ask" } });
    const p = await fixedPoint("parked-ask");
    expect(p.observed.groups.answer).toMatchObject([{ slice: "gh-7/01", step: "implement" }]);
    expect(p.ids.running).toEqual(["running:gh-7:slices#1"]);
    expect(p.view).toEqual(p.observed);
  });

  test("gate waiting: the check passed and the slice waits at human-qa", async () => {
    h.report(sliceRuns(), "answer", { answer: "github" }, "human");
    step();
    await h.tick();
    h.write(join(sliceWt(), "form.txt"), "form v1\n");
    h.write(join(sliceWt(), "pass.flag"), "ok\n");
    h.report(sliceRuns(), "done", { outcome: "done", handoff: "form added" });
    await until(() => h.state(sliceRuns())?.status === "parked" && h.state(sliceRuns())?.step === "human-qa", "gate");
    const p = await fixedPoint("gate-waiting");
    expect(p.ids).toEqual({ approve: ["approve:gh-7/01:human-qa#1"], running: ["running:gh-7:slices#1"] });
    expect(p.view).toEqual(p.observed);
  });

  test("merged: the story's PR landed on the base branch", async () => {
    h.report(sliceRuns(), "approve", {}, "human");
    await until(() => h.state(storyRuns())?.status === "done", "story done");
    const pr = h.remote.prs[0] as (typeof h.remote.prs)[number];
    pr.state = "merged";
    const land = join(h.dir, "land");
    sh(h.dir, ["clone", "-q", h.remoteDir, land]);
    sh(land, ["-c", "user.email=s@example.com", "-c", "user.name=S", "merge", "-q", "--no-ff", "-m", "Merge PR #100", "origin/gh-7-add-login-form"]);
    sh(land, ["push", "-q", "origin", "main"]);
    step();
    expect(acted(await h.tick("--sync"))).toContain("gh-7 cleanup_merged_story");
    step();
    await h.tick();
    const p = await fixedPoint("merged");
    expect(p.ids).toEqual({ recently_done: ["recently_done:gh-7/01:$done#1", "recently_done:gh-7:$done#1"] });
    expect(p.view).toEqual(p.observed);
  });
});
