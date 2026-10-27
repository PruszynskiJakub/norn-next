/**
 * `norn orient <story|unit>`: read-only report (markdown, `--json` data), `--open` focuses or creates
 * the story's orient workspace in Herdr; the orient agent (`NORN_ORIENT=1`) is no run of the unit.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { readTrace } from "@norn/store";
import type { OrientReport } from "@norn/view";
import { runCli } from "../src/index.ts";
import { fakeHerdr } from "./fake-herdr.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

let c: Harness;
const wt = () => `${c.root}-worktrees/gh-5-pay-invoices`;
beforeAll(async () => {
  c = await createHarness();
  expect((await c.norn("init")).exit).toBe(0);
  c.git(["add", "-A"]);
  c.git(["commit", "-q", "-m", "norn init"]);
  c.git(["push", "-q", "origin", "main"]);
  c.remote.issues = [issue(5, "Pay invoices")];
  for (let i = 0; i < 3; i++) {
    c.clock.advance(60_000);
    await c.tick();
  }
  const brief = await runCli(["brief", "--json"], { ...c.deps, cwd: wt(), env: { ...c.deps.env, NORN_AGENT_PID: String(process.pid) } });
  expect(brief.exit).toBe(0);
  c.clock.advance(1000);
  c.report(join(wt(), ".agents/specs/gh-5-pay-invoices/runs/_story"), "done", { outcome: "done", handoff: "spec written", notes: [{ text: "invoices are counted per month; confirm" }] });
  c.clock.advance(1000);
  await c.tick();
});
afterAll(() => c.cleanup());

describe("norn orient", () => {
  test("markdown by default, the report with --json; writes nothing; an unknown story is refused", async () => {
    const before = c.git(["status", "--porcelain"]);
    const md = await runCli(["orient", "gh-5"], c.deps);
    expect(md.exit).toBe(0);
    expect(md.stdout).toStartWith("# Orient: gh-5 — Pay invoices\n");
    expect(md.stdout).toContain("- [refine] invoices are counted per month; confirm");
    const json = await runCli(["orient", "gh-5", "--json"], c.deps);
    const r = json.value as OrientReport;
    expect(r).toMatchObject({ key: "gh-5", story: "gh-5", root: wt(), branch: "gh-5-pay-invoices", pr: null, pr_command: "gh pr view gh-5-pay-invoices", note_count: 1 });
    expect(c.git(["status", "--porcelain"])).toBe(before);
    expect((await runCli(["orient", "gh-9", "--json"], c.deps)).exit).toBe(3);
  });

  test("--open creates the `<story> orient` workspace in the story worktree, then focuses it", async () => {
    const h = fakeHerdr();
    const opened = await runCli(["orient", "gh-5", "--open", "--json"], { ...c.deps, herdr: h.cockpit });
    expect(opened.value).toMatchObject({ story: "gh-5", opened: true, created: true, workspace_id: "w9" });
    expect(h.calls).toEqual([expect.stringMatching(new RegExp(`^open workspace ${wt()} gh-5 orient focus ${c.home}/launch/[0-9a-f]{16}\\.sh env NORN_ORIENT=1 claude --permission-mode auto -- 'Run \`norn orient gh-5\` and follow it\\.'$`))]);

    const again = fakeHerdr([], [{ workspace_id: "w4", label: "gh-5 orient", pane_ids: ["w4:p1"], cwds: [wt()] }]);
    const focused = await runCli(["orient", "gh-5", "--open", "--json"], { ...c.deps, herdr: again.cockpit });
    expect(focused.value).toEqual({ story: "gh-5", opened: true, created: false, workspace_id: "w4" });
    expect(again.calls).toEqual(["focus workspace w4"]);

    const outside = await runCli(["orient", "gh-5", "--open", "--json"], { ...c.deps, herdr: null });
    expect(outside.value).toEqual({ story: "gh-5", opened: false, command: `cd ${wt()} && NORN_ORIENT=1 claude --permission-mode auto -- 'Run \`norn orient gh-5\` and follow it.'` });
  });

  test("an orient agent is no run: brief and done refuse it, its hooks record nothing", async () => {
    const env = { ...c.deps.env, NORN_ORIENT: "1" };
    const brief = await runCli(["brief", "--json"], { ...c.deps, cwd: wt(), env });
    expect(brief.exit).toBe(3);
    expect(brief.value).toMatchObject({ code: "orient_session" });
    const done = await runCli(["done", "done", "--handoff", "x", "--json"], { ...c.deps, cwd: wt(), env });
    expect(done.value).toMatchObject({ code: "orient_session" });
    const hooks = () => readTrace(c.root, {}).events.filter((e) => e.type === "hook").length;
    const n = hooks();
    const hook = await runCli(["hook", "stop", "--agent", "claude"], { ...c.deps, cwd: wt(), env, stdin: JSON.stringify({ hook_event_name: "Stop", cwd: wt(), session_id: "s" }) });
    expect(hook.value).toEqual({});
    expect(hooks()).toBe(n);
  });
});
