/**
 * Team handoff (M3, §19.3): clone A runs a slice until it parks on `ask`, releases (T6); clone B
 * takes the story from git alone (T5), briefs and continues. Then a CAS race between two takes
 * (T3: one wins, the other gets "held by X since Y"), `take --force` journaled, and `drop` (GR7).
 * Real git: two clones of one bare remote; each clone has its own ~/.norn and heartbeat.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerPort } from "@norn/core";
import { ulid } from "@norn/schema";
import { appendReceipt, readState } from "@norn/store";
import { type CliDeps, type CliResult, runCli, type TickReport } from "../src/index.ts";
import { createHarness, FakeRunner, type Harness, issue, sh } from "./harness.ts";

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

interface Clone {
  root: string;
  deps: CliDeps;
  runner: FakeRunner;
  norn(...argv: string[]): Promise<CliResult>;
  at(cwd: string, ...argv: string[]): Promise<CliResult>;
  tick(...flags: string[]): Promise<TickReport>;
}

/** Another machine: its own clone, ~/.norn, user@machine and runner; same remote, issues and clock. */
function cloneOf(h: Harness, name: string, user: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  const runner = new FakeRunner();
  (runner as { name: string }).name = `fake-${name}`;
  const deps: CliDeps = {
    cwd: root,
    env: { ...process.env, NORN_HOME_DIR: home, USER: user, NORN_MACHINE: name, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: runner as RunnerPort, notifiers: [] },
  };
  return wrap(root, deps, runner);
}

function wrap(root: string, deps: CliDeps, runner: FakeRunner): Clone {
  return {
    root,
    deps,
    runner,
    norn: (...argv) => runCli(argv, deps),
    at: (cwd, ...argv) => runCli(argv, { ...deps, cwd }),
    async tick(...flags) {
      const r = await runCli(["tick", ...flags], deps);
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      return r.value as TickReport;
    },
  };
}

