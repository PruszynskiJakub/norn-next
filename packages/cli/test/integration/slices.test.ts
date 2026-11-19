/**
 * A sliced story end to end through the CLI alone: a plan step's agent writes slice files, the slices
 * step starts each in its own worktree cut from the story's branch, every slice walks its own
 * workflow (an agent, a gate, integrate) beside the others, and the story finishes once every slice
 * merged into its branch. Every norn call is a subprocess of the binary from source.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "@norn/store-local";
import { agentNotes, machineOf, type NornOut, norn, plans, setUp, sh, slicesPlanned, status, type StoryShown, type UnitShown, type World, world } from "./world.ts";

const KEY = "lt-1";
const S1 = `${KEY}/01`;
const S2 = `${KEY}/02`;
const SLOW = 240_000;

const SLICED = [
  "name: sliced",
  "start: plan",
  "steps:",
  "  plan:",
  "    agent: Cut the story into slices.",
  "    inputs: [handoff]",
  "    outcomes: { done: slices }",
  "  slices:",
  "    slices:",
  "    outcomes: { done: open-pr, stuck: $stuck }",
  "  open-pr:",
  "    open-pr:",
  "    outcomes: { done: $done }",
  "",
].join("\n");

const PIECE = [
  "name: piece",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build this slice.",
  "    inputs: [slice, handoff]",
  "    outcomes: { done: ready }",
  "  ready:",
  "    gate: Approve the slice.",
  "    outcomes: { approve: integrate, reject: build }",
  "  integrate:",
  "    integrate:",
  "    outcomes: { done: $done, conflict: merge }",
  "  merge:",
  "    agent: Merge the story branch's commit the base_side input names into this slice.",
  "    inputs: [base_side]",
  "    outcomes: { done: integrate }",
  "",
].join("\n");

interface ViewUnit {
  id: string;
  step: string | null;
  kind?: string;
  workflow?: string;
  ended?: string;
}

/** Every unit of the story as `story view --json` lists it. */
async function viewUnits(w: World): Promise<ViewUnit[]> {
  const v = await norn(w, ["story", "view", KEY, "--json"]);
  if (v.code !== 0) throw new Error(`story view: ${v.stdout}${v.stderr}`);
  return (v.body.units ?? []) as ViewUnit[];
}

/** The story as `status --json` shows it, slices and all. */
async function storyShown(w: World): Promise<StoryShown | undefined> {
  return (await status(w)).stories.find((s) => s.key === KEY);
}

const unitIn = (s: StoryShown | undefined, id: string): UnitShown | undefined => s?.units.find((u) => u.id === id);

/** `git worktree list --porcelain` as worktree path → branch. */
async function worktrees(w: World): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let path = "";
  for (const line of (await sh(w.root, "git", "worktree", "list", "--porcelain")).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch ")) out[path] = line.slice("branch refs/heads/".length);
  }
  return out;
}

/** Ticks until `done` holds of the whole story as status shows it. */
async function tickStory(w: World, rules: string[], done: (s: StoryShown | undefined) => boolean, maxMs = 90_000): Promise<void> {
  for (const until = performance.now() + maxMs; performance.now() < until; ) {
    const t = await norn(w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as { decision: { rule: string; unit: string }; ok: boolean }[];
    rules.push(...outcomes.map((o) => `${o.decision.unit} ${o.decision.rule}${o.ok ? "" : "!"}`));
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}\nrules: ${rules.join(", ")}`);
    if (done(await storyShown(w))) return;
    await Bun.sleep(300);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}\nstatus: ${JSON.stringify(await storyShown(w))}`);
}

/** The brief text each run of `unit` noted, in launch order. */
const briefsOf = (w: World, unit: string): string[] =>
  agentNotes(w)
    .filter((n) => n.note === "brief")
    .map((n) => (n.value as { text: string }).text)
    .filter((t) => t.startsWith(`# norn brief — ${unit} ·`));

/** The run ids `unit`'s receipts name, read from its own receipts folder in the machine dir. */
function receiptRuns(machine: string, unit: string): string[] {
  const dir = layout(machine).receipts(unit);
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir).map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { data?: { run_id?: string } }).data?.run_id);
  return [...new Set(runs.filter((r): r is string => r !== undefined))];
}

