/**
 * H12 (bypass #265): `norn watch` runs the next tick at once after a tick that left a follow-up (a
 * receipt applied, a unit started), up to SETTLE_TICKS in a row, then waits its interval. H13: a
 * receipt another process appends while it waits wakes it. Driven through `runCli` with the harness
 * and an injected sleep that records each pause.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { machineDir, machineDirOfRunState, touchWake, wakePath, workflowsDir } from "@norn/store";
import { settleStep, SETTLE_TICKS } from "../../src/commands/watch.ts";
import type { Context } from "../../src/context.ts";
import { abortableSleep } from "../../src/runtime/tick-lock.ts";
import { pauseUntilWake, wakeStamp } from "../../src/runtime/wake.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const PAIR = `name: pair
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: review }
  review:
    type: agent
    skill: norn-review
    outcomes: { approve: $done }
`;

interface Line {
  decisions?: Array<{ unit: string; kind: string; rule: string }>;
  follow_up?: true;
}

describe("watch settles at once after a tick that changed run state (H12)", () => {
  let h: Harness;
  const runs = () => runStateOf(join(`${h.root}-worktrees/gh-7-settle-me`, ".agents/specs/gh-7-settle-me"));

  /** `norn watch --interval 1h`: every pause is recorded (and advances the fake clock) instead of waited */
  async function watch(maxTicks: number) {
    const lines: Line[] = [];
    const pauses: number[] = [];
    const r = await runChecked(["watch", "--interval", "1h", "--max-ticks", String(maxTicks), "--keep-claims"], {
      ...h.deps,
      log: (l) => lines.push(JSON.parse(l) as Line),
      sleep: async (ms) => {
        pauses.push(ms);
        h.clock.advance(ms);
      },
    });
    expect(r.exit).toBe(0);
    return { lines, pauses };
  }
  const acted = (l: Line) => (l.decisions ?? []).filter((d) => d.unit === "gh-7" && d.rule !== "claim.renew").map((d) => d.kind);

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config("provider: gh\nworkflow: pair\nmode: auto\n");
    h.write(join(workflowsDir(h.root), "pair.yaml"), PAIR);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Settle me")];
    for (let i = 0; i < 8 && h.state(runs())?.status !== "running"; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    expect(h.state(runs())).toMatchObject({ status: "running", step: "implement" });
    h.clock.advance(10_000);
    await h.tick(); // settle whatever the launch left (a recovery commit)
  });
  afterAll(() => h.cleanup());

  test("a receipt applied: the next step starts in the very next tick, with no pause between them", async () => {
    const launched = h.runner.launches.length;
    h.report(runs(), "done", { outcome: "done", handoff: "built" });
    h.clock.advance(1000);
    const { lines, pauses } = await watch(3);
    expect(acted(lines[0]!)).toEqual(["apply_receipts"]);
    expect(lines[0]!.follow_up).toBe(true);
    // the review agent starts in tick 2, not an hour later
    expect(acted(lines[1]!)).toEqual(["start_run"]);
    expect(lines[1]!.follow_up).toBeUndefined();
    expect(h.runner.launches.length).toBe(launched + 1);
    expect(h.state(runs())).toMatchObject({ status: "running", step: "review" });
    // tick 2 left nothing for an immediate tick: watch pauses its interval before tick 3
    expect(pauses).toEqual([3_600_000]);
  });

  test("a quiet tick waits the interval", async () => {
    const { lines, pauses } = await watch(2);
    expect(lines.every((l) => !l.follow_up)).toBe(true);
    expect(pauses).toEqual([3_600_000]);
  });

  test("H13: a receipt written while watch pauses wakes it: the next tick applies it at once, not an hour later", async () => {
    const lines: Line[] = [];
    let pauses = 0;
    const t0 = performance.now();
    const r = await runChecked(["watch", "--interval", "1h", "--max-ticks", "2", "--keep-claims"], {
      ...h.deps,
      log: (l) => lines.push(JSON.parse(l) as Line),
      // a real pause (ended early only by its signal); the agent reports 50 ms into it
      sleep: (ms, signal) => {
        if (pauses++ === 0) setTimeout(() => h.report(runs(), "done", { outcome: "approve", handoff: "looks right" }), 50);
        return abortableSleep(ms, signal);
      },
    });
    expect(r.exit).toBe(0);
    expect(pauses).toBe(1);
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(acted(lines[1]!)).toEqual(["apply_receipts"]);
  });
});

describe("pauseUntilWake (H13)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    await h.tick(); // the machine dir and its checkout.json
  });
  afterAll(() => h.cleanup());
  const ctx = () => ({ root: h.root, sleep: abortableSleep }) as unknown as Context;
  const machine = () => machineDir(h.root);

  test("a stamp this process wrote during the tick does not wake; one another process wrote does, at once", async () => {
    const since = wakeStamp(h.root);
    writeFileSync(wakePath(machine()), `${process.pid} own\n`); // the tick's own receipt (git step's classify)
    expect(await pauseUntilWake(ctx(), 100, since)).toBe("interval");
    const before = wakeStamp(h.root);
    writeFileSync(wakePath(machine()), `999999 other\n`); // `norn done` in an agent's process, during the tick
    const t0 = performance.now();
    expect(await pauseUntilWake(ctx(), 60_000, before)).toBe("wake");
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("a receipt appended during the pause wakes it within about a second; a burst is one wake", async () => {
    const unitDir = join(machine(), "runs", "gh-1", "_story");
    const since = wakeStamp(h.root);
    setTimeout(() => {
      touchWake(unitDir);
      touchWake(unitDir);
      touchWake(unitDir);
    }, 50);
    const t0 = performance.now();
    expect(await pauseUntilWake(ctx(), 60_000, since)).toBe("wake");
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(wakeStamp(h.root)).not.toBe(since);
  });

  test("a run-state folder outside a machine dir touches nothing", () => {
    expect(machineDirOfRunState(join(h.dir, "elsewhere", "runs", "gh-1", "_story"))).toBeNull();
    expect(machineDirOfRunState(join(machine(), "runs", "gh-1", "_story", "rounds", "01-story"))).toBe(machine());
  });

  test("Ctrl-C ends the pause as an interval, never a wake", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    expect(await pauseUntilWake(ctx(), 60_000, wakeStamp(h.root), ac.signal)).toBe("interval");
  });
});

describe("settleStep bounds the chain (H12)", () => {
  test("at most SETTLE_TICKS ticks run at once in a row; a quiet tick or the bound resets it", () => {
    let settling = 0;
    const now: boolean[] = [];
    for (let i = 0; i < SETTLE_TICKS + 2; i++) {
      const next = settleStep(true, settling);
      settling = next.settling;
      now.push(next.now);
    }
    // a unit that keeps changing: SETTLE_TICKS ticks at once, then a pause, then again
    expect(now).toEqual([...Array<boolean>(SETTLE_TICKS).fill(true), false, true]);
    expect(settleStep(false, 2)).toEqual({ now: false, settling: 0 });
  });
});
