/**
 * gh-195/05 (S12, B2–B5, D8): a unit started on this build keeps its state, receipts, pinned workflow,
 * logs and evidence at `<machine dir>/runs/<story>/<unit>/`, never in its worktree or on its branch; a
 * boundary commit carries only the agent's work and the handoff.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { machineDir, unitMarkerPath, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { observeNow } from "../../../../test/support/observe-now.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(60_000);

const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: test, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
  test:
    type: check
    run: "true"
    timeout: 30s
    outcomes: { pass: $done, fail: { to: implement, counter: review_loop } }
counters: { review_loop: { max: 3 } }
`;
const SPLIT = `name: split
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;
const PART = `name: part
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;

let h: Harness;
const SPEC = ".agents/specs/gh-9-keep-it-local";
const wt = () => `${h.root}-worktrees/gh-9-keep-it-local`;
const runs = () => runStateOf(join(wt(), SPEC));
/** every path `git status` shows in the worktree */
const status = (cwd: string) =>
  sh(cwd, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace(/^\s*\S{1,2}\s+/, ""));
/** S12: nothing but the agent's own files and the unit's handoff ever shows in git */
const onlyWorkAndHandoff = (cwd: string, handoff: string) => {
  expect(status(cwd).filter((p) => p !== handoff && p.includes("/runs/"))).toEqual([]);
};
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: duo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.write(join(workflowsDir(h.root), "split.yaml"), SPLIT);
  h.write(join(workflowsDir(h.root), "part.yaml"), PART);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Keep it local")];
});
afterAll(() => h.cleanup());

describe("gh-9 runs with its run state in the machine dir (S12, B2, B5)", () => {
  const HANDOFF = `${SPEC}/runs/_story/handoff.md`;

  test("AC1: through implement and review, git status never shows a run-state file; they are under <machine dir>/runs/gh-9/_story/", async () => {
    await tickUntil(() => h.state(runs())?.step === "implement");
    onlyWorkAndHandoff(wt(), HANDOFF);
    expect(runs()).toBe(join(machineDir(h.root), "runs/gh-9/_story/rounds/01-duo"));
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    onlyWorkAndHandoff(wt(), HANDOFF);
    h.write(join(wt(), "src/feature.ts"), "export const x = 1;\n");
    const ev = join(h.dir, "ev");
    mkdirSync(ev, { recursive: true });
    writeFileSync(join(ev, "AC1.md"), "seen\n");
    expect((await inWt(wt(), "done", "done", "--handoff", "built it", "--evidence", ev)).exit).toBe(0);
    onlyWorkAndHandoff(wt(), HANDOFF);
    await tickUntil(() => h.state(runs())?.step === "review");
    onlyWorkAndHandoff(wt(), HANDOFF);
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    expect((await inWt(wt(), "done", "approve", "--handoff", "looks right")).exit).toBe(0);
    await tickUntil(() => h.state(runs())?.step === "$done");
    onlyWorkAndHandoff(wt(), HANDOFF);
    // every kind of run-state file, in the machine dir; the worktree's and the branch's runs/ hold the handoff only
    expect(readdirSync(runs()).sort()).toEqual(["evidence", "receipts", "state.json", "workflow.yaml"]);
    expect(readdirSync(join(runs(), "receipts")).some((f) => f.endsWith("-check.json"))).toBe(true);
    expect(readdirSync(join(wt(), SPEC, "runs/_story"))).toEqual(["handoff.md"]);
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["ls-tree", "-r", "--name-only", "origin/gh-9-keep-it-local", "--", `${SPEC}/runs`]).trim()).toBe(HANDOFF);
  });

  test("AC6: the boundary after `norn done done` holds exactly the agent's files and the handoff, with the S4 trailers", async () => {
    const done = sh(wt(), ["log", "--format=%H %s", "-n", "30"])
      .split("\n")
      .find((l) => / implement\.done → review$/.test(l));
    expect(done).toBeDefined();
    const sha = (done as string).split(" ")[0] as string;
    const files = sh(wt(), ["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean).sort();
    expect(files).toEqual([HANDOFF, "src/feature.ts"]);
    const trailers = sh(wt(), ["show", "-s", "--format=%(trailers:only,unfold)", sha]);
    // S4: the story's trailers (no Norn-Slice on a story unit)
    expect(trailers).toContain("Norn-Story: gh-9");
    expect(trailers).toContain("Norn-Step: implement");
    expect(trailers).toMatch(/^Norn-Tick: [0-9A-HJKMNP-TV-Z]{26}$/m);
    expect(trailers).not.toContain("Norn-Slice:");
    // no commit on the branch ever carried a run-state file
    const all = sh(wt(), ["log", "--name-only", "--format=", "origin/main..HEAD"]).split("\n").filter(Boolean);
    expect(all.filter((p) => p.includes("/runs/") && p !== HANDOFF)).toEqual([]);
  });
});

