/**
 * K7: what `norn tidy` closes in Herdr — the pane each finished run left behind. A run counts only
 * when it reported `done` (an ask, a stuck or any other end is left for a person), its `started`
 * receipt recorded a Herdr pane, and it ran on this machine (pane ids are local to a Herdr server).
 * The pane is found by its recorded id and must still work in the run's worktree, so a pane id Herdr
 * gave to something else after a restart is never closed; one whose agent is still working is kept.
 * The run's tab is closed when it holds nothing else, else only its pane; its workspace only when
 * nothing else is left in it.
 */
import { herdr } from "@norn/adapters";
import { listReceipts } from "@norn/store";

/** A run that reported done, with the Herdr pane its `started` receipt recorded. */
export interface DoneRun {
  unit: string;
  run_id: string;
  pane_id: string;
  worktree: string;
}

export interface HerdrTidyPlan {
  /** workspaces holding only finished runs' panes */
  workspaces: string[];
  /** tabs holding only finished runs' panes, in a workspace that keeps something else */
  tabs: string[];
  /** finished runs' panes in a tab that keeps something else */
  panes: string[];
  kept: Array<{ item: string; reason: string }>;
}

/** The runs of these units that reported done in a Herdr pane on `machine`. */
export function doneHerdrRuns(units: ReadonlyArray<{ key: string; runsDir: string }>, machine: string): DoneRun[] {
  const out: DoneRun[] = [];
  for (const u of units) {
    const receipts = listReceipts(u.runsDir).receipts.map((r) => r.receipt);
    const done = new Set(receipts.flatMap((r) => (r.kind === "done" && r.run_id ? [r.run_id] : [])));
    for (const r of receipts) {
      if (r.kind !== "started" || !r.run_id || !done.has(r.run_id)) continue;
      if (r.session?.runner !== herdr.RUNNER_NAME || !r.session.pane_id) continue;
      if (r.machine && r.machine !== machine) continue;
      out.push({ unit: u.key, run_id: r.run_id, pane_id: r.session.pane_id, worktree: r.worktree });
    }
  }
  return out;
}

/** Pure: what to close for these finished runs, given Herdr's panes now. */
export function planHerdrTidy(runs: readonly DoneRun[], panes: readonly herdr.HerdrPaneSpot[]): HerdrTidyPlan {
  const kept: HerdrTidyPlan["kept"] = [];
  const closable = new Set<string>();
  for (const run of runs) {
    const pane = panes.find((p) => p.pane_id === run.pane_id);
    if (!pane) continue; // already closed
    const item = `${run.pane_id} (${run.unit})`;
    if (!pane.cwd || !herdr.inside(pane.cwd, run.worktree)) kept.push({ item, reason: "pane no longer works in the run's worktree" });
    else if (pane.status === "working") kept.push({ item, reason: "agent in the pane is still working" });
    else closable.add(pane.pane_id);
  }
  const plan: HerdrTidyPlan = { workspaces: [], tabs: [], panes: [], kept };
  const only = (ps: readonly herdr.HerdrPaneSpot[]) => ps.every((p) => closable.has(p.pane_id));
  for (const ws of [...new Set(panes.filter((p) => closable.has(p.pane_id)).map((p) => p.workspace_id))]) {
    const inWs = panes.filter((p) => p.workspace_id === ws);
    if (only(inWs)) {
      plan.workspaces.push(ws);
      continue;
    }
    for (const tab of [...new Set(inWs.filter((p) => closable.has(p.pane_id)).map((p) => p.tab_id))]) {
      const inTab = inWs.filter((p) => p.tab_id === tab);
      if (only(inTab)) plan.tabs.push(tab);
      else plan.panes.push(...inTab.filter((p) => closable.has(p.pane_id)).map((p) => p.pane_id));
    }
  }
  return plan;
}
