/**
 * gh-195/07 (D9; B6, B7, B8, B39): each unit's handoff is `<spec folder>/handoffs/_story.md` or
 * `handoffs/<nn>-<slug>.md`, on that unit's branch, holding only what agents and people write; the
 * status it used to carry is printed by `norn brief` and `norn story checkout`.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORY_UNIT_DIR, unitHandoffPath } from "@norn/schema";
import { handoffPath, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, olderNornHandoffBlocks, runChecked, sh } from "../../../../test/support/harness.ts";
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
/** the files a commit changed */
const filesOf = (cwd: string, sha: string) => sh(cwd, ["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean).sort();
/** the newest commit whose subject ends with `suffix` */
const commitEndingWith = (cwd: string, suffix: string) => {
  const line = sh(cwd, ["log", "--format=%H %s", "-n", "40"])
    .split("\n")
    .find((l) => l.endsWith(suffix));
  if (!line) throw new Error(`no commit ending with ${suffix}`);
  return line.split(" ")[0] as string;
};
/** every path a ref's tree holds under the spec folder */
const treeOf = (cwd: string, ref: string, spec: string) => sh(cwd, ["ls-tree", "-r", "--name-only", ref, "--", spec]).split("\n").filter(Boolean);

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

describe("the story's handoff is handoffs/_story.md, prose only (B6, B7, B8, B39)", () => {
  const SPEC = ".agents/specs/gh-9-prose-only";
  const wt = () => `${h.root}-worktrees/gh-9-prose-only`;
  const runs = () => runStateOf(join(wt(), SPEC));
  const handoff = () => handoffPath(join(wt(), SPEC), STORY_UNIT_DIR);
  const HANDOFF = `${SPEC}/${unitHandoffPath(STORY_UNIT_DIR)}`;
  const PROSE = "## Goal\n\nShip the prose-only handoff.\n\n## Progress\n\n- started\n\n## Resume\n\nRun the review.\n";

  test("AC1, AC2: the first session commits the skeleton at handoffs/_story.md on the story branch; no generated block, no runs/", async () => {
    h.remote.issues = [...h.remote.issues, issue(9, "Prose only")];
    await h.tick("--sync");
    await tickUntil(() => h.state(runs())?.step === "implement");
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    h.git(["fetch", "-q", "origin"]);
    const onBranch = h.git(["show", `origin/gh-9-prose-only:${HANDOFF}`]);
    expect(onBranch.trimEnd()).toBe("## Goal\n\n## Progress\n\n## Resume");
    expect(treeOf(h.root, "origin/gh-9-prose-only", SPEC).filter((p) => p.includes("/runs/"))).toEqual([]);
  });

  test("AC2: an edited handoff is in the boundary commit as written; a boundary that did not edit it leaves it out, and the file never gains a generated block", async () => {
    h.write(handoff(), PROSE);
    h.write(join(wt(), "src/a.ts"), "export const a = 1;\n");
    h.report(runs(), "done", { outcome: "done", handoff: "built a" });
    await tickUntil(() => h.state(runs())?.step === "review");
    const edited = commitEndingWith(wt(), "implement.done → review");
    expect(filesOf(wt(), edited)).toEqual([HANDOFF, "src/a.ts"]);
    expect(sh(wt(), ["show", `${edited}:${HANDOFF}`])).toBe(PROSE.trimEnd());

    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    h.report(runs(), "done", { outcome: "changes_requested", handoff: "one blocker" });
    await tickUntil(() => h.state(runs())?.step === "implement" && h.state(runs())?.attempt === 2);
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    h.write(join(wt(), "src/b.ts"), "export const b = 1;\n");
    h.report(runs(), "done", { outcome: "done", handoff: "fixed it" });
    await tickUntil(() => h.state(runs())?.step === "review" && h.state(runs())?.attempt === 2);
    const untouched = commitEndingWith(wt(), "implement.done → review");
    expect(untouched).not.toBe(edited);
    expect(filesOf(wt(), untouched)).toEqual(["src/b.ts"]);
    expect(h.read(handoff())).toBe(PROSE);
    // B6: no commit on the branch ever put a generated block in the handoff
    for (const sha of sh(wt(), ["log", "--format=%H", "origin/main..HEAD", "--", HANDOFF]).split("\n").filter(Boolean))
      expect(sh(wt(), ["show", `${sha}:${HANDOFF}`])).not.toContain("norn:");
  });

  test("AC3 (B7): at review attempt 2, `norn brief` and `norn story checkout` print the step, the counters and the last outcome above the handoff's written part", async () => {
    const brief = await inWt(wt(), "brief");
    expect(brief.exit).toBe(0);
    const md = brief.stdout;
    const status = ["- Step: review (attempt 2)", "- Counters: review_loop 1/3", "- Last outcome: implement.done (reported, "];
    const context = md.indexOf("## Context");
    for (const line of status) {
      expect(md).toContain(line);
      expect(md.indexOf(line)).toBeLessThan(context);
    }
    expect(md.slice(context)).toContain("Ship the prose-only handoff.");
    await tick();

    const r = await h.norn("story", "checkout", "gh-9", "--json");
    expect(r.exit).toBe(0);
    const unit = (r.value as { units: Array<{ unit: string; handoff: string | null }> }).units.find((u) => u.unit === "gh-9");
    const text = unit?.handoff ?? "";
    expect(text).toContain("Step: review (attempt 2)");
    expect(text).toContain("- Counters: review_loop 1/3");
    expect(text).toContain("- Last outcome: implement.done (reported, ");
    expect(text.indexOf("- Last outcome:")).toBeLessThan(text.indexOf("## Goal"));
    expect(text).toEndWith(PROSE);
    expect(text).not.toContain("norn:");
  });

  test("AC4 (B8): an older norn's header and heartbeat blocks are gone at the unit's next boundary commit; Goal, Progress and Resume are as written", async () => {
    h.write(handoff(), `${olderNornHandoffBlocks("gh-9", STORY_UNIT_DIR)}\n\n${PROSE}`);
    h.report(runs(), "done", { outcome: "approve", handoff: "looks right" });
    await tickUntil(() => h.state(runs())?.step === "$done");
    expect(h.read(handoff())).toBe(PROSE);
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["show", `origin/gh-9-prose-only:${HANDOFF}`])).toBe(PROSE.trimEnd());
  });
});

