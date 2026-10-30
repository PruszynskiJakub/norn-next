/**
 * `norn open` (MO5, O1): a person opens an agent on the step only a person starts — refused before
 * the story starts and while the step is not theirs; prints the start command when the runner
 * cannot open a terminal, opens one through the runner when it can.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import type { PersonOpenSpec } from "@norn/core";
import { createHarness, type Harness, issue } from "./harness.ts";

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

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/story.yaml"), STORY);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn"])];
});
afterAll(() => h.cleanup());

describe("norn open (MO5)", () => {
  const wt = () => `${h.root}-worktrees/gh-7-add-login-form`;

  test("taken in, not started: refused with the command that starts it; the inbox says so (GR2, O1)", async () => {
    await h.tick();
    h.clock.advance(10_000);
    const r = await h.norn("open", "gh-7");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "not_started", do_instead: expect.stringContaining("norn tick") });
  });

  test("an attended step, a runner that cannot open terminals: the inbox and open give the start command", async () => {
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    await h.tick();
    const inbox = (await h.norn("inbox")).value as { groups: { your_turn: Array<{ story: string; command: string; detail?: string }> } };
    const start = `cd ${wt()} && claude 'Use the norn skill, then run \`norn brief\`.'`;
    expect(inbox.groups.your_turn).toMatchObject([{ story: "gh-7", command: start }]);
    const r = await h.norn("open", "gh-7");
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ unit: "gh-7", step: "refine", worktree: wt(), command: start, opened: false });
  });

  test("a runner that opens terminals: the inbox says norn open, and open opens one in the worktree", async () => {
    const opened: PersonOpenSpec[] = [];
    h.runner.capabilities = { ...h.runner.capabilities, open: true };
    Object.assign(h.runner, { openForPerson: async (spec: PersonOpenSpec) => (opened.push(spec), { pane_id: "p-9" }) });
    const inbox = (await h.norn("inbox")).value as { groups: { your_turn: Array<{ command: string; detail?: string }> } };
    expect(inbox.groups.your_turn).toMatchObject([{ command: "norn open gh-7", detail: expect.stringContaining(`by hand: cd ${wt()}`) }]);
    const r = await h.norn("open", "gh-7");
    expect(r.value).toMatchObject({ unit: "gh-7", opened: true, runner: "fake", pane_id: "p-9" });
    expect(opened).toMatchObject([{ cwd: wt(), title: "gh-7 refine", command: expect.stringContaining("claude") }]);
    // --print never opens
    expect((await h.norn("open", "gh-7", "--print")).value).toMatchObject({ opened: false });
    expect(opened).toHaveLength(1);
  });

  test("a step a person does not start is refused (nothing_to_open)", async () => {
    const runs = join(wt(), ".agents/specs/gh-7-add-login-form/runs/_story");
    h.report(runs, "done", { outcome: "done", handoff: "spec written" });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs)).toMatchObject({ step: "approve", status: "parked" });
    const r = await h.norn("open", "gh-7");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "nothing_to_open", do_instead: "norn inbox" });
  });
});
