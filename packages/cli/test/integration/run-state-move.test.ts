/**
 * gh-195/06 (B34, D13): an open story an older norn ran keeps its run state in `<spec folder>/runs/` on
 * its branches; the holder's first tick moves each unit's record into the machine dir and removes it
 * from each branch in one move commit, and the story goes on at the same step and attempt.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { treeUnitRunStateDir, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh, toBranchRunState } from "../../../../test/support/harness.ts";
import { observeNow } from "../../../../test/support/observe-now.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

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
      approve: { to: $done, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
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
const rulesOf = (r: TickReport, unit: string) => r.decisions.filter((d) => d.unit === unit).map((d) => d.rule);
/** the files under `<spec>/runs` a ref's tree holds */
const treeRuns = (cwd: string, ref: string, spec: string) =>
  sh(cwd, ["ls-tree", "-r", "--name-only", ref, "--", `${spec}/runs`])
    .split("\n")
    .filter(Boolean);
const subject = (cwd: string, ref = "HEAD") => sh(cwd, ["log", "-1", "--format=%s", ref]);

/** A duo story taken to implement attempt 2 (a review sent it back once: review_loop 1). */
async function storyAtRework(n: number, slug: string, title: string) {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = `${h.root}-worktrees/gh-${n}-${slug}`;
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, title)];
  await h.tick("--sync");
  await tickUntil(() => h.state(runs())?.step === "implement");
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  h.write(join(wt, "src", `f${n}.ts`), "export const x = 1;\n");
  expect((await inWt(wt, "done", "done", "--handoff", "built it")).exit).toBe(0);
  await tickUntil(() => h.state(runs())?.step === "review");
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  expect((await inWt(wt, "done", "changes_requested", "--handoff", "one more thing")).exit).toBe(0);
  await tickUntil(() => h.state(runs())?.step === "implement" && h.state(runs())?.status === "ready");
  expect(h.state(runs())).toMatchObject({ attempt: 2, counters: { review_loop: 1 } });
  return { spec, wt, branch: `gh-${n}-${slug}`, runs };
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
});
afterAll(() => h.cleanup());

