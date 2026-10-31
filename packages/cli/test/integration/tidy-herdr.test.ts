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
import { doneHerdrRuns } from "../../src/runtime/tidy-herdr.ts";
import { spot } from "../herdr-spot.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

describe("norn tidy closes Herdr panes of runs that reported done (K7)", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-3-third`;
  const runsDir = () => join(wt(), ".agents/specs/gh-3-third/runs/_story");

  /** A fake Herdr: fixed panes, every close recorded. */
  function paneHerdr(panes: herdr.HerdrPaneSpot[]) {
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
    const f = paneHerdr([spot("w4:t1.p1", wt())]);
    const r = await runChecked(["tidy"], { ...h.deps, herdr: f.cockpit });
    expect(r.exit).toBe(0);
    expect((r.value as { removed: Record<string, unknown> }).removed.herdr).toBeUndefined();
    expect(f.calls).toEqual([]);
  });

  test("Herdr as the runner: --dry-run lists, tidy closes the done run's workspace only", async () => {
    h.write(join(h.home, "config.yaml"), "runner: { adapter: herdr }\n");
    const panes = [spot("w4:t1.p1", wt()), spot("w5:t1.p1", wt()), spot("w6:t1.p1", wt(), "working"), spot("w7:t1.p1", wt())];
    const dry = paneHerdr(panes);
    const d = await runChecked(["tidy", "--dry-run"], { ...h.deps, herdr: dry.cockpit });
    expect(d.exit).toBe(0);
    expect(d.value).toMatchObject({ would_remove: { herdr: { workspaces: ["w4"], tabs: [], panes: [] } } });
    expect(dry.calls).toEqual([]);

    const real = paneHerdr(panes);
    const t = await runChecked(["tidy"], { ...h.deps, herdr: real.cockpit });
    expect(t.value).toMatchObject({ removed: { herdr: { workspaces: ["w4"], tabs: [], panes: [] } } });
    expect(real.calls).toEqual(["workspace w4"]);
  });

  test("a Herdr that cannot be reached is reported under kept, and the rest of tidy still runs", async () => {
    const broken = { listPanes: async () => Promise.reject(new Error("socket refused")) } as unknown as herdr.HerdrCockpit;
    const t = await runChecked(["tidy"], { ...h.deps, herdr: broken });
    expect(t.exit).toBe(0);
    expect(t.value).toMatchObject({ removed: { herdr: { workspaces: [], tabs: [], panes: [] } }, kept: [{ item: "herdr", reason: "could not tidy Herdr: socket refused" }] });
  });
});
