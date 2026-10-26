/**
 * K7: `norn tidy` closes what runs that reported done left in Herdr — the run's tab, or only its pane
 * when the tab holds something else, and the workspace when nothing else is left; never a pane that
 * moved out of the run's worktree, one still working, or a run that ended any other way.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import type { herdr } from "@norn/adapters";
import { type Receipt, ulid } from "@norn/schema";
import { appendReceipt } from "@norn/store";
import { runCli } from "../src/index.ts";
import { type DoneRun, doneHerdrRuns, planHerdrTidy } from "../src/runtime/tidy-herdr.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const spot = (pane_id: string, cwd: string | null, status = "idle"): herdr.HerdrPaneSpot => {
  const [ws, rest] = pane_id.split(":") as [string, string];
  const tab = rest.startsWith("t") ? rest.split(".")[0] : "t1";
  return { pane_id, tab_id: `${ws}:${tab}`, workspace_id: ws, cwd, status };
};
const run = (pane_id: string, worktree = "/wt/gh-1-01", unit = "gh-1/01"): DoneRun => ({ unit, run_id: ulid(), pane_id, worktree });

describe("planHerdrTidy (K7)", () => {
  test("a workspace holding only finished runs closes whole", () => {
    const plan = planHerdrTidy([run("w4:t1.p1"), run("w4:t2.p1")], [spot("w4:t1.p1", "/wt/gh-1-01"), spot("w4:t2.p1", "/wt/gh-1-01/sub", "done")]);
    expect(plan).toEqual({ workspaces: ["w4"], tabs: [], panes: [], kept: [] });
  });

  test("a tab holding only the run closes; the workspace stays for what else is in it", () => {
    const plan = planHerdrTidy([run("w2:t2.p1")], [spot("w2:t1.p1", "/repo", "working"), spot("w2:t2.p1", "/wt/gh-1-01")]);
    expect(plan).toEqual({ workspaces: [], tabs: ["w2:t2"], panes: [], kept: [] });
  });

  test("a tab shared with something else loses only the run's pane", () => {
    const plan = planHerdrTidy([run("w2:t1.p2")], [spot("w2:t1.p1", "/repo"), spot("w2:t1.p2", "/wt/gh-1-01")]);
    expect(plan).toEqual({ workspaces: [], tabs: [], panes: ["w2:t1.p2"], kept: [] });
  });

  test("never closes a pane that left the run's worktree or whose agent still works; a gone pane is skipped", () => {
    const plan = planHerdrTidy(
      [run("w5:t1.p1"), run("w6:t1.p1"), run("w7:t1.p1"), run("w8:t1.p1")],
      [spot("w5:t1.p1", "/elsewhere"), spot("w6:t1.p1", "/wt/gh-1-01", "working"), spot("w7:t1.p1", null)],
    );
    expect(plan.workspaces).toEqual([]);
    expect(plan.tabs).toEqual([]);
    expect(plan.panes).toEqual([]);
    expect(plan.kept).toEqual([
      { item: "w5:t1.p1 (gh-1/01)", reason: "pane no longer works in the run's worktree" },
      { item: "w6:t1.p1 (gh-1/01)", reason: "agent in the pane is still working" },
      { item: "w7:t1.p1 (gh-1/01)", reason: "pane no longer works in the run's worktree" },
    ]);
  });
});

describe("norn tidy closes Herdr panes of runs that reported done (K7)", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-3-third`;
  const runsDir = () => join(wt(), ".agents/specs/gh-3-third/runs/_story");

  /** A fake Herdr: fixed panes, every close recorded. */
  function fakeHerdr(panes: herdr.HerdrPaneSpot[]) {
    const calls: string[] = [];
    const cockpit = {
      listPanes: async () => panes,
      closePane: async (id: string) => void calls.push(`pane ${id}`),
      closeTab: async (id: string) => void calls.push(`tab ${id}`),
      closeWorkspace: async (id: string) => void calls.push(`workspace ${id}`),
    } as unknown as herdr.HerdrCockpit;
    return { cockpit, calls };
  }

  /** A run's `started` receipt (in a Herdr pane, on `machine`) and, unless `end` is null, how it ended. */
  function recordRun(pane: string, end: "done" | "stuck" | null, machine = "tester@box") {
    const run_id = ulid(h.clock.now());
    const head = { run_id, step: "refine", attempt: 1, at: h.clock.iso() };
    appendReceipt(runsDir(), { kind: "started", receipt_id: ulid(h.clock.now()), ...head, by: "norn", how: "auto", worktree: wt(), machine, session: { runner: "herdr", session_id: pane, pane_id: pane } } as Receipt);
    if (end === "done") appendReceipt(runsDir(), { kind: "done", receipt_id: ulid(h.clock.now()), ...head, by: "agent", outcome: "done", handoff: "ok" } as Receipt);
    if (end === "stuck") appendReceipt(runsDir(), { kind: "stuck", receipt_id: ulid(h.clock.now()), ...head, by: "agent", reason: "no access" } as Receipt);
  }

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(3, "Third")];
    for (let i = 0; i < 2; i++) {
      h.clock.advance(60_000);
      await h.tick();
    }
    recordRun("w4:t1.p1", "done");
    recordRun("w5:t1.p1", "stuck");
    recordRun("w6:t1.p1", null);
    recordRun("w7:t1.p1", "done", "someone@else");
  });
  afterAll(() => h.cleanup());

  test("finds only done runs recorded on this machine", () => {
    expect(doneHerdrRuns([{ key: "gh-3", runsDir: runsDir() }], "tester@box").map((r) => r.pane_id)).toEqual(["w4:t1.p1"]);
  });

  test("another runner: tidy leaves Herdr alone", async () => {
    const f = fakeHerdr([spot("w4:t1.p1", wt())]);
    const r = await runCli(["tidy"], { ...h.deps, herdr: f.cockpit });
    expect(r.exit).toBe(0);
    expect((r.value as { removed: Record<string, unknown> }).removed.herdr).toBeUndefined();
    expect(f.calls).toEqual([]);
  });

  test("Herdr as the runner: --dry-run lists, tidy closes the done run's workspace only", async () => {
    h.write(join(h.home, "config.yaml"), "runner: { adapter: herdr }\n");
    const panes = [spot("w4:t1.p1", wt()), spot("w5:t1.p1", wt()), spot("w6:t1.p1", wt(), "working"), spot("w7:t1.p1", wt())];
    const dry = fakeHerdr(panes);
    const d = await runCli(["tidy", "--dry-run"], { ...h.deps, herdr: dry.cockpit });
    expect(d.exit).toBe(0);
    expect(d.value).toMatchObject({ would_remove: { herdr: { workspaces: ["w4"], tabs: [], panes: [] } } });
    expect(dry.calls).toEqual([]);

    const real = fakeHerdr(panes);
    const t = await runCli(["tidy"], { ...h.deps, herdr: real.cockpit });
    expect(t.value).toMatchObject({ removed: { herdr: { workspaces: ["w4"], tabs: [], panes: [] } } });
    expect(real.calls).toEqual(["workspace w4"]);
  });

  test("a Herdr that cannot be reached is reported under kept, and the rest of tidy still runs", async () => {
    const broken = { listPanes: async () => Promise.reject(new Error("socket refused")) } as unknown as herdr.HerdrCockpit;
    const t = await runCli(["tidy"], { ...h.deps, herdr: broken });
    expect(t.exit).toBe(0);
    expect(t.value).toMatchObject({ removed: { herdr: { workspaces: [], tabs: [], panes: [] } }, kept: [{ item: "herdr", reason: "could not tidy Herdr: socket refused" }] });
  });
});