describe("an open story's run state moves off its branch at the holder's first tick (B34)", () => {
  test("AC1: gh-9's runs/ on its branch moves into the machine dir in one pushed commit; same step, attempt and counters", async () => {
    const s = await storyAtRework(9, "keep-it-local", "Keep it local");
    const before = h.state(s.runs());
    const receipts = readdirSync(join(s.runs(), "receipts")).sort();
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin" });
    expect(existsSync(storyRunStateOf(join(s.wt, s.spec)))).toBe(true);
    expect(h.state(s.runs())).toBeNull();
    const old = sh(s.wt, ["rev-parse", "HEAD"]);
    expect(treeRuns(s.wt, "HEAD", s.spec).length).toBeGreaterThan(1);

    const r = await tick();
    expect(rulesOf(r, "gh-9")).toEqual(["record.move"]);
    // the record is in the machine dir, as it was
    expect(h.state(s.runs())).toEqual(before);
    expect(s.runs()).toEndWith("runs/gh-9/_story/rounds/01-duo");
    expect(readdirSync(join(s.runs(), "receipts")).sort()).toEqual(receipts);
    // one commit removes runs/ from the branch (the handoff stays there until gh-195/07), pushed
    expect(sh(s.wt, ["rev-list", "--count", `${old}..HEAD`])).toBe("1");
    expect(subject(s.wt)).toBe("norn: move gh-9 run state off the branch");
    const handoff = `${s.spec}/runs/_story/handoff.md`;
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([handoff]);
    const changed = sh(s.wt, ["show", "--name-status", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(changed.every((l) => l.startsWith("D\t") && l.includes(`${s.spec}/runs/_story/`))).toBe(true);
    expect(sh(s.wt, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["rev-parse", `origin/${s.branch}`])).toBe(sh(s.wt, ["rev-parse", "HEAD"]));

    // the story goes on where it was
    const next = await tick();
    expect(rulesOf(next, "gh-9")).not.toContain("record.move");
    expect(h.state(s.runs())).toMatchObject({ step: "implement", attempt: 2, counters: { review_loop: 1 }, status: "ready" });
    expect((await inWt(s.wt, "brief")).exit).toBe(0);
    await tick();
    expect(h.state(s.runs())).toMatchObject({ step: "implement", attempt: 2, status: "running" });
  });

  test("AC3: a move interrupted after the copy only finishes the removal", async () => {
    const s = await storyAtRework(13, "half-moved", "Half moved");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin" });
    // the copy landed in the machine dir, runs/ is still on the branch
    const tree = treeUnitRunStateDir(s.wt, { key: "gh-13", spec_dir: s.spec }, "_story");
    cpSync(tree, join(storyRunStateOf(join(s.wt, s.spec)), "_story"), { recursive: true, filter: (src) => !src.endsWith("/handoff.md") });
    writeFileSync(join(s.runs(), "marker.txt"), "the copy\n");
    const old = sh(s.wt, ["rev-parse", "HEAD"]);

    // H2: observe sees the branch's run state with nothing left to copy
    const facts = (await observeNow(h)).facts.stories.find((x) => x.key === "gh-13")?.units[0];
    expect(facts?.branch_record).toEqual({ path: `${s.spec}/runs`, copy: [] });
    expect(facts?.state).toEqual(before);
    const r = await tick();
    expect(rulesOf(r, "gh-13")).toEqual(["record.move"]);
    expect(h.state(s.runs())).toEqual(before);
    expect(h.read(join(s.runs(), "marker.txt"))).toBe("the copy\n");
    expect(sh(s.wt, ["rev-list", "--count", `${old}..HEAD`])).toBe("1");
    expect(subject(s.wt)).toBe("norn: move gh-13 run state off the branch");
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([`${s.spec}/runs/_story/handoff.md`]);
  });

  test("AC3: a file in the branch's runs/ that fails validation makes the unit corrupt (S2) and removes nothing", async () => {
    const s = await storyAtRework(14, "bad-receipt", "Bad receipt");
    toBranchRunState(s.wt, s.spec, "_story");
    const tree = treeUnitRunStateDir(s.wt, { key: "gh-14", spec_dir: s.spec }, "_story");
    const round = join(tree, "rounds", readdirSync(join(tree, "rounds"))[0] as string);
    writeFileSync(join(round, "receipts", "0099-done.json"), "{}\n");
    sh(s.wt, ["add", "-A"]);
    sh(s.wt, ["commit", "-q", "-m", "a broken receipt", "--trailer", "Norn-Tick: 01OLDERNORN0000000000000001"]);
    const head = sh(s.wt, ["rev-parse", "HEAD"]);
    const files = treeRuns(s.wt, "HEAD", s.spec);

    const r = await tick();
    expect(rulesOf(r, "gh-14")).toEqual(["unit.corrupt"]);
    await tick();
    expect(sh(s.wt, ["rev-parse", "HEAD"])).toBe(head);
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual(files);
    expect(existsSync(join(round, "receipts", "0099-done.json"))).toBe(true);
    // nothing is written into the branch's record either
    expect(sh(s.wt, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    expect(h.state(s.runs())).toBeNull();
    const inbox = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; title: string }>> };
    expect(
      Object.values(inbox.groups)
        .flat()
        .some((i) => i.story === "gh-14" && i.title.startsWith("corrupt:")),
    ).toBe(true);
  });

  test("AC4: a flat record on the branch lands in rounds/01-duo/ in the move itself", async () => {
    const s = await storyAtRework(15, "flat-one", "Flat one");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { flat: true, push: "origin" });
    const story = storyRunStateOf(join(s.wt, s.spec));
    expect(existsSync(join(s.wt, s.spec, "runs/_story/state.json"))).toBe(true);

    const r = await tick();
    expect(rulesOf(r, "gh-15")).toEqual(["record.move"]);
    expect(existsSync(join(story, "_story/state.json"))).toBe(false);
    expect(readdirSync(join(story, "_story/rounds"))).toEqual(["01-duo"]);
    expect(s.runs()).toEndWith("runs/gh-15/_story/rounds/01-duo");
    expect(h.state(s.runs())).toEqual(before);
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([`${s.spec}/runs/_story/handoff.md`]);
    const next = await tick();
    expect(rulesOf(next, "gh-15")).not.toContain("round.migrate");
    expect(h.state(s.runs())).toMatchObject({ step: "implement", attempt: 2, counters: { review_loop: 1 } });
  });
});

describe("a story with slices: each unit's record moves off its own branch (B34)", () => {
  const SPEC = ".agents/specs/gh-11-two-parts";
  const wt = () => `${h.root}-worktrees/gh-11-two-parts`;
  const story = () => runStateOf(join(wt(), SPEC));
  const SLICES = [
    ["01", "part-a"],
    ["02", "part-b"],
  ] as const;
  const part = (nn: string, slug: string) => runStateOf(join(wt(), SPEC), `${nn}-${slug}`);
  const sliceWt = (nn: string, slug: string) => `${wt()}--${nn}-${slug}`;

  test("AC2: the story branch and each slice branch lose their runs/ in their own move commit; each record lands in its own folder", async () => {
    h.remote.issues = [...h.remote.issues, issue(11, "Two parts", ["norn", "norn:wf:split"])];
    await h.tick("--sync");
    await tickUntil(() => h.state(story())?.step === "plan");
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    for (const [nn, slug] of SLICES)
      h.write(join(wt(), SPEC, `slices/${nn}-${slug}.md`), `---\nid: gh-11/${nn}\ntitle: Part ${nn}\nworkflow: part\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n`);
    expect((await inWt(wt(), "done", "done", "--handoff", "two slices")).exit).toBe(0);
    await tickUntil(() => SLICES.every(([nn, slug]) => h.state(part(nn, slug))?.step === "build"));
    const before = { story: h.state(story()), parts: SLICES.map(([nn, slug]) => h.state(part(nn, slug))) };
    toBranchRunState(wt(), SPEC, "_story", { push: "origin" });
    for (const [nn, slug] of SLICES) toBranchRunState(sliceWt(nn, slug), SPEC, `${nn}-${slug}`, { push: "origin" });
    const heads = [wt(), ...SLICES.map(([nn, slug]) => sliceWt(nn, slug))].map((p) => sh(p, ["rev-parse", "HEAD"]));

    const r = await tick();
    expect(rulesOf(r, "gh-11")).toEqual(["record.move"]);
    for (const [nn] of SLICES) expect(rulesOf(r, `gh-11/${nn}`)).toEqual(["record.move"]);
    expect(h.state(story())).toEqual(before.story);
    SLICES.forEach(([nn, slug], i) => expect(h.state(part(nn, slug))).toEqual(before.parts[i] as NonNullable<(typeof before.parts)[number]>));
    expect(subject(wt())).toBe("norn: move gh-11 run state off the branch");
    expect(sh(wt(), ["rev-list", "--count", `${heads[0]}..HEAD`])).toBe("1");
    expect(treeRuns(wt(), "HEAD", SPEC)).toEqual([`${SPEC}/runs/_story/handoff.md`]);
    SLICES.forEach(([nn, slug], i) => {
      const w = sliceWt(nn, slug);
      expect(subject(w)).toBe(`norn: move gh-11/${nn} run state off the branch`);
      expect(sh(w, ["rev-list", "--count", `${heads[i + 1]}..HEAD`])).toBe("1");
      expect(treeRuns(w, "HEAD", SPEC).filter((f) => !f.endsWith("/handoff.md"))).toEqual([]);
      expect(existsSync(join(part(nn, slug), "state.json"))).toBe(true);
    });
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["rev-parse", "origin/gh-11-two-parts"])).toBe(sh(wt(), ["rev-parse", "HEAD"]));

    // the slices go on where they were
    for (const [nn, slug] of SLICES) expect((await inWt(sliceWt(nn, slug), "brief")).exit).toBe(0);
    await tick();
    for (const [nn, slug] of SLICES) expect(h.state(part(nn, slug))).toMatchObject({ step: "build", attempt: 1, status: "running" });
  });
});
