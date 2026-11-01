/**
 * Targets and prompts (B54, B56–B60, D2) on `run view` and `run list`: a verb without a target acts
 * on the unit of the worktree it is typed in, an explicit target wins, a terminal elsewhere is offered
 * the units the verb applies to in `norn status` order, and a script or an agent is refused with them.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { repoConfigPath, workflowsDir, storyUnitDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const GATED = `name: gated
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "the change is ready to look at" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: work, counter: loop } }
counters: { loop: { max: 2 } }
`;

const SLICED = `name: sliced
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

const SLICE_QA = `name: sliceqa
start: qa
steps:
  qa:
    type: gate
    prompt: "Try the slice"
    outcomes: { approve: $done, reject: $stuck }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: gated
default_mode: auto
notifiers: []
`;

let h: Harness;
const spec2 = ".agents/specs/gh-2-split-work";
const wt1 = () => `${h.root}-worktrees/gh-1-pay-invoices`;
const wt2 = () => `${h.root}-worktrees/gh-2-split-work`;
const sliceWt = () => `${wt2()}--01-part`;
const storyRuns2 = () => storyUnitDir(join(wt2(), spec2));
const sliceRuns = () => join(sliceWt(), spec2, "runs/01-part");
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
/** `norn …` with these deps over the harness's */
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });
const unitOf = (r: CliResult) => (r.value as { unit?: string }).unit;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "gated.yaml"), GATED);
  h.write(join(workflowsDir(h.root), "sliced.yaml"), SLICED);
  h.write(join(workflowsDir(h.root), "sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("no unit has a run", () => {
  test("refused with the reason, nothing prompted (B59)", async () => {
    for (const verb of ["view", "list"]) {
      const term = new FakeInteraction();
      const r = await norn({ interaction: term }, "run", verb);
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "no_target", error: expect.stringContaining("No unit has a run") });
      expect(term.picks).toEqual([]);
    }
  });
});

describe("one unit has a run", () => {
  test("the pick-list is shown with it preselected; accepting it acts on it (B58)", async () => {
    h.remote.issues = [issue(1, "Pay invoices")];
    for (let i = 0; i < 6 && h.state(storyUnitDir(join(wt1(), ".agents/specs/gh-1-pay-invoices")))?.status !== "running"; i++) await tick();
    const term = new FakeInteraction();
    const r = await norn({ interaction: term }, "run", "view");
    expect(r.exit).toBe(0);
    expect(term.picks).toEqual([{ question: expect.any(String), choices: [{ value: "gh-1", label: expect.stringContaining("gh-1") }], preselect: 0 }]);
    expect(r.stdout).toStartWith("gh-1 · work#1 (");
  });

  test("leaving the pick-list (Esc, Ctrl-C) acts on nothing", async () => {
    const term = new FakeInteraction();
    term.answers = [null];
    const r = await norn({ interaction: term }, "run", "view");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "cancelled" });
    expect(term.picks).toHaveLength(1);
  });
});

describe("a story and its slice have runs", () => {
  test("setup: gh-2's slice parks at its gate in the slice worktree", async () => {
    h.remote.issues = [...h.remote.issues, issue(2, "Split work", ["norn", "norn:wf:sliced"])];
    await h.tick("--sync");
    for (let i = 0; i < 6 && h.state(storyRuns2())?.status !== "running"; i++) await tick();
    h.write(join(wt2(), spec2, "slices/01-part.md"), "---\nid: gh-2/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    h.report(storyRuns2(), "done", { outcome: "done", handoff: "one slice" });
    for (let i = 0; i < 6 && h.state(sliceRuns())?.status !== "parked"; i++) await tick();
    expect(h.state(sliceRuns())).toMatchObject({ slice: "gh-2/01", step: "qa", status: "parked" });
  });

  test("in the slice worktree, no target means the slice (B54)", async () => {
    const term = new FakeInteraction();
    const view = await norn({ cwd: sliceWt(), interaction: term }, "run", "view", "--json");
    expect(view.exit).toBe(0);
    expect(view.value).toMatchObject({ unit: "gh-2/01", step: "qa" });
    const list = await norn({ cwd: sliceWt(), interaction: term }, "run", "list", "--json");
    expect(list.exit).toBe(0);
    expect(list.value).toMatchObject({ unit: "gh-2/01" });
    expect(term.picks).toEqual([]);
  });

  test("an explicit target wins over the worktree (B56)", async () => {
    const r = await norn({ cwd: wt2() }, "run", "view", "gh-1", "--json");
    expect(r.exit).toBe(0);
    expect(unitOf(r)).toBe("gh-1");
  });

  test("in the main checkout at a terminal: offered the units with runs in `norn status` order, the pick shown (B57)", async () => {
    type Inbox = { groups: Record<string, Array<{ story: string; slice: string | null }>> };
    type Stories = { stories: Array<{ key: string; slices: Array<{ slice: string }> }> };
    const inbox = (await h.norn("status", "--json")).value as Inbox;
    const stories = (await h.norn("story", "list", "--json")).value as Stories;
    const order = [...new Set([...Object.values(inbox.groups).flat().map((i) => i.slice ?? i.story), ...stories.stories.flatMap((s) => [s.key, ...s.slices.map((x) => x.slice)])])];
    expect([...order].sort()).toEqual(["gh-1", "gh-2", "gh-2/01"]);

    const term = new FakeInteraction();
    term.answers = ["gh-2/01"];
    const r = await norn({ interaction: term }, "run", "view");
    expect(term.picks.map((p) => p.choices.map((c) => c.value))).toEqual([order]);
    expect(term.picks[0]?.preselect).toBe(0);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-2/01", step: "qa" });

    const list = new FakeInteraction();
    list.answers = ["gh-1"];
    const l = await norn({ interaction: list }, "run", "list");
    expect(l.exit).toBe(0);
    expect(l.value).toMatchObject({ unit: "gh-1" });
    expect(list.picks.map((p) => p.choices.map((c) => c.value))).toEqual([order]);
  });

  test("a script or an agent is refused (exit 2) with the candidates, never prompted (B60)", async () => {
    const cases: Array<[string, Partial<CliDeps>, string[]]> = [
      ["--json", {}, ["--json"]],
      ["no TTY", { interaction: new FakeInteraction(false) }, []],
      ["no terminal at all", { interaction: null }, []],
      ["an agent's launch env (A6)", { env: { ...h.deps.env, NORN_RUN: "01ARZ3NDEKTSV4RRFFQ69G5FAV" } }, []],
      ["an orient session", { env: { ...h.deps.env, NORN_ORIENT: "1" } }, []],
    ];
    for (const [why, deps, flags] of cases) {
      const term = deps.interaction === undefined ? new FakeInteraction() : deps.interaction;
      for (const verb of ["view", "list"]) {
        const r = await norn({ interaction: term, ...deps }, "run", verb, ...flags);
        expect([why, verb, r.exit]).toEqual([why, verb, 2]);
        expect(r.value).toMatchObject({ code: "target_required" });
        for (const k of ["gh-1", "gh-2", "gh-2/01"]) expect((r.value as { do_instead: string }).do_instead).toContain(k);
      }
      if (term instanceof FakeInteraction) expect([why, term.picks]).toEqual([why, []]);
    }
  });
});
