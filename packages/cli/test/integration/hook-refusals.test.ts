/**
 * `norn hook` on a pre-tool event, with the hooks as `norn init` installs them: a push, a branch
 * switch or a remote write is denied with the rule's reason on every retry, traced `blocked`, and
 * never spends the run's capped turn-end refusals; outside a unit, or when its own git fails, it allows.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type HookTrace } from "@norn/schema";
import { blockedHookCount, readTrace, workflowsDir } from "@norn/store";
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
const spec = ".agents/specs/gh-9-refused-calls";
const wt = () => h.worktree("gh-9-refused-calls");
const runs = () => runStateOf(join(wt(), spec));

function env(extra: Record<string, string> = {}) {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid), ...extra };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
const hook = (cwd: string, event: string, payload: Record<string, unknown>, extraEnv: Record<string, string> = {}) =>
  runChecked(["hook", event, "--agent", "claude"], { ...h.deps, cwd, env: env(extraEnv), stdin: JSON.stringify({ session_id: "sess-A", transcript_path: "/tmp/sess-A.jsonl", cwd, ...payload }) });
const bash = (command: string, cwd = wt(), extraEnv: Record<string, string> = {}) =>
  hook(cwd, "pre-tool-use", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, extraEnv);
const stop = () => hook(wt(), "stop", { hook_event_name: "Stop", stop_hook_active: false });
const decision = (value: unknown) => (value as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision ?? "allow";
const reason = (value: unknown) => (value as { hookSpecificOutput?: { permissionDecisionReason?: string } }).hookSpecificOutput?.permissionDecisionReason ?? "";

let runId = "";

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: solo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Refused calls")];
  const ready = () => existsSync(join(runs(), "state.json")) && h.state(runs())?.status === "ready";
  for (let i = 0; i < 10 && !ready(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(ready()).toBe(true);
  const r = await runChecked(["brief", "--json"], { ...h.deps, cwd: wt(), env: env() });
  expect(r.exit).toBe(0);
  runId = (r.value as { run_id: string }).run_id;
  h.clock.advance(10_000);
  await h.tick();
  expect(h.state(runs())).toMatchObject({ status: "running", run: { run_id: runId } });
});
afterAll(() => h.cleanup());

describe("norn hook refuses tool calls that break a hard rule", () => {
  test("the PreToolUse hook norn init installed today is the one that answers, with no reinstall", () => {
    const settings = JSON.parse(h.read(join(h.root, ".claude/settings.json"))) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    expect(settings.hooks.PreToolUse?.[0]).toMatchObject({ matcher: "*", hooks: [{ command: "norn hook pre-tool-use --agent claude # norn-owned" }] });
  });

  test("a git push is denied with the rule's reason, every retry, and traced blocked", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await bash("bun run test && git push origin HEAD");
      expect(r.exit).toBe(0);
      expect(decision(r.value)).toBe("deny");
      expect(reason(r.value)).toContain("only norn pushes");
      expect(reason(r.value)).toContain("receipts come before effects");
    }
    const refused = (readTrace(h.root, { types: ["hook"] }).events as HookTrace[]).filter((e) => e.fact.run_id === runId && e.fact.native === "PreToolUse" && e.blocked);
    expect(refused.length).toBe(5);
    expect(refused[0]?.reason).toContain("only norn pushes");
  });

  test("tool refusals leave the end-of-turn cap its full number of blocks", async () => {
    expect(blockedHookCount(h.root, { story: "gh-9" }, runId)).toBe(0);
    const results: string[] = [];
    for (let i = 0; i < MAX_STOP_BLOCKS + 1; i++) results.push(((await stop()).value as { decision?: string }).decision ?? "allow");
    expect(results).toEqual([...Array(MAX_STOP_BLOCKS).fill("block"), "allow"]);
    expect(decision((await bash("git push")).value)).toBe("deny"); // and refusals still hold past the cap
  });

  test("a bare checkout is denied only when its name resolves to a commit in the worktree", async () => {
    expect(decision((await bash("git checkout main")).value)).toBe("deny");
    expect(decision((await bash("git checkout README.md")).value)).toBe("allow");
    expect(decision((await bash("git checkout -- main")).value)).toBe("allow");
  });

  test("a remote-changing gh command is denied, a read is allowed", async () => {
    expect(decision((await bash("gh pr merge 3 --squash")).value)).toBe("deny");
    expect(decision((await bash("gh pr view 3 --json state")).value)).toBe("allow");
  });

  test("outside a unit worktree it allows", async () => {
    expect((await bash("git push", h.root)).value).toEqual({});
  });

  test("when its own git fails, it allows", async () => {
    const broken = await bash("git checkout main", wt(), { PATH: "/nonexistent" });
    expect(broken).toMatchObject({ exit: 0, value: {} });
  });
});
