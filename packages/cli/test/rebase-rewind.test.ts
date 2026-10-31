/**
 * gh-79 (H1, S2, S5): a rebase stopped on conflicts in a story worktree rewinds `runs/` to an older
 * state.json. The tick must not read that as the live unit: no deadline classified against it, no
 * receipt or state.json written into it (commit deferred), so after `git rebase --abort` no stray
 * receipt collides with the committed one of the same number and the unit is not `corrupt`.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import { type CliResult, runCli, type TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue, sh } from "./harness.ts";

const RR = `name: rr
start: first
steps:
  first:
    type: agent
    skill: norn-implement
    deadline: 1m
    outcomes: { done: { to: second, means: "implemented" } }
  second:
    type: agent
    skill: norn-merge
    deadline: 1h
    outcomes: { done: { to: $done, means: "merged" } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: rr
default_mode: manual
notifiers: []
`;

setDefaultTimeout(30_000);

let h: Harness;
const wt = () => `${h.root}-worktrees/gh-1-add-widget`;
const runs = () => join(wt(), ".agents/specs/gh-1-add-widget/runs/_story");
const receipts = () => readdirSync(join(runs(), "receipts")).sort();
const acted = (r: TickReport) => r.decisions.filter((d) => d.unit === "gh-1" && d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
function inWt(...argv: string[]): Promise<CliResult> {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runCli(argv, { ...h.deps, cwd: wt(), env });
}

describe("gh-79: a tick mid-rebase", () => {
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.write(repoConfigPath(h.root), CONFIG);
    h.write(join(workflowsDir(h.root), "rr.yaml"), RR);
    h.write(join(h.root, "X.txt"), "base\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(1, "Add widget")];
    for (let i = 0; i < 3; i++) await h.tick(); // intake, claim, start
    expect((await inWt("brief")).exit).toBe(0); // manual: the agent's brief starts run first#1
    await h.tick(); // commits started (receipt 1)
    expect(h.state(runs())).toMatchObject({ step: "first", applied_through: 1 });

    // a branch off this point with a conflicting X.txt (what the story branch would be rebased onto)
    const s1 = sh(wt(), ["rev-parse", "HEAD"]);
    const other = join(h.dir, "other");
    sh(wt(), ["worktree", "add", "-q", "-b", "old", other, s1]);
    h.write(join(other, "X.txt"), "old\n");
    sh(other, ["commit", "-q", "-am", "old: X"]);
    sh(wt(), ["worktree", "remove", other]);

    // the agent's work, its done, and the tick that moves the unit to `second` (receipt 2)
    h.write(join(wt(), "X.txt"), "story\n");
    sh(wt(), ["commit", "-q", "-am", "agent: X"]);
    expect((await inWt("done", "done", "--handoff", "implemented X")).exit).toBe(0);
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "second", applied_through: 2 });
    expect(receipts()).toEqual(["0001-started.json", "0002-done.json"]);
  });
  afterAll(() => h.cleanup());

  test("mid-rebase the tick writes nothing into the rewound runs/", async () => {
    expect(() => sh(wt(), ["rebase", "old"])).toThrow(/conflict/i);
    expect(h.state(runs())).toMatchObject({ step: "first", applied_through: 1 }); // rewound
    h.clock.advance(5 * 60_000); // first's 1m deadline (from the run's start) is long past
    const r = await h.tick();
    expect(acted(r)).toEqual([]);
    expect(r.decisions.find((d) => d.unit === "gh-1" && d.rule === "unit.rebase_in_progress")).toBeDefined();
    expect(receipts()).toEqual(["0001-started.json"]);
  });

  test("after `git rebase --abort` the unit is not corrupt", async () => {
    sh(wt(), ["rebase", "--abort"]);
    h.clock.advance(30_000);
    const r = await h.tick();
    expect(acted(r)).toEqual([]);
    expect(h.state(runs())).toMatchObject({ step: "second", status: "ready" });
    expect(receipts()).toEqual(["0001-started.json", "0002-done.json"]);
  });
});
