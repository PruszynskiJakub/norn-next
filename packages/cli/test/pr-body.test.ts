/**
 * GR9: the story PR body is the agent's `pr.md` in the spec folder with the issue link under it;
 * without the file it is the link alone, and a PR already open gets the new body after rework.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { createHarness, type Harness, issue } from "./harness.ts";
import { runChecked } from "./harness.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(30_000);

const SHIP = `name: ship
start: describe
steps:
  describe:
    type: agent
    skill: norn-pr
    outcomes: { done: { to: open-pr, means: "PR body written" } }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes: { approve: $done, reject: { to: describe, counter: loop } }
counters: { loop: { max: 2 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: ship
default_mode: manual
notifiers: []
`;

let h: Harness;
const spec = ".agents/specs/gh-7-count-items";
const wt = () => `${h.root}-worktrees/gh-7-count-items`;
const runs = () => join(wt(), spec, "runs/_story");
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const env = () => {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
};
const inWt = (...argv: string[]) => runChecked(argv, { ...h.deps, cwd: wt(), env: env() });
/** one run of the describe step, optionally writing `pr.md`, then the open-pr step */
async function describeAndOpen(prMd: string | null): Promise<void> {
  await inWt("brief", "--json");
  await tick();
  if (prMd !== null) h.write(join(wt(), spec, "pr.md"), prMd);
  expect((await inWt("done", "done", "--handoff", "described")).exit).toBe(0);
  await tick(); // apply → open-pr
  await tick(); // run_git open-pr
  await tick(); // apply → ready gate
  expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked" });
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/ship.yaml"), SHIP);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Count items")];
  for (let i = 0; i < 6 && h.state(runs())?.step !== "describe"; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "describe", status: "ready" });
});
afterAll(() => h.cleanup());

describe("story PR body (GR9)", () => {
  const link = () => `Closes ${issue(7, "Count items").url}\n\nDelivered by norn (story gh-7).`;

  test("no pr.md: the draft PR body is the issue link alone", async () => {
    await describeAndOpen(null);
    expect(h.remote.prs).toHaveLength(1);
    expect(h.remote.bodies.get(h.remote.prs[0]!.number)).toBe(link());
  });

  test("after rework the open PR gets the new pr.md with the link under it; no second PR", async () => {
    expect((await h.norn("story", "reject", "gh-7", "--reason", "describe the change")).exit).toBe(0);
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "describe", attempt: 2 });
    await describeAndOpen("## Summary\n\ncount items\n\n");
    expect(h.remote.prs).toHaveLength(1);
    const n = h.remote.prs[0]!.number;
    expect(h.remote.calls).toContain(`pr~ ${n}`);
    expect(h.remote.bodies.get(n)).toBe(`## Summary\n\ncount items\n\n---\n\n${link()}`);
    // the body file is the agent's work: committed with the step (S8)
    expect(h.git(["status", "--porcelain"], wt())).toBe("");
  });
});