describe("a worktree is disposable (B2, B3)", () => {
  const SPEC10 = ".agents/specs/gh-10-ask-me";
  const wt10 = () => `${h.root}-worktrees/gh-10-ask-me`;
  const runs10 = () => runStateOf(join(h.root, SPEC10));
  const asked = async () => {
    const inbox = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; step: string | null; title: string }>> };
    return Object.values(inbox.groups)
      .flat()
      .filter((i) => i.story === "gh-10");
  };

  test("setup: gh-10 parked on an ask", async () => {
    h.remote.issues = [...h.remote.issues, issue(10, "Ask me")];
    await h.tick("--sync");
    await tickUntil(() => h.state(runs10())?.step === "implement");
    expect((await inWt(wt10(), "brief")).exit).toBe(0);
    await tick();
    expect((await inWt(wt10(), "ask", "Which colour?")).exit).toBe(0);
    await tickUntil(() => h.state(runs10())?.status === "parked");
    expect(h.state(runs10())).toMatchObject({ step: "implement", attempt: 1, park: { kind: "ask", reason: "Which colour?" } });
  });

  test("AC2: after `git clean -fdx` in its worktree and a tick, the story is at the same step, attempt and counters", async () => {
    const before = h.state(runs10());
    sh(wt10(), ["clean", "-fdx", "-q"]);
    expect(existsSync(unitMarkerPath(wt10()))).toBe(false);
    // H2: observe reads the unit by the marker its folder and branch name, and writes nothing
    const obs = await observeNow(h);
    expect(obs.facts.unmarked?.map((w) => w.path)).toEqual([wt10()]);
    expect(obs.facts.stories.find((s) => s.key === "gh-10")?.units[0]?.state).toMatchObject({ step: "implement", status: "parked" });
    expect(existsSync(unitMarkerPath(wt10()))).toBe(false);
    // act writes it back, as a traced decision
    const r = await tick();
    expect(r.decisions.filter((d) => d.rule === "worktree.marker")).toMatchObject([{ unit: "*", kind: "restore_markers", ok: true }]);
    expect(h.read(unitMarkerPath(wt10()))).toContain("story=gh-10");
    expect((await tick()).decisions.map((d) => d.rule)).not.toContain("worktree.marker");
    const after = h.state(runs10());
    expect(after).toMatchObject({ step: before?.step, attempt: before?.attempt, counters: before?.counters ?? {}, status: "parked", park: { kind: "ask" } });
  });

  test("AC6: `uncommitted` counts the unit's handoff only: never a run-state file, never the agent's files of a live session (D8)", async () => {
    const uncommitted = async () => (await observeNow(h)).facts.stories.find((s) => s.key === "gh-10")?.units[0]?.uncommitted;
    expect(await uncommitted()).toBe(false);
    // run state in the machine dir is never in git
    writeFileSync(join(runs10(), "evidence-note.txt"), "x\n");
    // the agent's work is dirty all through a session; recover.commit must not commit it under the agent
    h.write(join(wt10(), "src/wip.ts"), "export const wip = 1;\n");
    expect(await uncommitted()).toBe(false);
    const handoff = join(wt10(), SPEC10, "runs/_story/handoff.md");
    const text = h.read(handoff);
    writeFileSync(handoff, `${text}\nmore\n`);
    expect(await uncommitted()).toBe(true);
    writeFileSync(handoff, text);
    rmSync(join(runs10(), "evidence-note.txt"));
    rmSync(join(wt10(), "src"), { recursive: true });
    expect(await uncommitted()).toBe(false);
  });

  test("AC3: the story worktree removed while parked on an ask, `norn story start` recreates it: status shows the same ask, same attempt", async () => {
    const before = await asked();
    expect(before.some((i) => i.title.includes("Which colour?"))).toBe(true);
    sh(h.root, ["worktree", "remove", "--force", wt10()]);
    expect(existsSync(wt10())).toBe(false);
    const r = await h.norn("story", "start", "gh-10", "--json");
    // an ask is nothing a person starts: refused, but only once the worktree is back
    expect(r.value).toMatchObject({ code: "nothing_to_open" });
    expect(existsSync(wt10())).toBe(true);
    expect(sh(wt10(), ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("gh-10-ask-me");
    await tick();
    expect(h.state(runs10())).toMatchObject({ step: "implement", attempt: 1, status: "parked", park: { kind: "ask", reason: "Which colour?" } });
    const same = (xs: Array<{ id?: string; step: string | null; title: string }>) => xs.map((i) => ({ id: i.id, step: i.step, title: i.title }));
    expect(same(await asked())).toEqual(same(before));
  });

  test("AC4: a receipt in the machine dir that fails validation makes gh-10 corrupt (S2), and gh-9 is not", async () => {
    writeFileSync(join(runs10(), "receipts", "0099-done.json"), "{}\n");
    const r = await tick();
    expect(r.decisions.find((d) => d.unit === "gh-10")?.rule).toBe("unit.corrupt");
    expect(r.decisions.filter((d) => d.unit === "gh-9").map((d) => d.rule)).not.toContain("unit.corrupt");
    await tick();
    expect(h.state(runs10())?.status).toBe("corrupt");
    expect(h.state(runs())?.status).not.toBe("corrupt");
  });
});

