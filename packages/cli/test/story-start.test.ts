/**
 * `norn story start` (B28, MO5, O1): a person opens an agent on the step only a person starts —
 * refused before the story starts and while the step is not theirs; prints the start command when
 * the runner cannot open a terminal or with `--print`, opens one through the runner when it can.
 * Without a target a person picks from the units a person can start (B57–B59).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import type { PersonOpenSpec } from "@norn/core";
import type { CliDeps } from "../src/index.ts";
import { runCli } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: story
default_mode: manual
notifiers: []
`;

const STORY = `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: approve, means: "spec written" } }
  approve:
    type: gate
    prompt: "Approve the spec"
    outcomes: { approve: $done, reject: { to: refine, counter: spec_loop } }
counters: { spec_loop: { max: 2 } }
`;

const GATE_FIRST = `name: gatefirst
start: approve
steps:
  approve:
    type: gate
    prompt: "Approve it"
    outcomes: { approve: $done, reject: $stuck }
`;

const CHECK_FIRST = `name: checkfirst
start: test
steps:
  test:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: $done, fail: $stuck }
`;

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/story.yaml"), STORY);
  h.write(join(h.root, ".agents/norn/workflows/gatefirst.yaml"), GATE_FIRST);
  h.write(join(h.root, ".agents/norn/workflows/checkfirst.yaml"), CHECK_FIRST);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn"]), issue(8, "Sign off", ["norn", "norn:wf:gatefirst"])];
});
afterAll(() => h.cleanup());

describe("norn story start (B28, MO5)", () => {
  const wt = () => `${h.root}-worktrees/gh-7-add-login-form`;
  const norn = (deps: Partial<CliDeps>, ...argv: string[]) => runCli(argv, { ...h.deps, ...deps });

  test("taken in, not started: refused with the command that starts it; the inbox says so (GR2, O1)", async () => {
    await h.tick();
    h.clock.advance(10_000);
    const r = await h.norn("story", "start", "gh-7");
    expect(r.exit).toBe(3);
    const v = r.value as { code: string; do_instead: string };
    expect(v.code).toBe("not_started");
    expect(v.do_instead).toContain("norn tick");
    expect(v.do_instead).toContain("norn story start gh-7");
  });

  test("an attended step, a runner that cannot open terminals: the inbox and open give the start command", async () => {
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    await h.tick();
    const inbox = (await h.norn("status")).value as { groups: { your_turn: Array<{ story: string; command: string; detail?: string }> } };
    const start = `cd ${wt()} && claude 'Use the norn skill, then run \`norn brief\`.'`;
    expect(inbox.groups.your_turn).toMatchObject([{ story: "gh-7", command: start }]);
    const r = await h.norn("story", "start", "gh-7", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ unit: "gh-7", step: "refine", worktree: wt(), command: start, opened: false });
  });

  test("without a target a person picks from the units a person can start only (B28, B57)", async () => {
    const term = new FakeInteraction();
    const r = await norn({ interaction: term }, "story", "start");
    expect(term.picks.map((p) => p.choices.map((c) => c.value))).toEqual([["gh-7"]]);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-7", step: "refine" });
    // a script is refused with only that unit (B60)
    const script = await norn({ interaction: new FakeInteraction(false) }, "story", "start");
    expect(script.exit).toBe(2);
    expect(script.value).toMatchObject({ code: "target_required", do_instead: "norn story start gh-7" });
  });

  test("a runner that opens terminals: story start opens one in the worktree; --print prints the command", async () => {
    const opened: PersonOpenSpec[] = [];
    h.runner.capabilities = { ...h.runner.capabilities, open: true };
    Object.assign(h.runner, { openForPerson: async (spec: PersonOpenSpec) => (opened.push(spec), { pane_id: "p-9" }) });
    const inbox = (await h.norn("status")).value as { groups: { your_turn: Array<{ command: string; detail?: string }> } };
    expect(inbox.groups.your_turn).toMatchObject([{ command: "norn open gh-7", detail: expect.stringContaining(`by hand: cd ${wt()}`) }]);
    const r = await h.norn("story", "start", "gh-7");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-7", opened: true, runner: "fake", pane_id: "p-9" });
    expect(opened).toMatchObject([{ cwd: wt(), title: "gh-7 refine", command: expect.stringContaining("claude") }]);
    // --print never opens
    const printed = await h.norn("story", "start", "gh-7", "--print");
    expect(printed.value).toMatchObject({ opened: false, command: expect.stringContaining(`cd ${wt()} && claude`) });
    expect(opened).toHaveLength(1);
  });

  test("a step a person does not start is refused (nothing_to_open); with no target, nothing to pick (B59)", async () => {
    const runs = join(wt(), ".agents/specs/gh-7-add-login-form/runs/_story");
    h.report(runs, "done", { outcome: "done", handoff: "spec written" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs)).toMatchObject({ step: "approve", status: "parked" });
    const r = await h.norn("story", "start", "gh-7");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "nothing_to_open", do_instead: "norn inbox" });
    const term = new FakeInteraction();
    const none = await norn({ interaction: term }, "story", "start");
    expect(none.exit).toBe(3);
    expect(none.value).toMatchObject({ code: "no_target" });
    expect(term.picks).toEqual([]);
  });

  test("a manual unit ready at a step that is not an agent step is not offered (B28, B57)", async () => {
    h.remote.issues = [...h.remote.issues, issue(9, "Run checks", ["norn", "norn:wf:checkfirst"])];
    for (let i = 0; i < 3; i++) {
      h.clock.advance(6 * 60_000);
      await h.tick();
    }
    const status = (await h.norn("status", "--json")).value as { stories: Array<{ key: string; status: string; step: string; effective_mode: string }> };
    expect(status.stories.find((s) => s.key === "gh-9")).toMatchObject({ status: "ready", step: "test", effective_mode: "manual" });
    const term = new FakeInteraction();
    const none = await norn({ interaction: term }, "story", "start");
    expect(none.value).toMatchObject({ code: "no_target" });
    expect(term.picks).toEqual([]);
  });
});
