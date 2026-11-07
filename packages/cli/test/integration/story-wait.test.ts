/**
 * `norn story wait <story> --until <condition> [--timeout <d>]`: blocks until the
 * story's state meets the condition, then prints that state as JSON; the exit code tells met (0),
 * timed out (7), a bad condition (2) and an unknown story (3) apart. The conditions themselves are
 * covered on `@norn/view`'s `waitMet` (packages/view/test/unit/wait.test.ts).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { ExitCode } from "@norn/schema";
import { workflowsDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

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
    outcomes: { approve: $done, reject: $stuck }
`;

let h: Harness;
const runs = () => runStateOf(join(`${h.root}-worktrees/gh-1-pay-invoices`, ".agents/specs/gh-1-pay-invoices"));
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });
/** a pause that only moves the fake clock, with what happens meanwhile */
const sleeper = (meanwhile: () => Promise<unknown> = async () => {}) => {
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
    h.clock.advance(ms);
    await meanwhile();
  };
  return { slept, sleep };
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: gated\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "gated.yaml"), GATED);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices")];
  await h.tick("--sync");
  for (let i = 0; i < 8 && h.state(runs())?.status !== "running"; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "work", status: "running" });
});
afterAll(() => h.cleanup());

describe("refused before waiting", () => {
  test("a missing or unknown condition and a bad duration are usage errors (2)", async () => {
    for (const argv of [["gh-1"], ["gh-1", "--until", "sync.done"], ["gh-1", "--until", "gate", "--timeout", "soon"], ["gh-1", "--until", "gate", "--interval", "0s"]]) {
      const r = await h.norn("story", "wait", ...argv);
      expect([argv, r.exit]).toEqual([argv, ExitCode.usage]);
      expect(r.value).toMatchObject({ do_instead: expect.stringContaining("norn story wait gh-1 --until") });
    }
  });

  test("an unknown story or slice is refused (3)", async () => {
    for (const key of ["gh-9", "gh-1/04"]) {
      const r = await h.norn("story", "wait", key, "--until", "gate");
      expect([key, r.exit]).toEqual([key, ExitCode.refused]);
      expect(r.value).toMatchObject({ code: "unknown_unit" });
    }
  });
});

describe("waiting", () => {
  test("a condition that already holds returns at once with the state (0)", async () => {
    const { slept, sleep } = sleeper();
    const r = await norn({ sleep }, "story", "wait", "gh-1", "--until", "step=work");
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.value).toMatchObject({ met: true, until: "step=work", matched: "gh-1", waited_ms: 0, state: { story: "gh-1", unit: { key: "gh-1", status: "running", step: "work" } } });
    expect(slept).toEqual([]);
  });

  test("--timeout ends the wait with the state as it stands and exit 7, never 0", async () => {
    const { slept, sleep } = sleeper();
    const r = await norn({ sleep }, "story", "wait", "gh-1", "--until", "gate", "--timeout", "12s", "--interval", "5s");
    expect(r.exit).toBe(ExitCode.timeout);
    expect(r.value).toMatchObject({ met: false, until: "gate", matched: null, waited_ms: 12_000, state: { unit: { step: "work", status: "running" } } });
    expect(slept).toEqual([5_000, 5_000, 2_000]);
  });

  test("a stop signal ends the wait like a timeout (7)", async () => {
    const stop = new AbortController();
    const { sleep } = sleeper(async () => stop.abort());
    const r = await norn({ sleep, signal: stop.signal }, "story", "wait", "gh-1", "--until", "gate");
    expect(r.exit).toBe(ExitCode.timeout);
    expect(r.value).toMatchObject({ met: false });
  });

  test("it blocks while the story moves on and returns once it parks at the gate (0)", async () => {
    let reported = false;
    const { slept, sleep } = sleeper(async () => {
      if (!reported) h.report(runs(), "done", { outcome: "done", handoff: "ready" });
      reported = true;
      await h.tick();
    });
    const r = await norn({ sleep }, "story", "wait", "gh-1", "--until", "gate", "--timeout", "10m");
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.value).toMatchObject({ met: true, matched: "gh-1", state: { unit: { step: "review", status: "parked", park: { kind: "gate" } } } });
    expect(slept.length).toBeGreaterThan(0);
  });

  test("the round's end is `done`, not a step whose name ends in done", async () => {
    expect((await h.norn("story", "approve", "gh-1")).exit).toBe(0);
    for (let i = 0; i < 4 && h.state(runs())?.status !== "done"; i++) await tick();
    const r = await norn({ sleep: sleeper().sleep }, "story", "wait", "gh-1", "--until", "done", "--timeout", "1s");
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.value).toMatchObject({ met: true, until: "done", state: { unit: { status: "done", step: "$done" } } });
  });
});
