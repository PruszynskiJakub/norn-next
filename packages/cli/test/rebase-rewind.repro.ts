/**
 * gh-79 repro loop (reproduce step; not picked up by `bun test`, run it by path):
 *   bun test ./packages/cli/test/rebase-rewind.repro.ts
 * A rebase stopped on conflicts in a story worktree rewinds `runs/` to an older state.json. The
 * tick reads that rewound state as the live unit, classifies the old step's deadline and writes a
 * receipt + state.json into the working tree (commit deferred). After `git rebase --abort` the
 * stray receipt collides with the committed one of the same number and the unit is `corrupt` (S2).
 * The assertions state the wanted behaviour (no write while a rebase is in progress, no corrupt
 * unit after the abort), so the loop is red while the bug is there.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
    h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
    h.write(join(h.root, ".agents/norn/workflows/rr.yaml"), RR);
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
    expect(acted(r)).toEqual([]); // red: ["agent.timeout.surface"]
    expect(receipts()).toEqual(["0001-started.json"]); // red: + 0002-classify.json
  });

  test("after `git rebase --abort` the unit is not corrupt", async () => {
    sh(wt(), ["rebase", "--abort"]);
    h.clock.advance(30_000);
    const r = await h.tick();
    expect(acted(r)).toEqual([]); // red: ["unit.corrupt"] (duplicate receipt number 2, also 0002-classify.json)
    expect(h.state(runs())).toMatchObject({ step: "second", status: "ready" }); // red: status corrupt
    expect(receipts()).toEqual(["0001-started.json", "0002-done.json"]); // red: + the stray 0002-classify.json
  });
});
