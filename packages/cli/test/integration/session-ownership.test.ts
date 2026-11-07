/**
 * A run belongs to the agent session that started it. A second session in the unit
 * worktree cannot brief or report the run (`foreign_session`), its hook facts are not credited to
 * the run, its turn end is not blocked, and so its report never commits the first session's work.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type HookTrace } from "@norn/schema";
import { readTrace, workflowsDir } from "@norn/store";
import { type CliResult } from "../../src/index.ts";
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
const spec = ".agents/specs/gh-9-two-sessions";
const wt = () => `${h.root}-worktrees/gh-9-two-sessions`;
const runs = () => runStateOf(join(wt(), spec));
const receipts = () => (existsSync(join(runs(), "receipts")) ? readdirSync(join(runs(), "receipts")).sort() : []);

function env() {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
const hook = (session: string, event: string, payload: Record<string, unknown>) =>
  runChecked(["hook", event], { ...h.deps, cwd: wt(), env: env(), stdin: JSON.stringify({ session_id: session, transcript_path: `/tmp/${session}.jsonl`, cwd: wt(), ...payload }) });
/** `norn <argv>` as session `session` runs it: its PreToolUse fires first, then the command */
async function as(session: string, ...argv: string[]): Promise<CliResult> {
  await hook(session, "pre-tool-use", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `norn ${argv.join(" ")}` } });
  return runChecked(argv, { ...h.deps, cwd: wt(), env: env() });
}

let runId = "";

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: solo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Two sessions")];
  const ready = () => existsSync(join(runs(), "state.json")) && h.state(runs())?.status === "ready";
  for (let i = 0; i < 10 && !ready(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(ready()).toBe(true);
});
afterAll(() => h.cleanup());

describe("a run belongs to the session that started it", () => {
  test("session A's brief starts the run and records A", async () => {
    const r = await as("sess-A", "brief", "--json");
    expect(r.exit).toBe(0);
    runId = (r.value as { run_id: string }).run_id;
    const started = receipts().find((f) => f.endsWith("-started.json")) as string;
    expect(JSON.parse(h.read(join(runs(), "receipts", started)))).toMatchObject({ run_id: runId, agent_session_id: "sess-A" });
  });

  test("session B's brief is refused before and after the tick applies the run; it names A's session", async () => {
    for (const tick of [false, true]) {
      if (tick) {
        h.clock.advance(10_000);
        await h.tick();
        expect(h.state(runs())).toMatchObject({ status: "running", run: { run_id: runId, agent_session_id: "sess-A" } });
      }
      const r = await as("sess-B", "brief", "--json");
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "foreign_session", error: expect.stringContaining("sess-A"), do_instead: expect.stringContaining("norn run rerun gh-9") });
    }
    // A itself still gets its brief
    expect((await as("sess-A", "brief", "--json")).value).toMatchObject({ run_id: runId, started: false });
  });

  test("session B cannot report the run: done, ask and stuck are refused and write no receipt", async () => {
    h.write(join(wt(), "a-work-in-progress.ts"), "export const a = 1;\n");
    const before = receipts();
    for (const argv of [["done", "done", "--handoff", "x"], ["ask", "Is this mine?"], ["stuck", "not mine"]]) {
      const r = await as("sess-B", ...argv, "--json");
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "foreign_session" });
    }
    expect(receipts()).toEqual(before);
  });

  test("B's hook facts are not credited to A's run and B's turn end is not blocked; A's are and is", async () => {
    const b = await hook("sess-B", "stop", { hook_event_name: "Stop", stop_hook_active: false });
    expect(b.value).toEqual({});
    const a = await hook("sess-A", "stop", { hook_event_name: "Stop", stop_hook_active: false });
    expect(a.value).toMatchObject({ decision: "block" });
    const facts = (readTrace(h.root, { types: ["hook"] }).events as HookTrace[]).map((e) => e.fact);
    expect(facts.filter((f) => f.agent_session_id === "sess-B").every((f) => !f.run_id)).toBe(true);
    expect(facts.filter((f) => f.agent_session_id === "sess-A").at(-1)).toMatchObject({ run_id: runId });
  });

  test("the run's own session reports it", async () => {
    const r = await as("sess-A", "done", "done", "--handoff", "made it", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ ok: true, run_id: runId });
  });
});