/** Local branches under `norn/`. */
async function nornBranches(w: World): Promise<string[]> {
  const out = await sh(w.root, "git", "branch", "--list", "--format=%(refname:short)", "norn/*");
  return out === "" ? [] : out.split("\n");
}

describe("two slices from the plan's slice files to the story's branch", () => {
  let w: World;
  let machine = "";
  const rules: string[] = [];
  let atIntake: { stories: StoryShown[]; intake: { key: string }[] };
  let running: StoryShown | undefined;
  let waiting: StoryShown | undefined;
  let trees: Record<string, string> = {};
  let storyHead = "";
  let sliceBase = "";
  let sliceFiles: string[] = [];
  let receipts: Record<string, string[]> = {};
  let updateBranch: NornOut;
  let byStory: NornOut;
  let answered: NornOut;
  let bySlice: NornOut;
  let atGate: StoryShown | undefined;
  let finished: StoryShown | undefined;
  let units: ViewUnit[] = [];
  let viewMd = "";
  let treesAtDone: Record<string, string> = {};
  let treesAtEnd: Record<string, string> = {};
  let branchesAtEnd: string[] = [];
  let storyLog = "";
  let storyFiles: string[] = [];

  beforeAll(async () => {
    w = await world("slice-work");
    const { added } = await setUp(w, { workflows: { sliced: SLICED, piece: PIECE }, config: [["kernel.slice_workflow", "piece"]] });
    machine = machineOf(added);
    plans(w, { plan: "slicer", [`${S1}:build`]: "slice-ask" });
    await norn(w, ["story", "create", "Add the form and the list", "--workflow", "sliced", "--json"]);
    atIntake = await status(w);
    await tickStory(w, rules, (s) => unitIn(s, S1) !== undefined && unitIn(s, S2) !== undefined);
    running = await storyShown(w);
    await tickStory(w, rules, (s) => unitIn(s, S1)?.parked === "agent.asked" && unitIn(s, S2)?.step === "ready" && unitIn(s, S2)?.parked !== undefined);
    waiting = await storyShown(w);
    trees = await worktrees(w);
    storyHead = await sh(w.root, "git", "rev-parse", `norn/${KEY}`);
    sliceBase = await sh(w.root, "git", "merge-base", `norn/${KEY}-01`, `norn/${KEY}`);
    sliceFiles = (await sh(w.root, "git", "ls-tree", "--name-only", `norn/${KEY}-01`)).split("\n");
    receipts = { [KEY]: receiptRuns(machine, KEY), [S1]: receiptRuns(machine, S1), [S2]: receiptRuns(machine, S2) };
    updateBranch = await norn(w, ["story", "update-branch", KEY, "--json"]);
    // only lt-1/02 is at a gate, so the story key lands there and lt-1/01 keeps its question
    byStory = await norn(w, ["story", "approve", KEY, "--json"]);
    answered = await norn(w, ["story", "answer", S1, "Blue."]);
    await tickStory(w, rules, (s) => unitIn(s, S1)?.step === "ready" && unitIn(s, S1)?.parked !== undefined);
    atGate = await storyShown(w);
    bySlice = await norn(w, ["story", "approve", S1, "--json"]);
    await tickStory(w, rules, (s) => s?.units[0]?.ended !== undefined);
    finished = await storyShown(w);
    units = await viewUnits(w);
    viewMd = (await norn(w, ["story", "view", KEY])).stdout;
    treesAtDone = await worktrees(w);
    // the tick after the story's last unit ended done finishes it, then gives up the claim
    const fromFinish = rules.length;
    await tickStory(w, rules, () => rules.slice(fromFinish).some((r) => r.endsWith(" claim.release")));
    treesAtEnd = await worktrees(w);
    branchesAtEnd = await nornBranches(w);
    // the story's local branch went at the finish; open-pr pushed it first
    storyLog = await sh(w.remote, "git", "log", "--format=%s", `norn/${KEY}`);
    storyFiles = (await sh(w.remote, "git", "ls-tree", "--name-only", `norn/${KEY}`)).split("\n");
  }, SLOW);

  test("status shows the story at intake, then its slices running beside the story at its slices step", () => {
    expect(atIntake.intake.map((i) => i.key)).toEqual([KEY]);
    expect(atIntake.stories.find((s) => s.key === KEY)).toBeUndefined();
    expect(running?.units.map((u) => u.id)).toEqual([KEY, S1, S2]);
    expect(unitIn(running, KEY)).toMatchObject({ step: "slices" });
    expect(unitIn(running, S1)).toMatchObject({ step: "build" });
    expect(rules).toEqual(expect.arrayContaining([`${KEY} slices.start`, `${S1} agent.start`, `${S2} agent.start`]));
  });

  test("each slice runs in its own worktree beside the story's, on its own branch cut from the story's head", () => {
    const paths = Object.keys(trees);
    const storyTree = paths.find((p) => p.endsWith(`/worktrees/${KEY}`));
    expect(storyTree).toBeDefined();
    const dir = (storyTree as string).slice(0, -KEY.length);
    expect(trees[`${dir}${KEY}`]).toBe(`norn/${KEY}`);
    expect(trees[`${dir}${KEY}-01`]).toBe(`norn/${KEY}-01`);
    expect(trees[`${dir}${KEY}-02`]).toBe(`norn/${KEY}-02`);
    expect(sliceBase).toBe(storyHead);
    expect(sliceFiles).toContain("plan.txt");
  });

  test("a slice's question and another slice's gate wait side by side, each under its own key", () => {
    expect(unitIn(waiting, KEY)).toMatchObject({ step: "slices", waiting: null });
    expect(unitIn(waiting, S1)).toMatchObject({ step: "build", parked: "agent.asked", waiting: { for: "answer", next: `norn story answer ${S1} "<answer>"` } });
    expect(unitIn(waiting, S2)).toMatchObject({ step: "ready", parked: "gate.park", waiting: { for: "gate", text: "Approve the slice.", next: expect.stringContaining(`norn story approve ${S2}`) } });
  });

  test("two slices at once keep receipts apart, each naming only its own run", () => {
    expect(receipts[S1]).toHaveLength(1);
    expect(receipts[S2]).toHaveLength(1);
    expect(receipts[S1]).not.toEqual(receipts[S2]);
    expect(receipts[KEY]).not.toContain(receipts[S1]?.[0]);
    expect(receipts[KEY]).not.toContain(receipts[S2]?.[0]);
  });

  test("each slice's brief names its own handoff, apart from the story's", () => {
    expect(briefsOf(w, KEY)[0]).toContain(`.agents/specs/${KEY}/handoffs/${KEY}.md`);
    const first = briefsOf(w, S1)[0];
    expect(first).toContain(`.agents/specs/${KEY}/handoffs/${KEY}-01.md`);
    expect(first).not.toContain(`handoffs/${KEY}.md`);
    expect(briefsOf(w, S2)[0]).toContain(`.agents/specs/${KEY}/handoffs/${KEY}-02.md`);
  });

  test("update-branch is refused while the slices run", () => {
    expect(updateBranch.code).toBe(3);
    expect(updateBranch.body).toMatchObject({ code: "round_unfinished", details: { units: [KEY, S1, S2] } });
  });

  test("approve by the story key lands on the one slice at a gate; approve by a slice key decides that slice only", () => {
    expect(byStory).toMatchObject({ code: 0, body: { unit: S2, step: "ready", outcome: "approve", replayed: false } });
    expect(answered).toMatchObject({ code: 0 });
    expect(answered.stdout).toContain(`Answered ${S1} at build`);
    // lt-1/02 integrated while lt-1/01 still waited at its own gate
    expect(unitIn(atGate, S2)).toMatchObject({ ended: "done" });
    expect(unitIn(atGate, S1)).toMatchObject({ step: "ready", parked: "gate.park" });
    expect(unitIn(atGate, KEY)).toMatchObject({ step: "slices" });
    expect(bySlice).toMatchObject({ code: 0, body: { unit: S1, step: "ready", outcome: "approve" } });
  });

  test("once every slice integrated the story moves on to open-pr and finishes; story view lists each slice with its step", () => {
    expect(rules).toContain(`${KEY} slices.done`);
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(unitIn(finished, KEY)).toMatchObject({ step: "open-pr", ended: "done" });
    expect(finished?.change).toMatchObject({ state: "open" });
    expect(units.map((u) => ({ id: u.id, step: u.step, workflow: u.workflow, ended: u.ended }))).toEqual([
      { id: KEY, step: "open-pr", workflow: "sliced", ended: "done" },
      { id: S1, step: "integrate", workflow: "piece", ended: "done" },
      { id: S2, step: "integrate", workflow: "piece", ended: "done" },
    ]);
    expect(viewMd).toContain(`- ${S1}: integrate (integrate), done`);
    expect(viewMd).toContain(`- ${S2}: integrate (integrate), done`);
  });

  test("both slices' files reach the story's branch; the finish removes the slice worktrees and branches", () => {
    // a slice's worktree outlives its integrate: the story's finish removes every done unit's at once
    expect(Object.keys(treesAtDone).filter((p) => p.endsWith(`/worktrees/${KEY}-01`))).toHaveLength(1);
    expect(storyFiles).toEqual(expect.arrayContaining(["form.txt", "list.txt"]));
    expect(storyLog).toContain(`agent: form.txt for ${S1}`);
    expect(storyLog).toContain(`agent: list.txt for ${S2}`);
    expect(storyLog).toContain(`norn/${KEY}-01`);
    expect(storyLog).toContain(`norn/${KEY}-02`);
    expect(branchesAtEnd).toEqual([]);
    expect(Object.keys(treesAtEnd).filter((p) => p.endsWith(`/worktrees/${KEY}-01`) || p.endsWith(`/worktrees/${KEY}-02`))).toEqual([]);
    expect(rules.some((r) => r.endsWith(" story.finish"))).toBe(true);
  });
});

