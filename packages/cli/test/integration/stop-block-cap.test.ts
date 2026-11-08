/**
 * A run's Stop hooks refuse at most MAX_STOP_BLOCKS turn ends, even when hooks fire together: the
 * traced count of refusals is read before a hook appends its own line, so the cap holds only because
 * each refusal is taken exclusively first. A concurrent hook that has taken its refusal but not yet
 * traced it is modelled by taking one directly, since the hook's read-then-append section is synchronous
 * in one process and cannot interleave there.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type HookTrace } from "@norn/schema";
import { blockedHookCount, claimStopBlock, readTrace, workflowsDir } from "@norn/store";
import { MAX_STOP_BLOCKS } from "../../src/commands/hook.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "the change is made" } }
`;

let h: Harness;
const spec = ".agents/specs/gh-9-racing-hooks";
const wt = () => `${h.root}-worktrees/gh-9-racing-hooks`;
const runs = () => runStateOf(join(wt(), spec));

function env() {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
const hook = (event: string, payload: Record<string, unknown>) =>
  runChecked(["hook", event], { ...h.deps, cwd: wt(), env: env(), stdin: JSON.stringify({ session_id: "sess-A", transcript_path: "/tmp/sess-A.jsonl", cwd: wt(), ...payload }) });
const stop = () => hook("stop", { hook_event_name: "Stop", stop_hook_active: false });

let runId = "";

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: solo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Racing hooks")];
  const ready = () => existsSync(join(runs(), "state.json")) && h.state(runs())?.status === "ready";
  for (let i = 0; i < 10 && !ready(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(ready()).toBe(true);
  await hook("pre-tool-use", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "norn brief --json" } });
  const r = await runChecked(["brief", "--json"], { ...h.deps, cwd: wt(), env: env() });
  expect(r.exit).toBe(0);
  runId = (r.value as { run_id: string }).run_id;
  h.clock.advance(10_000);
  await h.tick();
  expect(h.state(runs())).toMatchObject({ status: "running", run: { run_id: runId } });
});
afterAll(() => h.cleanup());

describe("the Stop-hook cap holds for hooks that fire together", () => {
  test("a refusal a concurrent hook took but has not traced yet counts against the cap", async () => {
    const unit = { story: "gh-9" };
    for (let i = 0; i < MAX_STOP_BLOCKS - 1; i++) expect((await stop()).value).toMatchObject({ decision: "block" });
    expect(blockedHookCount(h.root, unit, runId)).toBe(MAX_STOP_BLOCKS - 1);
    // the concurrent hook read the same traced count and took the last refusal
    expect(claimStopBlock(h.root, runId, MAX_STOP_BLOCKS - 1, MAX_STOP_BLOCKS)).toBe(true);
    const late = await stop();
    expect(late.value).toEqual({});
    // its fact is still traced, only not as a refusal
    const last = (readTrace(h.root, { types: ["hook"] }).events as HookTrace[]).filter((e) => e.fact.run_id === runId).at(-1);
    expect(last?.fact).toMatchObject({ event: "turn_end", native: "Stop" });
    expect(last?.blocked).toBeUndefined();
    expect(blockedHookCount(h.root, unit, runId)).toBe(MAX_STOP_BLOCKS - 1);
    expect((await stop()).value).toEqual({});
  });
});
