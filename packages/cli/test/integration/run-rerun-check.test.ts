/**
 * A check that failed on a glitch is retried on the same code with one command. While
 * the unit sits at the step that check's fail sent it to (ready or running), `norn run rerun <unit>
 * --step <check>` is accepted; the next tick stops the step's session and runs the check again.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Receipt } from "@norn/schema";
import { workflowsDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const glitch = mkdtempSync(join(tmpdir(), "norn-gh213-"));
// fails the first time only: a glitch, not the code
const FLOW = `name: flow
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: test, means: "built" } }
  test:
    type: check
    run: test -e ${glitch}/once || { touch ${glitch}/once; exit 1; }
    timeout: 1m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;

let h: Harness;
const dir = "gh-9-pay-invoices";
const wt = () => `${h.root}-worktrees/${dir}`;
const checkRetry = async () => ((await h.norn("run", "view", "gh-9", "--json")).value as { check_retry: unknown }).check_retry;
const runs = () => runStateOf(join(`${h.root}-worktrees`, `${dir}/.agents/specs/${dir}`));
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const refused = (r: CliResult, code: string) => {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code });
};

beforeAll(async () => {
  h = await createHarness();
  h.config("provider: gh\nworkflow: flow\nmode: auto\n");
  h.recordVersion();
  h.write(join(workflowsDir(h.root), "flow.yaml"), FLOW);
  installBundledSkills(h.root);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Pay invoices")];
  for (let i = 0; i < 4; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "implement", status: "running" });
});
afterAll(() => {
  h.cleanup();
  rmSync(glitch, { recursive: true, force: true });
});

describe("run rerun --step <check> on the step its fail sent the unit to", () => {
  test("the check fails on a glitch and sends the unit back to implement, which runs", async () => {
    h.report(runs(), "done", { outcome: "done", handoff: "built" });
    for (let i = 0; i < 6 && !(h.state(runs())?.attempt === 2 && h.state(runs())?.status === "running"); i++) await tick();
    expect(h.state(runs())).toMatchObject({ step: "implement", attempt: 2, status: "running", last_outcome: { step: "test", outcome: "fail" }, counters: { test_loop: 1 } });
  });

  test("run view --json names the check, the rerun, and whether the work changed since (norn's own commits do not count)", async () => {
    expect(await checkRetry()).toEqual({ check: "test", failed_at: expect.any(String), code_changed: false, command: "norn run rerun gh-9 --step test" });
    writeFileSync(join(wt(), "pay.ts"), "export const pay = 1;\n");
    expect(await checkRetry()).toMatchObject({ check: "test", code_changed: true });
    sh(wt(), ["add", "pay.ts"]);
    sh(wt(), ["commit", "-q", "-m", "pay"]);
    expect(await checkRetry()).toMatchObject({ check: "test", code_changed: true });
    sh(wt(), ["reset", "-q", "--hard", "HEAD~1"]);
    expect(await checkRetry()).toMatchObject({ check: "test", code_changed: false });
  });

  test("rerun without --step, or at another step, is still refused: stopping it is run cancel", async () => {
    refused(await h.norn("run", "rerun", "gh-9"), "running");
    refused(await h.norn("run", "rerun", "gh-9", "--step", "implement"), "running");
  });

  test("rerun --step test is accepted; the next tick stops the session and the check passes on the same code", async () => {
    const session = h.state(runs())?.run?.session?.session_id;
    const r = await h.norn("run", "rerun", "gh-9", "--step", "test", "--reason", "CI glitch");
    expect(r.exit).toBe(0);
    expect((r.value as { receipt: Receipt }).receipt).toMatchObject({ kind: "unstick", to: "test", comment: "CI glitch", step: "implement", attempt: 2 });
    const killed = h.runner.killed.length;
    await tick();
    expect(h.runner.killed.slice(killed)).toEqual([expect.objectContaining({ session_id: session })]);
    for (let i = 0; i < 4 && h.state(runs())?.step !== "$done"; i++) await tick();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    expect(await checkRetry()).toBeNull();
  });
});
