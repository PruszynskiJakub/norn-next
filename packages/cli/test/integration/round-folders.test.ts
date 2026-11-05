/**
 * gh-71 B30, B31, B34 (D2, D7): the story's record lives in `_story/rounds/01-<workflow>/` of its run state,
 * in the checkout's machine dir (S12, gh-195/05), with one story handoff in the worktree (`handoffs/_story.md`, gh-195/07); a story
 * whose record is still flat is moved there by its holder's first tick, with nothing committed, and goes on
 * where it was.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STORY_UNIT_DIR, unitHandoffPath } from "@norn/schema";
import { handoffPath, repoConfigPath, workflowsDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

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
const CONFIG = `provider: gh
workflow: duo
mode: manual
`;

let h: Harness;
const BRANCH = "gh-9-round-thing";
const spec = `.agents/specs/${BRANCH}`;
const wt = () => `${h.root}-worktrees/${BRANCH}`;
/** S12: the story unit's run state, in the machine dir */
const story = () => join(storyRunStateOf(join(wt(), spec)), "_story");
/** the story's handoff, in the worktree (gh-195/07: `handoffs/_story.md`) */
const handoff = () => handoffPath(join(wt(), spec), STORY_UNIT_DIR);
const round1 = () => join(story(), "rounds", "01-duo");
const inWt = (...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd: wt(), env });
};
const ls = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const git = (...args: string[]) => h.git(["-C", wt(), ...args]).trim();
async function tickUntil(pred: () => boolean, max = 10) {
  for (let i = 0; i < max && !pred(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(pred()).toBe(true);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Round thing")];
});
afterAll(() => h.cleanup());

describe("a new story's record is round 1 (B30, B31)", () => {
  let runId = "";

  test("AC1: state, pinned workflow, receipts from 0001 and evidence sit in rounds/01-duo/ of the machine dir; the worktree and the branch hold no runs/, only the story's handoff", async () => {
    await tickUntil(() => h.state(round1())?.step === "implement");
    const brief = await inWt("brief", "--json");
    expect(brief.exit).toBe(0);
    runId = (brief.value as { run_id: string }).run_id;
    expect((brief.value as { brief: { inputs: Array<{ kind: string; ref: string }> } }).brief.inputs).toContainEqual(expect.objectContaining({ ref: `${spec}/${unitHandoffPath(STORY_UNIT_DIR)}` }));
    const ev = join(h.root, "..", "ev-ac1");
    mkdirSync(ev, { recursive: true });
    writeFileSync(join(ev, "AC1.md"), "seen\n");
    expect((await inWt("done", "done", "--handoff", "built it", "--evidence", ev)).exit).toBe(0);
    await tickUntil(() => h.state(round1())?.step === "review");

    expect(ls(story())).toEqual(["rounds"]);
    expect(ls(join(story(), "rounds"))).toEqual(["01-duo"]);
    expect(ls(round1())).toEqual(["evidence", "receipts", "state.json", "workflow.yaml"]);
    expect(ls(join(round1(), "receipts"))[0]).toStartWith("0001-");
    expect(ls(join(round1(), "evidence", runId))).toEqual(["AC1.md"]);
    expect(h.state(round1())).toMatchObject({ workflow: "duo", step: "review" });
    // gh-195/05 (B2), gh-195/07 (B39): the worktree and the pushed branch hold the handoff, and no runs/
    expect(existsSync(join(wt(), spec, "runs"))).toBe(false);
    expect(git("ls-tree", "-r", "--name-only", `origin/${BRANCH}`, "--", spec).split("\n")).toEqual([`${spec}/${unitHandoffPath(STORY_UNIT_DIR)}`, `${spec}/spec.md`]);
  });

  test("AC2: the handoff is handoffs/_story.md, and its Goal / Progress / Resume survive the step's report", async () => {
    const file = handoff();
    const before = h.read(file);
    const body = before.replace(/## Goal\n[\s\S]*$/, "## Goal\nShip the round thing.\n\n## Progress\n- first milestone\n\n## Resume\nRun the review.\n");
    h.write(file, body);
    expect((await inWt("brief", "--json")).exit).toBe(0);
    expect((await inWt("done", "changes_requested", "--handoff", "one blocker", "--findings", writeFindings())).exit).toBe(0);
    await tickUntil(() => h.state(round1())?.step === "implement");
    const after = h.read(file);
    expect(after).toContain("## Goal\nShip the round thing.");
    expect(after).toContain("- first milestone");
    expect(after).toContain("- review#1 changes_requested: one blocker");
    expect(after).toContain("## Resume\nRun the review.");
    expect(existsSync(join(round1(), "handoff.md"))).toBe(false);
  });
});

function writeFindings(): string {
  const f = join(h.root, "..", "findings-ac2.json");
  writeFileSync(f, JSON.stringify([{ id: "F1", severity: "blocking", title: "missing test", detail: "AC1 has no test", file: "src/x.ts", line: 1 }]));
  return f;
}

describe("a flat record moves into round 1 (B34), in the machine dir (S12)", () => {
  let flatHead = "";
  let flatState: unknown;
  const slice = () => runStateOf(join(wt(), spec), "01-x");
  const sliceFile = () => join(slice(), "note.md");

  test("setup: the story's record laid out flat, as an older norn wrote it, with a slice folder beside it", () => {
    for (const name of ls(round1())) renameSync(join(round1(), name), join(story(), name));
    rmSync(join(story(), "rounds"), { recursive: true, force: true });
    mkdirSync(slice(), { recursive: true });
    writeFileSync(sliceFile(), "slice record\n");
    flatHead = git("rev-parse", "HEAD");
    mkdirSync(join(story(), "logs"), { recursive: true });
    writeFileSync(join(story(), "logs", "01OLDCHECK.log"), "check output\n");
    flatState = h.state(story());
    expect(flatState).toMatchObject({ step: "implement", counters: { review_loop: 1 } });
    expect(ls(story())).toEqual(["evidence", "logs", "receipts", "state.json", "workflow.yaml"]);
  });

  test("AC3: the first tick moves everything into rounds/01-duo/, committing nothing; the story goes on at its step", async () => {
    h.clock.advance(10_000);
    const r = await h.tick();
    const mine = r.decisions.filter((d) => d.unit === "gh-9" && d.rule !== "claim.renew");
    expect(mine.map((d) => d.rule)).toEqual(["round.migrate"]);

    expect(git("rev-parse", "HEAD")).toBe(flatHead);
    expect(git("status", "--porcelain")).toBe("");

    expect(ls(story())).toEqual(["rounds"]);
    expect(h.state(round1())).toEqual(flatState as never);
    expect(h.read(join(round1(), "logs", "01OLDCHECK.log"))).toBe("check output\n");
    // slice folders are untouched
    expect(ls(slice())).toEqual(["note.md"]);
    expect(h.read(sliceFile())).toBe("slice record\n");
    // paths the receipts carry are relative to the round, so they still resolve
    const withEvidence = ls(join(round1(), "receipts"))
      .map((n) => JSON.parse(h.read(join(round1(), "receipts", n))) as { evidence?: string })
      .filter((x) => x.evidence);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const x of withEvidence) expect(existsSync(join(round1(), x.evidence as string))).toBe(true);
  });

  test("the story goes on: the next tick decides at implement, round 1, counters unchanged", async () => {
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.decisions.filter((d) => d.unit === "gh-9").map((d) => d.rule)).not.toContain("round.migrate");
    expect(h.state(round1())).toMatchObject({ step: "implement", counters: { review_loop: 1 } });
    const status = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; step: string | null }>> };
    expect(Object.values(status.groups).flat().find((i) => i.story === "gh-9")).toMatchObject({ step: "implement" });
  });
});