describe("a slice's handoff is handoffs/<nn>-<slug>.md on the slice branch (B39)", () => {
  const SPEC = ".agents/specs/gh-11-two-handoffs";
  const wt = () => `${h.root}-worktrees/gh-11-two-handoffs`;
  const story = () => runStateOf(join(wt(), SPEC));
  const part = () => runStateOf(join(wt(), SPEC), "01-part-a");
  const sliceWt = () => `${wt()}--01-part-a`;
  const SLICE_HANDOFF = `${SPEC}/${unitHandoffPath("01-part-a")}`;
  const STORY_HANDOFF = `${SPEC}/${unitHandoffPath(STORY_UNIT_DIR)}`;

  test("AC1: the story's handoff is on the story branch, the slice's on the slice branch, and it reaches the story branch with the slice's integration", async () => {
    h.remote.issues = [...h.remote.issues, issue(11, "Two handoffs", ["norn", "norn:wf:split"])];
    await h.tick("--sync");
    await tickUntil(() => h.state(story())?.step === "plan");
    expect((await inWt(wt(), "brief")).exit).toBe(0);
    await tick();
    h.write(join(wt(), SPEC, "slices/01-part-a.md"), "---\nid: gh-11/01\ntitle: Part a\nworkflow: part\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    expect((await inWt(wt(), "done", "done", "--handoff", "one slice")).exit).toBe(0);
    await tickUntil(() => h.state(part())?.step === "build");
    expect((await inWt(sliceWt(), "brief")).exit).toBe(0);
    await tick();
    const slice = handoffPath(join(sliceWt(), SPEC), "01-part-a");
    expect(existsSync(slice)).toBe(true);
    h.write(join(sliceWt(), "src/part-a.ts"), "export const a = 1;\n");
    expect((await inWt(sliceWt(), "done", "done", "--handoff", "part a built")).exit).toBe(0);
    await tick();
    h.git(["fetch", "-q", "origin"]);
    const sliceTree = treeOf(h.root, "origin/gh-11/01-part-a", SPEC);
    expect(sliceTree).toContain(SLICE_HANDOFF);
    expect(sliceTree.filter((p) => p.includes("/runs/"))).toEqual([]);
    expect(h.git(["show", `origin/gh-11/01-part-a:${SLICE_HANDOFF}`])).toContain("- build#1 done: part a built");

    await tickUntil(() => h.read(join(wt(), SPEC, "slices/01-part-a.md")).includes("status: integrated"));
    h.git(["fetch", "-q", "origin"]);
    const storyTree = treeOf(h.root, "origin/gh-11-two-handoffs", SPEC);
    expect(storyTree).toContain(STORY_HANDOFF);
    expect(storyTree).toContain(SLICE_HANDOFF);
    expect(storyTree.filter((p) => p.includes("/runs/"))).toEqual([]);
    expect(h.git(["show", `origin/gh-11-two-handoffs:${SLICE_HANDOFF}`])).toContain("- build#1 done: part a built");
  });
});
