/**
 * An open story an older norn ran keeps its run state in `<spec folder>/runs/` on
 * its branches; the holder's first tick moves each unit's record into the machine dir and removes it
 * from each branch in one move commit, and the story goes on at the same step and attempt. gh-195/07
 * (B8, B39, D13 step 2): each unit's old `runs/<unit>/handoff.md` moves to `handoffs/<unit>.md` in that
 * commit, its generated blocks gone and its prose as written.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STORY_UNIT_DIR, unitHandoffPath } from "@norn/schema";
import { handoffPath, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh, toBranchRunState } from "../../../../test/support/harness.ts";
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
/** a unit's handoff as a ref's tree holds it (`handoffs/<unit>.md`) */
const handoffAt = (cwd: string, ref: string, spec: string, unit: string = STORY_UNIT_DIR) => sh(cwd, ["show", `${ref}:${spec}/${unitHandoffPath(unit)}`]);

/** A duo story taken to implement attempt 2 (a review sent it back once: review_loop 1). */
async function storyAtRework(n: number, slug: string, title: string) {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = h.worktree(`gh-${n}-${slug}`);
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
    h.write(handoffPath(join(s.wt, s.spec), STORY_UNIT_DIR), "## Goal\n\nKeep it local.\n\n## Notes\n\n- built it\n\n## Resume\n\nreview it\n");
    const prose = h.read(handoffPath(join(s.wt, s.spec), STORY_UNIT_DIR));
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
    // one commit removes runs/ from the branch and moves the handoff to handoffs/, pushed
    expect(sh(s.wt, ["rev-list", "--count", `${old}..HEAD`])).toBe("1");
    expect(subject(s.wt)).toBe("norn: move gh-9 run state off the branch");
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([]);
    const changed = sh(s.wt, ["show", "--name-status", "--format=", "HEAD"]).split("\n").filter(Boolean);
    const handoff = `${s.spec}/${unitHandoffPath(STORY_UNIT_DIR)}`;
    expect(changed.filter((l) => !l.startsWith("D\t"))).toEqual([`A\t${handoff}`]);
    expect(changed.filter((l) => l.startsWith("D\t")).every((l) => l.includes(`${s.spec}/runs/_story/`))).toBe(true);
    expect(changed).toContain(`D\t${s.spec}/runs/_story/handoff.md`);
    // The older norn's header and heartbeat blocks are gone, the written part as it was
    expect(prose).toContain("- built it");
    expect(handoffAt(s.wt, "HEAD", s.spec)).toBe(prose.trimEnd());
    expect(sh(s.wt, ["show", `${old}:${s.spec}/runs/_story/handoff.md`])).toContain("norn:header:begin");
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
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin", interrupted: "after copy" });
    writeFileSync(join(s.runs(), "marker.txt"), "the copy\n");
    const old = sh(s.wt, ["rev-parse", "HEAD"]);

    const r = await tick();
    expect(rulesOf(r, "gh-13")).toEqual(["record.move"]);
    // the copy already there is kept as it is, not copied again
    expect(h.state(s.runs())).toEqual(before);
    expect(h.read(join(s.runs(), "marker.txt"))).toBe("the copy\n");
    expect(sh(s.wt, ["rev-list", "--count", `${old}..HEAD`])).toBe("1");
    expect(subject(s.wt)).toBe("norn: move gh-13 run state off the branch");
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([]);
    expect(handoffAt(s.wt, "HEAD", s.spec)).not.toContain("norn:");
  });

  test("AC3: a file in the branch's runs/ that fails validation makes the unit corrupt and removes nothing", async () => {
    const s = await storyAtRework(14, "bad-receipt", "Bad receipt");
    toBranchRunState(s.wt, s.spec, "_story", { broken: true });
    const head = sh(s.wt, ["rev-parse", "HEAD"]);
    const files = treeRuns(s.wt, "HEAD", s.spec);

    const r = await tick();
    expect(rulesOf(r, "gh-14")).toEqual(["unit.corrupt"]);
    await tick();
    expect(sh(s.wt, ["rev-parse", "HEAD"])).toBe(head);
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual(files);
    // nothing removed from the worktree, nothing written into the branch's record
    expect(sh(s.wt, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    expect(h.state(s.runs())).toBeNull();
    const inbox = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; title: string }>> };
    expect(
      Object.values(inbox.groups)
        .flat()
        .some((i) => i.story === "gh-14" && i.title.startsWith("corrupt:")),
    ).toBe(true);
  });

  /** after a move that stopped partway: exactly one move commit on top of `old`, pushed, the worktree clean, the story where it was */
  const finished = (s: Awaited<ReturnType<typeof storyAtRework>>, key: string, old: string, before: unknown) => {
    expect(sh(s.wt, ["rev-list", "--count", `${old}..HEAD`])).toBe("1");
    expect(subject(s.wt)).toBe(`norn: move ${key} run state off the branch`);
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([]);
    expect(handoffAt(s.wt, "HEAD", s.spec)).toContain("## Resume");
    expect(handoffAt(s.wt, "HEAD", s.spec)).not.toContain("norn:");
    expect(sh(s.wt, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["rev-parse", `origin/${s.branch}`])).toBe(sh(s.wt, ["rev-parse", "HEAD"]));
    expect(h.state(s.runs())).toEqual(before as NonNullable<ReturnType<Harness["state"]>>);
  };

  test("S1: a move that stopped after deleting runs/ but before its commit is finished by the next tick in one move commit", async () => {
    const s = await storyAtRework(16, "crashed-move", "Crashed move");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin", interrupted: "after removal" });
    const old = sh(s.wt, ["rev-parse", "HEAD"]);

    const r = await tick();
    expect(rulesOf(r, "gh-16")).toEqual(["record.move"]);
    finished(s, "gh-16", old, before);
    expect(rulesOf(await tick(), "gh-16")).not.toContain("record.move");
  });

  test("S1: a move whose commit fails is not done; the next tick commits the removal once", async () => {
    const s = await storyAtRework(17, "failed-commit", "Failed commit");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin" });
    const old = sh(s.wt, ["rev-parse", "HEAD"]);
    // the worktree's commits fail (a pre-commit hook that refuses them)
    const hook = join(h.root, ".git", "hooks", "pre-commit");
    h.write(hook, `#!/bin/sh\ncase "$PWD" in *gh-17-failed-commit*) exit 1;; esac\n`);
    chmodSync(hook, 0o755);

    const r = await tick();
    expect(r.decisions.filter((d) => d.unit === "gh-17")).toMatchObject([{ rule: "record.move", ok: false }]);
    expect(sh(s.wt, ["rev-parse", "HEAD"])).toBe(old);
    rmSync(hook);
    const next = await tick();
    expect(next.decisions.filter((d) => d.unit === "gh-17")).toMatchObject([{ rule: "record.move", ok: true }]);
    finished(s, "gh-17", old, before);
  });

  test("H1: a move waits out a merge in progress in the worktree (a commit it would have deferred), then lands in one commit", async () => {
    const s = await storyAtRework(18, "merging-move", "Merging move");
    const before = h.state(s.runs());
    toBranchRunState(s.wt, s.spec, "_story", { push: "origin", interrupted: "after removal" });
    const old = sh(s.wt, ["rev-parse", "HEAD"]);
    // a merge in progress: another branch adding one file, merged without committing
    const side = join(h.dir, "side-18");
    sh(h.root, ["worktree", "add", "-q", "-b", "side-18", side, old]);
    h.write(join(side, "side.txt"), "side\n");
    sh(side, ["add", "side.txt"]);
    sh(side, ["commit", "-q", "-m", "side"]);
    sh(s.wt, ["merge", "--no-commit", "--no-ff", "-q", "side-18"]);

    const r = await tick();
    expect(rulesOf(r, "gh-18")).toEqual(["record.move_waits"]);
    expect(sh(s.wt, ["rev-parse", "HEAD"])).toBe(old);
    sh(s.wt, ["merge", "--abort"]);
    const next = await tick();
    expect(rulesOf(next, "gh-18")).toEqual(["record.move"]);
    finished(s, "gh-18", old, before);
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
    expect(treeRuns(s.wt, "HEAD", s.spec)).toEqual([]);
    const next = await tick();
    expect(rulesOf(next, "gh-15")).not.toContain("round.migrate");
    expect(h.state(s.runs())).toMatchObject({ step: "implement", attempt: 2, counters: { review_loop: 1 } });
  });
});

