/**
 * Confirmed defects, reproduced. Each `test.failing` passes while the defect stands; the fix flips it
 * to `test` in the same commit (refactor plan Phase 1).
 *   - BUG-1 (1.1): the answer resume counts the run's own agent lease against max_agents (K1); the
 *     nudge resume exempts it.
 *   - BUG-2 (1.2): `routeFor` ignores counter exhaustion, so the route act records in a classify
 *     receipt disagrees with where `applyReceipts` sends the unit.
 *   - BUG-5 (found by 0.1's rule coverage): a slice file that failed validation, of a slice not
 *     started yet, makes decide throw (`sliceProgress` reads its null frontmatter's `depends_on`),
 *     so the whole tick fails instead of the `slices.file_invalid` noop.
 */
import { describe, expect, test } from "bun:test";
import type { LeaseFile, UnitState } from "@norn/schema";
import { applyReceipts, routeFor } from "../src/apply.ts";
import { decide } from "../src/decide.ts";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "../src/facts.ts";
import { at, CONFIG, facts, numbered, receipt, SLICE_WF, SOLO_WF, STORY_WF, sliceFile, sliceUnit, stateFor, storyFacts, storyUnit, T0, unitFacts, WORKFLOWS } from "./fixtures.ts";

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const HEADLESS = { runner: "headless", session_id: RUN };

/** A solo story whose one unit has `patch` state and a run on the headless runner. */
function solo(patch: Partial<UnitState>, run: Partial<RunFacts>): StoryFacts {
  const ref = storyUnit();
  const st = stateFor(ref, SOLO_WF, patch);
  const rf: RunFacts = { run_id: RUN, session: HEADLESS, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: null, ...run };
  return storyFacts("gh-1", [unitFacts(ref, SOLO_WF, st, { run: rf })], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "solo" } });
}

const running = (p: Partial<UnitState> = {}): Partial<UnitState> => ({
  status: "running",
  run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0 - 20 * 60_000), how: "auto", session: HEADLESS, agent: "claude", agent_session_id: "cs-1" },
  updated_at: at(T0 - 20 * 60_000),
  ...p,
});

describe("BUG-1: a resumed run's own agent lease and max_agents (K1)", () => {
  // max_agents 1, so the run's own lease alone fills the cap
  const ownLease: LeaseFile = { version: 1, kind: "agent", repo: "/r", story: "gh-1", slice: null, run_id: RUN, holder: { pid: 7, pid_start: "x" }, created_at: at() };
  const cfg = { ...CONFIG, max_agents: 1 };

  /** Headless runner (resume, no typing); the unit and the machine hold the run's own lease. */
  function headless(s: StoryFacts): Facts {
    (s.units[0] as UnitFacts).lease = ownLease;
    const f = facts([s]);
    return { ...f, machine: { ...f.machine, runner: "headless", runner_capabilities: { send: false, resume: true }, leases: [ownLease] } };
  }

  test("nudge resume: the run's own lease does not count", () => {
    const f = headless(solo(running(), { last_activity_at: T0 - 16 * 60_000 }));
    expect(decide(f, WORKFLOWS, cfg).find((d) => d.unit === "gh-1")?.rule).toBe("agent.stalled.nudge.resume");
  });

  test.failing("answer resume: the run's own lease does not count either", () => {
    const s = solo(running({ status: "parked", park: { kind: "ask", reason: "Q?", since: at() } }), {});
    const u = s.units[0] as UnitFacts;
    u.unapplied = [numbered(1, receipt(u.state as UnitState, "answer", { answer: "yes" }, "human"))];
    const d = decide(headless(s), WORKFLOWS, cfg).find((x) => x.unit === "gh-1");
    // today: noop answer.resume.queued ("max_agents 1 in use")
    expect(d?.action).toMatchObject({ kind: "apply_receipts", launch: { run_id: RUN, resume: "cs-1" } });
  });
});

describe("BUG-2: the route recorded for a git step's classify receipt", () => {
  test.failing("an exhausted counter routes to $stuck, as applyReceipts does", () => {
    const unit = sliceUnit("gh-1", "01", "s01");
    // integrate.conflict is counted by conflict_loop (max 2); 2 used, so this conflict exhausts it
    const st = stateFor(unit, SLICE_WF, { step: "integrate", attempt: 1, counters: { test_loop: 0, review_loop: 0, qa_loop: 0, conflict_loop: 2 } });
    const route = routeFor(SLICE_WF, "integrate", "conflict"); // what act writes into the classify receipt
    const r = receipt(st, "classify", { outcome: "conflict", rule: "git.integrate", detail: "conflict", route }, "norn");
    const res = applyReceipts(st, [numbered(1, r)], { workflow: SLICE_WF } as never);
    expect({ step: res.state.step, status: res.state.status }).toEqual({ step: "integrate", status: "stuck" });
    // today: "merge" — the transition target, as if the counter had room
    expect(route).toBe("$stuck");
  });
});

describe("BUG-5: a broken slice file of a slice not started yet", () => {
  test.failing("decide notes slices.file_invalid instead of throwing", () => {
    const unit = storyUnit();
    const st = stateFor(unit, STORY_WF, { status: "ready", park: null, step: "slices" });
    const s = storyFacts("gh-1", [unitFacts(unit, STORY_WF, st)], {
      frontmatter: { ...storyFacts("gh-1", []).frontmatter!, refined_body_hash: storyFacts("gh-1", []).frontmatter!.body_hash },
      slices: [{ ...sliceFile("gh-1", "01", "form"), frontmatter: null, error: { file: ".agents/specs/gh-1-login/slices/01-form.md", errors: [{ path: "/id", message: "bad" }] } }],
    });
    // today: TypeError: null is not an object (evaluating 's.frontmatter.depends_on')
    expect(decide(facts([s]), WORKFLOWS, CONFIG).map((d) => d.rule)).toEqual(["slices.file_invalid"]);
  });
});
