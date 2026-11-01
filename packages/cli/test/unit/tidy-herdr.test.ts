/**
 * K7: `norn tidy` closes what runs that reported done left in Herdr — the run's tab, or only its pane
 * when the tab holds something else, and the workspace when nothing else is left; never a pane that
 * moved out of the run's worktree, one still working, or a run that ended any other way.
 */
import { describe, expect, test } from "bun:test";
import { ulid } from "@norn/schema";
import { type DoneRun, planHerdrTidy } from "../../src/runtime/tidy-herdr.ts";
import { spot } from "../herdr-spot.ts";

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