describe("parallel slices and a crash between a receipt and state (B4: S3, S6)", () => {
  const SPEC11 = ".agents/specs/gh-11-two-parts";
  const wt11 = () => `${h.root}-worktrees/gh-11-two-parts`;
  const story11 = () => runStateOf(join(h.root, SPEC11));
  const part = (nn: string) => runStateOf(join(h.root, SPEC11), `${nn}-part-${nn === "01" ? "a" : "b"}`);
  const sliceWt = (nn: string) => `${wt11()}--${nn}-part-${nn === "01" ? "a" : "b"}`;

  test("AC5: two slices running at once each write only their own <machine dir>/runs/gh-11/<nn>-<slug>/ (S3)", async () => {
    h.remote.issues = [...h.remote.issues, issue(11, "Two parts", ["norn", "norn:wf:split"])];
    await h.tick("--sync");
    await tickUntil(() => h.state(story11())?.step === "plan");
    expect((await inWt(wt11(), "brief")).exit).toBe(0);
    await tick();
    for (const [nn, slug] of [["01", "part-a"], ["02", "part-b"]] as const)
      h.write(join(wt11(), SPEC11, `slices/${nn}-${slug}.md`), `---\nid: gh-11/${nn}\ntitle: Part ${nn}\nworkflow: part\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n`);
    expect((await inWt(wt11(), "done", "done", "--handoff", "two slices")).exit).toBe(0);
    await tickUntil(() => h.state(part("01"))?.step === "build" && h.state(part("02"))?.step === "build");
    const receipts = (nn: string) => (existsSync(join(part(nn), "receipts")) ? readdirSync(join(part(nn), "receipts")).sort() : []);
    const before = { a: receipts("01"), b: receipts("02") };
    for (const nn of ["01", "02"]) expect((await inWt(sliceWt(nn), "brief")).exit).toBe(0);
    for (const nn of ["01", "02"]) expect((await inWt(sliceWt(nn), "done", "done", "--handoff", `built ${nn}`)).exit).toBe(0);
    const a = receipts("01").filter((f) => !before.a.includes(f));
    const b = receipts("02").filter((f) => !before.b.includes(f));
    expect(a.some((f) => f.endsWith("-done.json"))).toBe(true);
    expect(b.some((f) => f.endsWith("-done.json"))).toBe(true);
    for (const [nn, added] of [["01", a], ["02", b]] as const)
      for (const f of added) expect(JSON.parse(h.read(join(part(nn), "receipts", f)))).toMatchObject({ slice: `gh-11/${nn}` });
    // the slice worktrees carry only their handoffs
    for (const nn of ["01", "02"]) onlyWorkAndHandoff(sliceWt(nn), `${SPEC11}/runs/${nn}-part-${nn === "01" ? "a" : "b"}/handoff.md`);
  });

  test("AC5: a receipt written but its state.json not (a crash between them) is re-applied by the next tick (S6)", async () => {
    // the done receipts above are on disk, state.json not yet past them: the crash point
    const st = h.state(part("01"));
    expect(st?.step).toBe("build");
    await tickUntil(() => h.state(part("01"))?.step === "$done" && h.state(part("02"))?.step === "$done");
    expect(h.state(part("01"))?.applied_through).toBeGreaterThan(st?.applied_through ?? 0);
  });

  test("AC5: a tick while a detached check run is writing its receipt waits; a crash's leftovers are ignored; the next tick applies the receipt once (S1, S6)", async () => {
    const SPEC12 = ".agents/specs/gh-12-held-check";
    const runs12 = () => runStateOf(join(h.root, SPEC12));
    const go = join(h.dir, "go-12");
    h.write(join(workflowsDir(h.root), "held.yaml"), `name: held\nstart: test\nsteps:\n  test:\n    type: check\n    run: "while [ ! -f '${go}' ]; do sleep 0.05; done"\n    timeout: 1m\n    outcomes: { pass: $done, fail: $stuck }\n`);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "held workflow"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [...h.remote.issues, issue(12, "Held check", ["norn", "norn:wf:held"])];
    await h.tick("--sync");
    const rules12 = (r: TickReport) => r.decisions.filter((d) => d.unit === "gh-12").map((d) => d.rule);
    // a tick that does not wait for the check runs it started (h.tick does): the check stays running
    const tickNow = async (): Promise<TickReport> => {
      h.clock.advance(10_000);
      const r = await h.norn("tick");
      expect(r.exit).toBe(0);
      return r.value as TickReport;
    };
    let seen: string[] = [];
    for (let i = 0; i < 8 && !seen.includes("check.running"); i++) seen = rules12(await tickNow());
    expect(seen).toContain("check.running");
    const st = h.state(runs12());
    expect(st).toMatchObject({ step: "test", status: "ready" });
    const n = String((st?.applied_through ?? 0) + 1).padStart(4, "0");
    const receipts = join(runs12(), "receipts");
    mkdirSync(receipts, { recursive: true });
    // the check run mid-write: its reservation taken, its receipt not there yet (S6); a crashed earlier
    // writer left a half-written temp receipt and a half-written temp state.json (S1)
    writeFileSync(join(receipts, `.${n}.reserve`), "01M6CRASHED0000000000000000\n");
    writeFileSync(join(receipts, `.${n}-check.json.1.1.0.tmp`), '{"kind":"che');
    writeFileSync(join(runs12(), ".state.json.1.1.0.tmp"), '{"version":1,"st');
    expect(rules12(await tickNow())).toEqual(["check.running"]);
    expect(h.state(runs12())).toMatchObject({ step: "test", status: "ready", applied_through: st?.applied_through });
    rmSync(join(receipts, `.${n}.reserve`));
    // the check finishes: its receipt lands in the machine dir, state.json not yet past it
    writeFileSync(go, "");
    const checkReceipts = () => readdirSync(receipts).filter((f) => /^\d{4}-check\.json$/.test(f));
    await h.checksDone();
    expect(checkReceipts()).toEqual([`${n}-check.json`]);
    expect(h.state(runs12())).toMatchObject({ step: "test", applied_through: st?.applied_through });
    await tickUntil(() => h.state(runs12())?.step === "$done");
    const done = h.state(runs12());
    expect(done).toMatchObject({ last_outcome: { outcome: "pass" }, applied_through: Number(n) });
    // applied once: a later tick neither applies it again nor runs the check again
    const later = await tick();
    expect(rules12(later)).not.toContain("check.run");
    expect(h.state(runs12())?.applied_through).toBe(Number(n));
    expect(checkReceipts()).toEqual([`${n}-check.json`]);
  });
});
