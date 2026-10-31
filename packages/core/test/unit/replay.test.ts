/**
 * Replayed sequence (X4, §19 criterion 2): a scripted agent, check and act loop over many
 * ticks. Proves that no step executes twice for the same attempt (beyond counted retries),
 * counters never exceed their max, and receipts re-applied after a crash change nothing.
 */
import { expect, test } from "bun:test";
import { deriveUlid, type HookFact, type Receipt, type UnitState, type Workflow } from "@norn/schema";
import type { Decision } from "../../src/actions.ts";
import { decide } from "../../src/decide/index.ts";
import type { NumberedReceipt, RunFacts } from "../../src/facts.ts";
import { at, CONFIG, facts, loaded, stateFor, storyFacts, storyUnit, T0, unitFacts } from "../fixtures.ts";

const WF: Workflow = {
  name: "loop",
  start: "implement",
  steps: {
    implement: { type: "agent", skill: "implement", nudges: 1, retries: 1, outcomes: { done: "test" } },
    test: { type: "check", run: "bun test", timeout: "1m", outcomes: { pass: "review", fail: { to: "implement", counter: "test_loop" } } },
    review: { type: "agent", skill: "review", outcomes: { approve: "$done", changes_requested: { to: "implement", counter: "review_loop" } } },
  },
  counters: { test_loop: { max: 2 }, review_loop: { max: 3 } },
};

interface Sim {
  state: UnitState;
  receipts: NumberedReceipt[];
  run: RunFacts | null;
  /** what the live agent will do on the next tick */
  pending: "report" | "silent" | "die" | null;
}

test("scripted ticks: each attempt runs once, counters stay bounded, exhaustion parks", () => {
  const unit = storyUnit();
  const sim: Sim = { state: stateFor(unit, WF), receipts: [], run: null, pending: null };
  const executions = new Map<string, Set<string>>(); // `${step}#${attempt}` → run ids
  const checks = new Map<string, number>();
  let checkRuns = 0;
  let agentRuns = 0;
  let crashOnce = true;
  const scriptAgent = (step: string, n: number): "report" | "silent" | "die" => (step === "implement" && n === 1 ? "silent" : step === "implement" && n === 3 ? "die" : "report");
  const outcomeFor = (step: string) => (step === "implement" ? "done" : "changes_requested");
  const write = (r: Receipt) => sim.receipts.push({ n: (sim.receipts.at(-1)?.n ?? 0) + 1, file: "", receipt: r });

  for (let k = 0; k < 60; k++) {
    const now = T0 + k * 60_000;
    const tick = deriveUlid("01JAAAAAAAAAAAAAAAAAAAAAAA", k);
    // ---- the agent acts between ticks
    if (sim.run) sim.run.last_activity_at = now - 1000;
    if (sim.run && sim.state.run) {
      const { step, attempt, run_id } = sim.state.run;
      if (sim.pending === "report") write({ kind: "done", receipt_id: deriveUlid(tick, 900), run_id, step, attempt, at: at(now - 1000), by: "agent", outcome: outcomeFor(step), handoff: "h" });
      if (sim.pending === "silent") sim.run.hooks = [{ event: "turn_end", at: at(now - 1000), agent: "claude", native: "Stop", cwd: "/w" } as HookFact];
      if (sim.pending === "die") sim.run.process_alive = false;
      sim.pending = null;
    }
    // ---- observe
    const uf = unitFacts(unit, WF, sim.state, { unapplied: sim.receipts.filter((r) => r.n > sim.state.applied_through), run: sim.run });
    const f = facts([storyFacts("gh-1", [uf], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "loop" }, claim: { state: "mine", sha: "c", blob: { version: 1, story: "gh-1", holder: "jakub@mac", heartbeat_id: "01JBBBBBBBBBBBBBBBBBBBBBBB", acquired_at: at(now), renewed_at: at(now), expires_at: at(now + 600_000), last_tick_id: null } } })], { tick_id: tick }, now);
    const decisions: Decision[] = decide(f, { loop: loaded(WF) }, CONFIG);
    expect(decide(f, { loop: loaded(WF) }, CONFIG)).toEqual(decisions); // pure + deterministic
    expect(decisions.filter((d) => d.unit === "gh-1")).toHaveLength(1); // ≤ 1 action per unit
    const a = decisions[0]!.action;

    // ---- act
    if ("receipts" in a) for (const r of a.receipts) sim.receipts.push({ n: r.n, file: "", receipt: r.receipt });
    switch (a.kind) {
      case "start_run":
      case "retry_fresh": {
        const launch = a.launch;
        if (!launch) break;
        agentRuns++;
        const key = `${a.state!.step}#${a.state!.attempt}`;
        executions.set(key, (executions.get(key) ?? new Set()).add(launch.run_id));
        sim.run = { run_id: launch.run_id, session: { runner: "herdr", session_id: launch.run_id }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: now, transcript: null };
        sim.pending = scriptAgent(a.state!.step, agentRuns);
        // act fills the session from the launch result before writing state
        a.state!.run = { ...a.state!.run!, session: { runner: "herdr", session_id: launch.run_id } };
        if (crashOnce && a.kind === "start_run" && a.state!.step === "review") {
          crashOnce = false; // crash between effect and state write: receipts on disk, state not
          continue;
        }
        break;
      }
      case "nudge":
        sim.pending = "report";
        break;
      case "run_check": {
        const key = `${a.step}#${sim.state.attempt}`;
        checks.set(key, (checks.get(key) ?? 0) + 1);
        checkRuns++;
        const outcome = checkRuns <= 2 ? "fail" : "pass";
        write({ kind: "check", receipt_id: deriveUlid(tick, 901), run_id: a.run_id, step: a.step, attempt: sim.state.attempt, at: at(now), by: "norn", outcome, command: a.command, exit_code: outcome === "pass" ? 0 : 1, duration_ms: 10, output_tail: "" });
        break;
      }
    }
    if ("state" in a && a.state) {
      if (a.state.run?.run_id !== sim.state.run?.run_id && !a.state.run) sim.run = null;
      sim.state = a.state;
    }
    for (const [c, v] of Object.entries(sim.state.counters)) expect(v).toBeLessThanOrEqual(WF.counters![c]!.max);
  }

  // every attempt ran at most 1 + retries agent runs, and each check attempt exactly once
  for (const [key, runs] of executions) expect({ key, runs: runs.size }).toEqual({ key, runs: runs.size <= 2 ? runs.size : -1 });
  expect([...executions.values()].filter((s) => s.size === 2)).toHaveLength(1); // the scripted death
  for (const [key, n] of checks) expect({ key, n }).toEqual({ key, n: 1 });

  expect(sim.state).toMatchObject({ step: "review", status: "stuck", counters: { test_loop: 2, review_loop: 3 } });
  expect(sim.state.park?.reason).toBe("review_loop 3/3 at review.changes_requested");
  // fully applied, and nothing more happens
  expect(sim.state.applied_through).toBe(sim.receipts.at(-1)!.n);
});
