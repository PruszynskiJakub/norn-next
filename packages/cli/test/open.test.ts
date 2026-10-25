/**
 * `norn open` (MO3, O1): a person opens an agent on the step only a person starts — refused before
 * the story starts and while the step is not theirs; prints the start command without Herdr.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const CONFIG = `agents:
  claude: { adapter: claude }
runner: null
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
  // the suite may itself run inside Herdr: open must not reach a real one
  h.deps.env = { ...h.deps.env, HERDR_ENV: undefined };
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/story.yaml"), STORY);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn"])];
});
afterAll(() => h.cleanup());

describe("norn open (MO3)", () => {
  const wt = () => `${h.root}-worktrees/gh-7-add-login-form`;

  test("taken in, not started: refused with the command that starts it; the inbox says so (GR2, O1)", async () => {
    await h.tick();
    h.clock.advance(10_000);
    const r = await h.norn("open", "gh-7");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "not_started", do_instead: expect.stringContaining("norn tick") });
  });

  test("an attended step: prints the start command for the worktree when there is no Herdr", async () => {
    h.clock.advance(10_000);
    await h.tick();
    h.clock.advance(10_000);
    await h.tick();
    const inbox = (await h.norn("inbox")).value as { groups: { your_turn: Array<{ story: string; command: string; detail?: string }> } };
    expect(inbox.groups.your_turn).toMatchObject([{ story: "gh-7", command: "norn open gh-7", detail: expect.stringContaining(`cd ${wt()}`) }]);
    const r = await h.norn("open", "gh-7");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-7", step: "refine", worktree: wt(), opened: false });
    expect((r.value as { command: string }).command).toBe(`cd ${wt()} && claude 'Use the norn skill, then run \`norn brief\`.'`);
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