describe("two slices that edit the same file", () => {
  let w: World;
  const rules: string[] = [];
  let merged: string[] = [];
  let atMerge: StoryShown | undefined;
  let finished: StoryShown | undefined;
  let form = "";
  let parents: string[] = [];
  let sliceTipParents: string[] = [];

  beforeAll(async () => {
    w = await world("slice-work");
    await setUp(w, { workflows: { sliced: SLICED, piece: PIECE }, config: [["kernel.slice_workflow", "piece"]] });
    slicesPlanned(w, [{ file: "01-form.md" }, { file: "02-form.md" }]);
    plans(w, { plan: "slicer", merge: "resolve" });
    await norn(w, ["story", "create", "Add the form twice", "--workflow", "sliced", "--json"]);
    await tickStory(w, rules, (s) => unitIn(s, S1)?.parked === "gate.park" && unitIn(s, S2)?.parked === "gate.park");
    await norn(w, ["story", "approve", S1, "--json"]);
    await tickStory(w, rules, (s) => unitIn(s, S1)?.ended === "done");
    await norn(w, ["story", "approve", S2, "--json"]);
    await tickStory(w, rules, (s) => unitIn(s, S2)?.step === "merge" || unitIn(s, S2)?.ended !== undefined);
    atMerge = await storyShown(w);
    await tickStory(w, rules, (s) => s?.units[0]?.ended !== undefined);
    finished = await storyShown(w);
    merged = (agentNotes(w).find((n) => n.note === "conflicts")?.value ?? []) as string[];
    form = await sh(w.root, "git", "show", `norn/${KEY}:form.txt`);
    parents = (await sh(w.root, "git", "rev-list", "--parents", "-n", "1", `norn/${KEY}`)).split(" ").slice(1);
    sliceTipParents = (await sh(w.root, "git", "rev-list", "--parents", "-n", "1", parents[1] as string)).split(" ").slice(1);
  }, SLOW);

  test("the second integrate conflicts and goes to the slice's merge step, which merges the story branch", () => {
    expect(unitIn(atMerge, S2)).toMatchObject({ step: "merge" });
    expect(merged).toEqual(["form.txt"]);
  });

  test("the next integrate succeeds: both slices' lines are on the story's branch and the story finishes", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(unitIn(finished, S1)).toMatchObject({ ended: "done" });
    expect(unitIn(finished, S2)).toMatchObject({ ended: "done" });
    expect(unitIn(finished, KEY)).toMatchObject({ step: "open-pr", ended: "done" });
    expect(form).toContain(`written by ${S1}`);
    expect(form).toContain(`written by ${S2}`);
    // the slice's tip is the merge step's merge of the story's branch as lt-1/01 left it
    expect(parents).toHaveLength(2);
    expect(sliceTipParents).toHaveLength(2);
    expect(sliceTipParents).toContain(parents[0] as string);
  });
});
