/**
 * `norn hook` on a pre-tool file write in a unit worktree: the cli resolves the written path for
 * real (relative to the payload's cwd, the nearest existing parent through realpath) and core
 * denies one landing under the checkout's run state; reads, shell commands and writes elsewhere pass.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { machineRunsDir, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "every criterion has a passing test" } }
`;

let h: Harness;
const wt = () => h.worktree("gh-9-manual-thing");
const runs = () => runStateOf(join(wt(), ".agents/specs/gh-9-manual-thing"));
const REASON = "a hand-edited file fails validation and makes the unit `corrupt`";

function env() {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
const preTool = (tool_name: string, tool_input: Record<string, unknown>, cwd = wt()) =>
  runChecked(["hook", "pre-tool-use", "--agent", "claude"], {
    ...h.deps,
    cwd,
    env: env(),
    stdin: JSON.stringify({ session_id: "sess-1", transcript_path: "/tmp/t.jsonl", cwd, hook_event_name: "PreToolUse", tool_name, tool_input }),
  });
const write = (file_path: string, cwd?: string) => preTool("Write", { file_path, content: "{}" }, cwd);
const denied = (value: unknown) => (value as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: solo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Manual thing")];
  for (let i = 0; i < 10 && h.state(runs())?.step !== "implement"; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(h.state(runs())?.step).toBe("implement");
  expect((await runChecked(["brief"], { ...h.deps, cwd: wt(), env: env() })).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("norn hook: file-tool writes under run state", () => {
  test("a write to this unit's state, another unit's, or a file not there yet is denied with the corrupt reason", async () => {
    const all = machineRunsDir(h.root);
    for (const p of [join(runs(), "state.json"), join(all, "gh-77", "_story", "state.json"), join(all, "gh-9", "new-dir", "x.json")]) {
      const r = await write(p);
      expect(r.exit).toBe(0);
      expect(denied(r.value)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringContaining(REASON) });
    }
  });

  test("a relative path, resolved against the payload's cwd, is denied when it lands under run state", async () => {
    const r = await write(relative(wt(), join(runs(), "state.json")));
    expect(denied(r.value)?.permissionDecision).toBe("deny");
    const sub = join(wt(), "packages");
    mkdirSync(sub, { recursive: true });
    expect(denied((await write(relative(sub, join(runs(), "receipts", "x.json")), sub)).value)?.permissionDecision).toBe("deny");
  });

  test("a path through a symlink into run state is denied; one through a symlink elsewhere is allowed", async () => {
    symlinkSync(runs(), join(wt(), "state-link"));
    symlinkSync(join(wt(), "packages"), join(wt(), "pkg-link"));
    expect(denied((await write(join(wt(), "state-link", "state.json"))).value)?.permissionDecision).toBe("deny");
    expect(denied((await write("state-link/not-yet/a.json")).value)?.permissionDecision).toBe("deny");
    expect((await write(join(wt(), "pkg-link", "a.ts"))).value).toEqual({});
  });

  test("a write elsewhere in the worktree is allowed, existing or not", async () => {
    expect((await write(join(wt(), "README.md"))).value).toEqual({});
    expect((await write("src/new/file.ts")).value).toEqual({});
    expect((await preTool("Edit", { file_path: join(wt(), "README.md"), old_string: "a", new_string: "b" })).value).toEqual({});
  });

  test("a read under run state and a shell command writing there are not inspected", async () => {
    expect((await preTool("Read", { file_path: join(runs(), "state.json") })).value).toEqual({});
    expect((await preTool("Bash", { command: `echo '{}' > ${join(runs(), "state.json")}` })).value).toEqual({});
  });
});