describe("a move into round 1 that stopped partway is finished by the next round.migrate (B34, S5)", () => {
  let flatState: unknown;

  test("setup: flat again, then a move stopped after evidence/ and receipts/, and a file written to the flat evidence/ after", () => {
    for (const name of ls(round1())) renameSync(join(round1(), name), join(story(), name));
    rmSync(join(story(), "rounds"), { recursive: true, force: true });
    flatState = h.state(story());
    mkdirSync(round1(), { recursive: true });
    for (const name of ["evidence", "receipts"]) renameSync(join(story(), name), join(round1(), name));
    const run = ls(join(round1(), "evidence"))[0] as string;
    mkdirSync(join(story(), "evidence", run), { recursive: true });
    writeFileSync(join(story(), "evidence", run, "late.md"), "written after the stop\n");
    expect(ls(story())).toEqual(["evidence", "logs", "rounds", "state.json", "workflow.yaml"]);
  });

  test("the story still reads as flat at its step, and the next tick moves what is left, state last, committing nothing", async () => {
    const status = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; step: string | null }>> };
    expect(Object.values(status.groups).flat().find((i) => i.story === "gh-9")).toMatchObject({ step: "implement" });
    const head = git("rev-parse", "HEAD");
    h.clock.advance(10_000);
    const r = await h.tick();
    const mine = r.decisions.filter((d) => d.unit === "gh-9" && d.rule !== "claim.renew");
    expect(mine.map((d) => d.rule)).toEqual(["round.migrate"]);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain")).toBe("");
    expect(ls(story())).toEqual(["rounds"]);
    expect(ls(round1())).toEqual(["evidence", "logs", "receipts", "state.json", "workflow.yaml"]);
    expect(h.state(round1())).toEqual(flatState as never);
    const run = ls(join(round1(), "evidence"))[0] as string;
    expect(ls(join(round1(), "evidence", run))).toContain("late.md");
    expect(ls(join(round1(), "evidence", run)).length).toBeGreaterThan(1);
  });
});

describe("an old flat record merged into the base stays flat and reads as round 1 (B36)", () => {
  const OLD = ".agents/specs/gh-1-projects-and-items";
  let head = "";

  test("setup: a story an older norn finished, its flat record merged into main", () => {
    cpSync(join(import.meta.dir, "../../../view/test/integration/fixtures/gh-1/spec"), join(h.root, OLD), { recursive: true });
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "merge gh-1 (older norn)"]);
    h.git(["push", "-q", "origin", "main"]);
    head = h.git(["rev-parse", "HEAD"]).trim();
  });

  test("AC5: run list and run view read it as its one round; nothing is written to the base or the record", async () => {
    const list = await h.norn("run", "list", "gh-1", "--json");
    expect(list.exit).toBe(0);
    expect(JSON.stringify(list.value)).toContain('"refine"');
    const view = await h.norn("run", "view", "gh-1", "--json");
    expect(view.exit).toBe(0);
    expect(JSON.stringify(view.value)).toContain('"$done"');
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.decisions.filter((d) => d.unit === "gh-1").map((d) => d.rule)).not.toContain("round.migrate");

    expect(existsSync(join(h.root, OLD, "runs/_story/rounds"))).toBe(false);
    expect(existsSync(join(h.root, OLD, "runs/_story/state.json"))).toBe(true);
    expect(h.git(["status", "--porcelain", "--", OLD]).trim()).toBe("");
    expect(h.git(["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(h.git(["rev-parse", "origin/main"]).trim()).toBe(head);
  });
});
