/**
 * A person command that needs the tick lock waits for a running tick, up to 60s, then
 * runs as it does today; `tick`, `migrate` and `story edit --auto|--manual` do not wait
 *. Time is faked through the injected `sleep`, which advances the fake clock; the test
 * process holds the lock itself, so it is a live holder.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acquireTickLock, tickLockPath, workflowsDir } from "@norn/store";
import type { CliDeps } from "../../src/context.ts";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const GATED = `name: gated
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "the change is ready to look at" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: work, counter: loop } }
counters: { loop: { max: 2 } }
`;

const ALT = `name: alt
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "drafted" } }
`;

const WAIT_LINE = /^waiting for a running tick \(pid \d+, norn tick, since \d\d:\d\d:\d\d\) — up to 60s…$/;

let h: Harness;
const spec6 = ".agents/specs/gh-6-export-report";
const wt6 = () => h.worktree("gh-6-export-report");
const runs6 = () => runStateOf(join(wt6(), spec6));
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};

type Lock = Awaited<ReturnType<typeof acquireTickLock>> & { ok: true };
async function hold(note = "norn tick"): Promise<Lock> {
  const lock = await acquireTickLock(h.root, { note, now: () => h.clock.iso() });
  if (!lock.ok) throw new Error("tick lock already held");
  return lock;
}

interface Run {
  r: CliResult;
  logs: string[];
  sleeps: number;
  waited: number;
}
/** Run a command with a fake sleep: each call advances the fake clock by `ms`, then runs `onSleep(n)`. */
async function run(argv: string[], opts: { onSleep?: (n: number) => Promise<void> | void; signal?: AbortSignal } = {}): Promise<Run> {
  const logs: string[] = [];
  let sleeps = 0;
  const start = h.clock.now();
  const deps: CliDeps = {
    ...h.deps,
    log: (l) => logs.push(l),
    ...(opts.signal ? { signal: opts.signal } : {}),
    sleep: async (ms) => {
      sleeps++;
      h.clock.advance(ms);
      await opts.onSleep?.(sleeps);
    },
  };
  const r = await runChecked(argv, deps);
  return { r, logs, sleeps, waited: h.clock.now() - start };
}

const runsSnapshot = () => {
  // The story's run state, in the machine dir
  const dir = storyRunStateOf(join(wt6(), spec6));
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort()
    .map((f) => [f, readFileSync(f, "utf8")]);
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: gated\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "gated.yaml"), GATED);
  h.write(join(workflowsDir(h.root), "alt.yaml"), ALT);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report", ["norn", "norn:wf:alt"])];
  await tick();
  await tick();
  await tick();
  await tick();
  expect(h.state(runs6())).toMatchObject({ workflow: "alt", step: "draft", status: "running" });
});
afterAll(() => h.cleanup());

describe("waiting for a running tick (tidy)", () => {
  test("B1: no tick running → runs at once, no wait line, never sleeps", async () => {
    const { r, logs, sleeps } = await run(["tidy", "--json"]);
    expect(r.exit).toBe(0);
    expect(logs).toEqual([]);
    expect(sleeps).toBe(0);
  });

  test("B2, B3, B4: a running tick → one wait line on stderr, then runs; stdout as without a wait", async () => {
    const plain = await run(["tidy", "--json"]);
    const lock = await hold();
    const { r, logs, sleeps } = await run(["tidy", "--json"], { onSleep: (n) => void (n === 3 && lock.release()) });
    expect(r.exit).toBe(plain.r.exit);
    expect(r.stdout).toBe(plain.r.stdout);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(WAIT_LINE);
    expect(logs[0]).toContain(`pid ${process.pid}`);
    expect(sleeps).toBe(3);
  });

  test("B7: still running after 60s → tick_locked (busy), naming the holder and the wait", async () => {
    const lock = await hold();
    try {
      const { r, logs, waited } = await run(["tidy", "--json"]);
      expect(r.exit).toBe(5);
      expect(r.value).toMatchObject({ code: "tick_locked", do_instead: "retry: norn tidy" });
      const error = (r.value as { error: string }).error;
      expect(error).toContain(`pid ${process.pid}`);
      expect(error).toContain("norn tick");
      expect(error).toContain("waited 60s");
      expect(error).toMatch(/since \d\d:\d\d:\d\d/);
      expect(waited).toBeGreaterThanOrEqual(60_000);
      expect(waited).toBeLessThan(61_000);
      expect(logs).toHaveLength(1);
    } finally {
      lock.release();
    }
  });

  test("B8: a lock left by a dead tick is taken over at once", async () => {
    h.write(tickLockPath(h.root), JSON.stringify({ holder: { pid: 999_999, pid_start: "Thu Jan  1 00:00:00 1970" }, acquired_at: h.clock.iso(), note: "norn tick" }));
    const { r, logs, sleeps } = await run(["tidy", "--json"]);
    expect(r.exit).toBe(0);
    expect(logs).toEqual([]);
    expect(sleeps).toBe(0);
  });

  test("B9: Ctrl-C while waiting → refuses, the lock never taken, nothing written", async () => {
    const lock = await hold();
    try {
      const before = runsSnapshot();
      const lockBefore = readFileSync(tickLockPath(h.root), "utf8");
      const ac = new AbortController();
      const { r } = await run(["story", "edit", "gh-6", "--at", "draft", "--json"], { signal: ac.signal, onSleep: () => ac.abort() });
      expect(r.exit).toBe(5);
      expect(r.value).toMatchObject({ code: "tick_locked" });
      expect((r.value as { error: string }).error).toContain("interrupted while waiting for a running tick");
      expect(readFileSync(tickLockPath(h.root), "utf8")).toBe(lockBefore);
      expect(runsSnapshot()).toEqual(before);
    } finally {
      lock.release();
    }
  });

  test("B10, D6: a holder that changes is waited on within one budget and one line; both commands complete", async () => {
    let lock = await hold();
    let second: Run | null = null;
    const first = await run(["tidy", "--json"], {
      async onSleep(n) {
        if (n === 1) {
          // another person command takes the lock as the tick leaves it
          lock.release();
          lock = await hold("norn story edit --at");
        } else if (n === 2) {
          lock.release();
          second = await run(["tidy", "--json"]);
        }
      },
    });
    expect(first.r.exit).toBe(0);
    expect(first.logs).toHaveLength(1);
    expect(second!.r.exit).toBe(0);
  });
});