describe("a story with slices: each unit's record moves off its own branch (B34)", () => {
  const SPEC = ".agents/specs/gh-11-two-parts";
  const wt = () => h.worktree("gh-11-two-parts");
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
    expect(treeRuns(wt(), "HEAD", SPEC)).toEqual([]);
    expect(handoffAt(wt(), "HEAD", SPEC)).toContain("## Resume");
    SLICES.forEach(([nn, slug], i) => {
      const w = sliceWt(nn, slug);
      expect(subject(w)).toBe(`norn: move gh-11/${nn} run state off the branch`);
      expect(sh(w, ["rev-list", "--count", `${heads[i + 1]}..HEAD`])).toBe("1");
      expect(treeRuns(w, "HEAD", SPEC)).toEqual([]);
      // The slice's handoff is on its own branch, under handoffs/
      expect(handoffAt(w, "HEAD", SPEC, `${nn}-${slug}`)).toContain("## Goal");
      expect(existsSync(join(part(nn, slug), "state.json"))).toBe(true);
    });
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["rev-parse", "origin/gh-11-two-parts"])).toBe(sh(wt(), ["rev-parse", "HEAD"]));

    // the slices go on where they were
    for (const [nn, slug] of SLICES) expect((await inWt(sliceWt(nn, slug), "brief")).exit).toBe(0);
    await tick();
    for (const [nn, slug] of SLICES) expect(h.state(part(nn, slug))).toMatchObject({ step: "build", attempt: 1, status: "running" });
  });

  test("S2: the story's move waits while a slice with a folder on the story branch fails validation on its own branch; nothing is removed", async () => {
    const SPEC19 = ".agents/specs/gh-19-guarded-parts";
    const wt19 = h.worktree("gh-19-guarded-parts");
    const story19 = () => runStateOf(join(wt19, SPEC19));
    const slice19 = `${wt19}--01-part-a`;
    h.remote.issues = [...h.remote.issues, issue(19, "Guarded parts", ["norn", "norn:wf:split"])];
    await h.tick("--sync");
    await tickUntil(() => h.state(story19())?.step === "plan");
    expect((await inWt(wt19, "brief")).exit).toBe(0);
    await tick();
    h.write(join(wt19, SPEC19, "slices/01-part-a.md"), "---\nid: gh-19/01\ntitle: Part 01\nworkflow: part\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    expect((await inWt(wt19, "done", "done", "--handoff", "one slice")).exit).toBe(0);
    await tickUntil(() => h.state(runStateOf(join(wt19, SPEC19), "01-part-a"))?.step === "build");
    // an older norn's copy of the slice's record on the story branch, and a broken one on the slice branch
    toBranchRunState(wt19, SPEC19, "01-part-a", { interrupted: "after copy" });
    toBranchRunState(slice19, SPEC19, "01-part-a", { broken: true });
    toBranchRunState(wt19, SPEC19, "_story");
    const heads = [sh(wt19, ["rev-parse", "HEAD"]), sh(slice19, ["rev-parse", "HEAD"])];
    const storyFiles = treeRuns(wt19, "HEAD", SPEC19);

    const r = await tick();
    expect(rulesOf(r, "gh-19")).toEqual(["record.move_waits"]);
    expect(rulesOf(r, "gh-19/01")).toEqual(["unit.corrupt"]);
    expect([sh(wt19, ["rev-parse", "HEAD"]), sh(slice19, ["rev-parse", "HEAD"])]).toEqual(heads);
    expect(treeRuns(wt19, "HEAD", SPEC19)).toEqual(storyFiles);
    expect(storyFiles.some((f) => f.includes("/runs/01-part-a/") && !f.endsWith("/handoff.md"))).toBe(true);
    for (const w of [wt19, slice19]) expect(sh(w, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
  });
});
