/**
 * `norn story view [<story|slice>]` (B16, B17, D6): one story — slices with their steps, the PR, open
 * notes, what waits for the person; `--json` is the orient report extended, `--web` opens the PR or
 * the issue. `norn story chat [<story>]` (B29) gives the story its `<story> orient` workspace with an
 * agent; the agent (`NORN_ORIENT=1`) is no run of the unit. Both act on the story of a slice worktree
 * (B55). `orient` is gone (B5).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readTrace, repoConfigPath, workflowsDir, storyUnitDir } from "@norn/store";
import type { OrientReport } from "@norn/view";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { fakeHerdr } from "../../../../test/support/fake-herdr.ts";
import { createHarness, FakeInteraction, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

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
default_workflow: sliced
default_mode: auto
notifiers: []
`;

let h: Harness;
const spec = ".agents/specs/gh-2-split-work";
const wt = () => `${h.root}-worktrees/gh-2-split-work`;
const sliceWt = () => `${wt()}--01-first`;
const storyRuns = () => storyUnitDir(join(wt(), spec));
const sliceRuns = (nn: string) => join(`${wt()}--${nn}`, spec, `runs/${nn}`);
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });
const slice = (nn: string, title: string) => `---\nid: gh-2/${nn.slice(0, 2)}\ntitle: ${title}\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n`;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "sliced.yaml"), SLICED);
  h.write(join(workflowsDir(h.root), "sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(2, "Split work"), issue(3, "Lone story")];
  for (let i = 0; i < 6 && h.state(storyRuns())?.status !== "running"; i++) await tick();
  h.write(join(wt(), spec, "slices/01-first.md"), slice("01-first", "First part"));
  h.write(join(wt(), spec, "slices/02-second.md"), slice("02-second", "Second part"));
  h.report(storyRuns(), "done", { outcome: "done", handoff: "two slices", notes: [{ text: "invoices are counted per month; confirm" }] });
  for (let i = 0; i < 8 && [sliceRuns("01-first"), sliceRuns("02-second")].some((r) => h.state(r)?.status !== "parked"); i++) await tick();
  expect(h.state(sliceRuns("01-first"))).toMatchObject({ step: "qa", status: "parked" });
  expect(h.state(sliceRuns("02-second"))).toMatchObject({ step: "qa", status: "parked" });
  h.remote.prs = [{ number: 40, url: "https://github.com/o/r/pull/40", state: "open", is_draft: true, head_sha: "", head: "gh-2-split-work", base_branch: "main", merged_at: null }];
  h.clock.advance(10_000);
  await h.tick("--sync"); // PRs are fetched on sync ticks
});
afterAll(() => h.cleanup());

describe("norn story view", () => {
  test("shows the slices with their steps, the PR link and state, the open notes and what waits (B16)", async () => {
    const before = h.git(["status", "--porcelain"]);
    const r = await h.norn("story", "view", "gh-2");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith("# gh-2 — Split work\n");
    expect(r.stdout).toContain("- gh-2/01 First part — parked at qa");
    expect(r.stdout).toContain("- gh-2/02 Second part — parked at qa");
    expect(r.stdout).toContain("#40 draft, open — https://github.com/o/r/pull/40");
    expect(r.stdout).toContain("## Open notes (1)");
    expect(r.stdout).toContain("- [plan] invoices are counted per month; confirm");
    expect(r.stdout).toMatch(/\*\*Approve\*\* gh-2\/01 \(qa\)/);
    expect(r.stdout).toMatch(/\*\*Approve\*\* gh-2\/02 \(qa\)/);
    // the orient agent's rules are for the agent beside the person, not the person's view
    expect(r.stdout).not.toContain("You sit with the person");
    expect(h.git(["status", "--porcelain"])).toBe(before);
  });

  test("--json is the orient report extended with the slice steps and PR state (B6, D6)", async () => {
    const r = await h.norn("story", "view", "gh-2", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as OrientReport;
    expect(v).toMatchObject({ key: "gh-2", story: "gh-2", title: "Split work", root: wt(), branch: "gh-2-split-work", pr_command: "gh pr view gh-2-split-work", note_count: 1 });
    expect(v.pr).toMatchObject({ number: 40, url: "https://github.com/o/r/pull/40", state: "open", is_draft: true });
    expect(v.pr_state).toBe("draft");
    expect(v.unit).toMatchObject({ key: "gh-2", workflow: "sliced", step: "slices" });
    expect(v.slices).toEqual([
      expect.objectContaining({ key: "gh-2/01", title: "First part", status: "parked", workflow: "sliceqa", step: "qa", attempt: 1, slice_status: expect.any(String), depends_on: [], next: "norn story approve gh-2/01" }),
      expect.objectContaining({ key: "gh-2/02", status: "parked", workflow: "sliceqa", step: "qa", attempt: 1, depends_on: [] }),
    ]);
    expect(v.waiting.map((w) => [w.group, w.unit])).toEqual([
      ["approve", "gh-2/01"],
      ["approve", "gh-2/02"],
    ]);
    expect(v.notes).toEqual([{ unit: "gh-2", notes: [expect.objectContaining({ step: "plan", text: "invoices are counted per month; confirm" })] }]);
  });

  test("a slice key views its story with the slice in focus; an unknown story or slice is refused", async () => {
    const r = await h.norn("story", "view", "gh-2/01", "--json");
    expect(r.value).toMatchObject({ key: "gh-2/01", story: "gh-2" });
    expect((await h.norn("story", "view", "gh-9", "--json")).value).toMatchObject({ code: "unknown_unit" });
    expect((await h.norn("story", "view", "gh-2/07", "--json")).exit).toBe(3);
  });

  test("--web opens the PR, or the issue when there is none (B17)", async () => {
    const opened: string[][] = [];
    const shell = async (argv: string[]) => (opened.push(argv), { code: 0, stderr: "" });
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    const pr = await norn({ shell }, "story", "view", "gh-2", "--web", "--json");
    expect(pr.exit).toBe(0);
    expect(pr.value).toEqual({ story: "gh-2", opened: "https://github.com/o/r/pull/40" });
    const lone = await norn({ shell }, "story", "view", "gh-3", "--web");
    expect(lone.exit).toBe(0);
    expect(opened).toEqual([
      [opener, "https://github.com/o/r/pull/40"],
      [opener, "https://github.com/o/r/issues/3"],
    ]);
    const failed = await norn({ shell: async () => ({ code: 1, stderr: "no browser\n" }) }, "story", "view", "gh-2", "--web", "--json");
    expect(failed.exit).not.toBe(0);
    expect(failed.value).toMatchObject({ error: expect.stringContaining("no browser") });
  });
});

describe("norn story chat", () => {
  test("creates the `<story> orient` workspace with an agent in the story worktree, then focuses it (B29)", async () => {
    const launchShim = join(h.home, "bin", "norn");
    const launchBefore = existsSync(launchShim) ? h.read(launchShim) : null;
    const f = fakeHerdr();
    const opened = await norn({ herdr: f.cockpit }, "story", "chat", "gh-2", "--json");
    expect(opened.value).toMatchObject({ story: "gh-2", opened: true, created: true, workspace_id: "w9" });
    expect(f.calls).toEqual([expect.stringMatching(new RegExp(`^open workspace ${wt()} gh-2 orient focus ${h.home}/orient/launch/[0-9a-f]{16}\\.sh env NORN_ORIENT=1 claude 'Run \`norn story view gh-2\` and follow it\\.'$`))]);
    // its own shim: the launch shim the launched agents' hooks share is untouched
    expect(existsSync(join(h.home, "orient", "bin", "norn"))).toBe(true);
    expect(existsSync(launchShim) ? h.read(launchShim) : null).toBe(launchBefore);

    // another repo's gh-2 is not ours; the picker's popup sits in the workspace it covers
    const again = fakeHerdr([], [
      { workspace_id: "w3", label: "gh-2 orient", pane_ids: ["w3:p1"], cwds: ["/other-worktrees/gh-2-x"] },
      { workspace_id: "w4", label: "gh-2 orient", pane_ids: ["w4:p1", "w4:p2"], cwds: [wt(), "/plugins/herdr"] },
    ]);
    const focused = await norn({ herdr: again.cockpit }, "story", "chat", "gh-2", "--json");
    expect(focused.value).toEqual({ story: "gh-2", opened: true, created: false, workspace_id: "w4" });
    expect(again.calls).toEqual(["focus workspace w4"]);

    const outside = await norn({ herdr: null }, "story", "chat", "gh-2", "--json");
    expect(outside.value).toEqual({ story: "gh-2", opened: false, command: `cd ${wt()} && NORN_ORIENT=1 claude 'Run \`norn story view gh-2\` and follow it.'` });
  });

  test("the chat agent reads the view with its rules; it is no run: brief and done refuse it, its hooks record nothing", async () => {
    const env = { ...h.deps.env, NORN_ORIENT: "1" };
    const view = await norn({ env }, "story", "view", "gh-2");
    expect(view.stdout).toContain("> You sit with the person");
    const brief = await norn({ cwd: wt(), env }, "brief", "--json");
    expect(brief.exit).toBe(3);
    expect(brief.value).toMatchObject({ code: "orient_session" });
    const done = await norn({ cwd: wt(), env }, "done", "done", "--handoff", "x", "--json");
    expect(done.value).toMatchObject({ code: "orient_session" });
    const hooks = () => readTrace(h.root, {}).events.filter((e) => e.type === "hook").length;
    const n = hooks();
    const hook = await norn({ cwd: wt(), env, stdin: JSON.stringify({ hook_event_name: "Stop", cwd: wt(), session_id: "s" }) }, "hook", "stop", "--agent", "claude");
    expect(hook.value).toEqual({});
    expect(hooks()).toBe(n);
  });
});

describe("targets (B55)", () => {
  test("in a slice worktree, view and chat act on the story", async () => {
    const term = new FakeInteraction();
    const view = await norn({ cwd: sliceWt(), interaction: term }, "story", "view", "--json");
    expect(view.exit).toBe(0);
    expect(view.value).toMatchObject({ key: "gh-2", story: "gh-2" });
    const f = fakeHerdr();
    const chat = await norn({ cwd: sliceWt(), interaction: term, herdr: f.cockpit }, "story", "chat", "--json");
    expect(chat.value).toMatchObject({ story: "gh-2", created: true });
    expect(f.calls).toEqual([expect.stringContaining(`open workspace ${wt()} gh-2 orient`)]);
    expect(term.picks).toEqual([]);
  });

  test("outside a worktree without a target, a terminal is offered stories only; a script is refused with them", async () => {
    for (const verb of ["view", "chat"]) {
      const term = new FakeInteraction();
      term.answers = ["gh-3"];
      const r = await norn({ interaction: term, herdr: null }, "story", verb);
      expect([verb, r.exit]).toEqual([verb, 0]);
      expect(term.picks).toHaveLength(1);
      expect(term.picks[0]?.choices.map((c) => c.value).sort()).toEqual(["gh-2", "gh-3"]);
      const script = await norn({ interaction: null }, "story", verb, "--json");
      expect(script.exit).toBe(2);
      expect(script.value).toMatchObject({ code: "target_required" });
      expect((script.value as { do_instead: string }).do_instead).not.toContain("gh-2/01");
    }
  });
});

describe("norn orient is gone (B5)", () => {
  test("any flags: a usage error, Unknown command: orient", async () => {
    for (const argv of [["orient"], ["orient", "gh-2"], ["orient", "gh-2", "--open"], ["orient", "gh-2", "--json"]]) {
      const r = await h.norn(...argv);
      expect([argv.join(" "), r.exit]).toEqual([argv.join(" "), 2]);
      expect(JSON.stringify(r.value ?? r.stdout)).toContain("Unknown command: orient");
    }
  });
});