const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);
const SPEC = ".agents/specs/gh-7-add-login-form";
const storyWt = (root: string) => `${root}-worktrees/gh-7-add-login-form`;
const sliceWt = (root: string) => `${storyWt(root)}--01-form`;
const storyRuns = (root: string) => join(storyWt(root), SPEC, "runs/_story");
const sliceRuns = (root: string) => join(sliceWt(root), SPEC, "runs/01-form");
const state = (dir: string) => {
  const r = readState(dir);
  return r.ok ? r.value : null;
};
function report(h: Harness, runsDir: string, kind: "done" | "answer", body: Record<string, unknown>, by: "agent" | "human" = "agent") {
  const st = state(runsDir);
  if (!st) throw new Error(`no state in ${runsDir}`);
  appendReceipt(runsDir, { kind, receipt_id: ulid(h.clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: h.clock.iso(), by, ...body } as never);
}

let h: Harness;
let A: Clone;
let B: Clone;
const step = (ms = 10_000) => h.clock.advance(ms);

beforeAll(async () => {
  h = await createHarness();
  A = wrap(h.root, h.deps, h.runner);
});
afterAll(() => h.cleanup());

describe("two clones hand a story over through git (§19.3, T5, T6)", () => {
  test("clone A: intake → plan → slice implement asks a question and parks", async () => {
    expect((await A.norn("init")).exit).toBe(0);
    h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
    h.write(join(h.root, ".agents/norn/workflows/mini.yaml"), MINI);
    h.write(join(h.root, ".agents/norn/workflows/slice.yaml"), SLICE);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form", ["norn", "norn:wf:mini"])];

    expect(kinds(await A.tick())).toEqual(["gh-7 intake_story"]);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7 claim"]);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7 start_unit"]);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7 start_run"]);
    step();
    await A.tick(); // recovery commit of runs/ after the launch
    h.write(join(storyWt(h.root), SPEC, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Login form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: the form renders.\n");
    report(h, storyRuns(h.root), "done", { outcome: "done", handoff: "planned one slice" });
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7 apply_receipts"]);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7 start_slices"]);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7/01 start_run"]);

    // the agent works, then asks (the real verb, from the slice worktree)
    h.write(join(sliceWt(h.root), "form.txt"), "form v1\n");
    h.write(join(sliceWt(h.root), "pass.flag"), "ok\n");
    const run = state(sliceRuns(h.root))?.run?.run_id as string;
    const ask = await runCli(["ask", "Which colour should the button be?"], { ...h.deps, cwd: sliceWt(h.root), env: { ...h.deps.env, NORN_RUN: run } });
    expect(ask.exit).toBe(0);
    step();
    expect(kinds(await A.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(state(sliceRuns(h.root))).toMatchObject({ step: "implement", status: "parked", park: { kind: "ask" } });

    // the agent's Resume notes, not committed yet (S9: context for the next person)
    const handoff = join(sliceRuns(h.root), "handoff.md");
    h.write(handoff, `${readFileSync(handoff, "utf8")}\n## Resume\nForm done; use blue unless told otherwise.\n`);
  });

  test("clone A releases: handoff committed, branches pushed, then the claim ref deleted (T6)", async () => {
    const r = await A.norn("release", "gh-7");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-7", released: true, pushed: ["gh-7-add-login-form", "gh-7/01-form"] });
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-7"])).toBe("");
    expect(h.git(["show", `origin/gh-7/01-form:${SPEC}/runs/01-form/handoff.md`])).toContain("use blue");
    // released, so a second release is refused
    expect((await A.norn("release", "gh-7")).exit).toBe(3);
  });

  test("clone B takes from git alone: claim, worktrees with slots, cursor and handoff printed (T5)", async () => {
    B = cloneOf(h, "repo-b", "bob");
    step();
    const r = await B.norn("take", "gh-7");
    expect(r.exit).toBe(0);
    const v = r.value as { claim: { holder: string }; forced: boolean; worktrees: Array<{ unit: string; path: string; slot: number | null }>; units: Array<{ unit: string; step: string; status: string; handoff: string | null }> };
    expect(v.claim.holder).toBe("bob@repo-b");
    expect(v.forced).toBe(false);
    expect(v.worktrees.map((w) => [w.unit, w.path, w.slot])).toEqual([
      ["gh-7", storyWt(B.root), 1],
      ["gh-7/01", sliceWt(B.root), 2],
    ]);
    expect(v.units.find((u) => u.unit === "gh-7/01")).toMatchObject({ step: "implement", status: "parked" });
    expect(v.units.find((u) => u.unit === "gh-7/01")?.handoff).toContain("use blue unless told otherwise");
    expect(readFileSync(join(sliceWt(B.root), "form.txt"), "utf8")).toBe("form v1\n");
    expect(readFileSync(join(sliceWt(B.root), ".norn-unit"), "utf8")).toContain("slice=gh-7/01");
    expect(readFileSync(join(sliceWt(B.root), ".env.norn"), "utf8")).toContain("NORN_SLOT=2");
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-7"])).not.toBe("");

    // R10.1 (M8): the take is in the record — a pushed `take` receipt on the story unit and a trace event
    const file = (r.value as { receipt: { file: string } }).receipt.file;
    expect(file).toMatch(/^\d{4}-take\.json$/);
    expect(r.value).toMatchObject({ receipt: { pushed: true } });
    const rec = JSON.parse(readFileSync(join(storyRuns(B.root), "receipts", file), "utf8"));
    expect(rec).toMatchObject({ kind: "take", by: "human", who: "bob@repo-b", previous_holder: null, previous_heartbeat_id: null, expired: false });
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-7-add-login-form"]).split("\t")[0]).toBe(sh(B.root, ["rev-parse", "gh-7-add-login-form"]));
    const trace = await B.norn("trace", "gh-7", "--events");
    expect(JSON.stringify(trace.value)).toContain("take by bob@repo-b (claim was free)");

    // clone A now sees the claim held elsewhere and does nothing to the story (T7)
    step();
    const a = await A.tick("--sync");
    expect(a.decisions.filter((d) => d.unit.startsWith("gh-7"))).toEqual([{ unit: "gh-7", rule: "claim.other", kind: "noop", ok: true }]);
  });

  test("clone B answers, briefs and continues the slice to its gate", async () => {
    expect((await B.norn("answer", "gh-7/01", "Blue.")).exit).toBe(0);
    step();
    // the story unit applies the take receipt (R10.1) alongside the slice's answer
    expect(kinds(await B.tick())).toEqual(["gh-7 apply_receipts", "gh-7/01 apply_receipts"]);
    const brief = await B.at(sliceWt(B.root), "brief");
    expect(brief.exit).toBe(0);
    const text = JSON.stringify(brief.value);
    expect(text).toContain("use blue unless told otherwise");
    expect(text).toContain("Blue.");

    report(h, sliceRuns(B.root), "done", { outcome: "done", handoff: "button is blue" });
    step();
    expect(kinds(await B.tick())).toEqual(["gh-7/01 apply_receipts"]);
    step();
    expect(kinds(await B.tick())).toEqual(["gh-7/01 run_check"]);
    step();
    expect(kinds(await B.tick())).toEqual(["gh-7/01 apply_receipts"]);
    expect(state(sliceRuns(B.root))).toMatchObject({ step: "human-qa", status: "parked", park: { kind: "gate" } });
    // B pushed its step boundaries (S8, T7)
    expect(sh(B.root, ["rev-parse", "gh-7/01-form"])).toBe(h.git(["ls-remote", "origin", "refs/heads/gh-7/01-form"]).split("\t")[0] as string);
  });
});

describe("claim races (T3) and forced takes (T5)", () => {
  let C: Clone;
  test("after B's claim expires, two concurrent takes: exactly one wins, the other is told who holds it", async () => {
    C = cloneOf(h, "repo-c", "carol");
    step(11 * 60_000); // B stopped beating: its 10m lease expires
    const [ra, rc] = await Promise.all([A.norn("take", "gh-7"), C.norn("take", "gh-7")]);
    const results = [ra, rc];
    const won = results.filter((r) => r.exit === 0);
    const lost = results.filter((r) => r.exit !== 0);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.exit).toBe(5);
    const winner = ra.exit === 0 ? "tester@box" : "carol@repo-c";
    expect((lost[0]?.value as { error: string }).error).toMatch(new RegExp(`^held by ${winner} since \\d{4}-`));
    expect((won[0]?.value as { taken_from: { holder: string; expired: boolean } }).taken_from).toMatchObject({ holder: "bob@repo-b", expired: true });
    // R10.1: the winner's take receipt names the expired holder
    const winRoot = ra.exit === 0 ? A.root : C.root;
    const file = (won[0]?.value as { receipt: { file: string } }).receipt.file;
    expect(JSON.parse(readFileSync(join(storyRuns(winRoot), "receipts", file), "utf8"))).toMatchObject({ kind: "take", previous_holder: "bob@repo-b", expired: true });
  });

  test("before expiry a take needs --force; the forced take is journaled in the claim and the handoff", async () => {
    const r1 = await B.norn("take", "gh-7");
    expect(r1.exit).toBe(5);
    expect(r1.value).toMatchObject({ code: "claim_held", do_instead: expect.stringContaining("--force") });
    step();
    const r2 = await B.norn("take", "gh-7", "--force");
    expect(r2.exit).toBe(0);
    const v = r2.value as { forced: boolean; claim: { forced_from: string }; journal: { line: string; pushed: boolean } };
    expect(v.forced).toBe(true);
    expect(v.claim.forced_from).toMatch(/^(tester@box|carol@repo-c) /);
    expect(v.journal.pushed).toBe(true);
    const blob = sh(B.root, ["cat-file", "-p", "refs/norn/claims/gh-7"]);
    expect(JSON.parse(blob)).toMatchObject({ holder: "bob@repo-b", forced_from: v.claim.forced_from });
    sh(h.root, ["fetch", "-q", "origin"]);
    expect(h.git(["show", `origin/gh-7-add-login-form:${SPEC}/runs/_story/handoff.md`])).toContain("take --force by bob@repo-b");
  });

  test("drop pushes first, then removes worktrees, local branches, slots and the claim; the record stays (GR7)", async () => {
    h.write(join(sliceWt(B.root), "wip.txt"), "unfinished\n");
    const r = await B.norn("drop", "gh-7");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-7", dropped: true, pushed: ["gh-7-add-login-form", "gh-7/01-form"], claim_deleted: true, branches_deleted: ["gh-7/01-form", "gh-7-add-login-form"] });
    expect(existsSync(storyWt(B.root))).toBe(false);
    expect(existsSync(sliceWt(B.root))).toBe(false);
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-7"])).toBe("");
    sh(h.root, ["fetch", "-q", "origin"]);
    expect(h.git(["show", `origin/gh-7-add-login-form:${SPEC}/story.md`])).toContain("status: dropped");
    expect(h.git(["show", "origin/gh-7/01-form:wip.txt"])).toBe("unfinished");
    expect(sh(B.root, ["branch", "--list", "gh-7*"])).toBe("");
    // dropping an unknown story is refused with what to do instead
    const r3 = await B.norn("drop", "gh-7");
    expect(r3.exit).toBe(3);
    expect(r3.value).toMatchObject({ code: "unknown_story", do_instead: "norn take gh-7" });
  });
});