describe("judged after the wait", () => {
  test("B6: a refusal comes right after the wait", async () => {
    const lock = await hold();
    const { r, logs } = await run(["story", "edit", "gh-6", "--workflow", "gated", "--json"], { onSleep: () => void lock.release() });
    expect(logs).toHaveLength(1);
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "round_unfinished" });
  });
});

describe("no wait (B11, B13–B15)", () => {
  test("B15: story edit --manual while a tick runs → at once, no wait line", async () => {
    const lock = await hold();
    try {
      const { r, logs, sleeps } = await run(["story", "edit", "gh-5", "--manual", "--json"]);
      expect(r.exit).toBe(0);
      expect(logs).toEqual([]);
      expect(sleeps).toBe(0);
    } finally {
      lock.release();
    }
    expect((await h.norn("story", "edit", "gh-5", "--auto", "--json")).exit).toBe(0);
  });

  test("B14: norn tick refuses at once", async () => {
    const lock = await hold();
    try {
      const { r, sleeps } = await run(["tick", "--json"]);
      expect(r.value).toMatchObject({ code: "tick_locked" });
      expect(sleeps).toBe(0);
    } finally {
      lock.release();
    }
  });

  test("B11, B12: watch skips a busy tick, then its exit release waits for the tick and releases", async () => {
    const lock = await hold();
    const { r, logs } = await run(["watch", "--max-ticks", "1", "--json"], { onSleep: () => void lock.release() });
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ticks: 1, skipped_busy: 1 });
    const released = (r.value as { released: Array<{ ok: boolean }> }).released;
    expect(released.length).toBeGreaterThan(0);
    expect(released.every((x) => x.ok)).toBe(true);
    expect(logs.filter((l) => WAIT_LINE.test(l))).toHaveLength(1);
    // the claims are back for the remaining tests
    await tick();
  });
});

const waitsThenRuns = async (argv: string[]) => {
  const lock = await hold();
  try {
    const { r, logs } = await run([...argv, "--json"], { onSleep: () => void lock.release() });
    expect(logs).toHaveLength(1);
    expect(r.value).not.toMatchObject({ code: "tick_locked" });
    return r;
  } finally {
    lock.release();
  }
};

describe("each person command waits, then runs (a missed call site fails here)", () => {
  test("story edit --at", async () => {
    expect((await waitsThenRuns(["story", "edit", "gh-5", "--at", "work"])).exit).toBe(0);
  });
  test("story edit --workflow", async () => {
    expect((await waitsThenRuns(["story", "edit", "gh-6", "--workflow", "nope"])).value).toMatchObject({ code: "unknown_workflow" });
  });
  test("story checkout", async () => {
    expect((await waitsThenRuns(["story", "checkout", "gh-6"])).exit).toBe(0);
  });
  test("story reset", async () => {
    expect((await waitsThenRuns(["story", "reset", "gh-5"])).value).toMatchObject({ code: expect.stringMatching(/^(has_work|confirm_required)$/) });
  });
  test("story handoff", async () => {
    expect((await waitsThenRuns(["story", "handoff", "gh-5"])).exit).toBe(0);
  });
});

describe("B5: judged against the state the tick left", () => {
  test("a tick applies the agent's done while story edit --at waits → refused at the new cursor", async () => {
    h.report(runs6(), "done", { outcome: "done", handoff: "drafted" });
    const lock = await hold();
    const { r, logs } = await run(["story", "edit", "gh-6", "--at", "draft", "--json"], {
      async onSleep() {
        lock.release();
        await tick();
      },
    });
    expect(logs).toHaveLength(1);
    expect(h.state(runs6())).toMatchObject({ step: "$done" });
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "round_finished" });
  });
});

describe("closing and reopening wait too", () => {
  test("story close", async () => {
    expect((await waitsThenRuns(["story", "close", "gh-5", "--yes"])).value).toMatchObject({ story: "gh-5", dropped: true });
  });
  test("story reopen", async () => {
    expect((await waitsThenRuns(["story", "reopen", "gh-5"])).exit).toBe(0);
  });
});
