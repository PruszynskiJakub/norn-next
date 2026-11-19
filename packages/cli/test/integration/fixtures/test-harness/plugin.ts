/**
 * A norn plugin the CLI's end-to-end tests install with `norn plugin add <this folder>`, so the
 * installed-plugin path (link, lock, dynamic import, API check) carries the run. It provides:
 *
 * - harness `test`, whose agent is a bun script (agent.ts) acting as a coding agent does: it runs
 *   the hook command install was given for each hook and reports with the real `norn` subprocesses;
 * - pack `e2e`, one workflow that walks an agent step, a check, a gate, open-pr and the merge;
 * - runner `test`: the headless runner, but one a person may sit beside (attended), whose `stop`
 *   fails while the flag file `$TEST_FLAGS/stop-fails` exists, so a test can make a stop or a nudge
 *   that needs one fail on demand.
 *
 * A flag file `$TEST_FLAGS/missing-bin` makes the harness launch a binary that does not exist.
 *
 * Hook protocol: the agent pipes a JSON payload to `<hook command> <hook>`, the answer comes back as
 * JSON on stdout (empty: allow). Hooks: `start`, `prompt` {prompt}, `tool` {id, kind, tool, detail?},
 * `tool-done` {id}, `stop`, `end`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineNornPlugin, fail, type Harness, type HarnessEvent, hostProcesses, type NormalizeInput, readPromptMark, type RunnerFactory } from "@norn/plugin-api";
import { createHeadlessRunner, HeadlessConfig } from "@norn/runner-headless";

const AGENT = new URL("./agent.ts", import.meta.url).pathname;
/** What the harness launches while the `missing-bin` flag is up: a path nothing is at. */
export const MISSING_BIN = "/nonexistent/norn-test-agent";

/** Whether the test raised the flag: read on every call, since one norn process may outlive a flag change. */
const flagged = (name: string): boolean => {
  const dir = process.env.TEST_FLAGS;
  return dir !== undefined && dir !== "" && existsSync(join(dir, name));
};

/**
 * Where install leaves the hook command in a worktree: a resumed launch runs in a later tick process
 * than the install, so the command cannot be kept in memory. Its folder ignores itself, as a real
 * harness keeps what it installs out of git: an untracked file would make a done refused.
 */
const HOOK_DIR = ".norn-test";
export const HOOK_FILE = `${HOOK_DIR}/hook`;

const WORKFLOW = [
  "name: e2e",
  "start: build",
  "steps:",
  "  build:",
  "    agent: Build the thing.",
  "    outcomes: { done: test }",
  "    means: { done: the thing is built }",
  "  test:",
  "    check: test -f feature.txt",
  "    timeout: 1m",
  "    outcomes: { pass: ready, fail: build }",
  "  ready:",
  "    gate: Approve the thing.",
  "    outcomes: { approve: open-pr, reject: build }",
  "  open-pr:",
  "    open-pr:",
  "    outcomes: { done: merge }",
  "  merge:",
  "    await-merge:",
  "    outcomes: { merged: $done, stale: build, unpushed: open-pr }",
  "",
].join("\n");

const field = (p: unknown, k: string): unknown => (p && typeof p === "object" ? (p as Record<string, unknown>)[k] : undefined);
const str = (p: unknown, k: string): string | undefined => {
  const v = field(p, k);
  return typeof v === "string" && v !== "" ? v : undefined;
};
const TOOL_KINDS = new Set(["shell", "write", "ask", "subagent", "other"]);

function normalize(input: NormalizeInput): HarnessEvent[] {
  const base = { run_id: input.run_id, seq: input.seq, at: input.at };
  const p = input.payload;
  const bad = (message: string): HarnessEvent[] => [{ type: "hook.error", ...base, hook: input.hook, message }];
  switch (input.hook) {
    case "start":
      return [{ type: "session.started", ...base, harness_session: `s-${input.run_id}` }];
    case "prompt": {
      const prompt = str(p, "prompt");
      if (prompt === undefined) return bad("prompt: no prompt");
      const mark = readPromptMark(prompt);
      return [{ type: "turn.started", ...base, ...(mark ? { source: mark.source, prompt_id: mark.id } : { source: "person" as const }) }];
    }
    case "tool": {
      const id = str(p, "id");
      const kind = str(p, "kind") ?? "other";
      if (id === undefined || !TOOL_KINDS.has(kind)) return bad("tool: no id or an unknown kind");
      const detail = str(p, "detail");
      return [{ type: "tool.requested", ...base, id, kind: kind as "write", tool: str(p, "tool") ?? kind, ...(detail !== undefined && { detail }) }];
    }
    case "tool-done": {
      const id = str(p, "id");
      if (id === undefined) return bad("tool-done: no id");
      return [{ type: "tool.finished", ...base, id, ok: field(p, "ok") !== false }];
    }
    case "stop":
      return [{ type: "turn.ended", ...base }];
    case "end":
      return [{ type: "session.ended", ...base, reason: "exit" }];
    default:
      return bad(`unknown hook ${input.hook}`);
  }
}

const harness: Harness = {
  name: "test",
  capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: false, limits: false, paneInput: false, promptMarks: true, resume: true },
  install: async ({ worktree, hookCommand }) => {
    await Bun.write(`${worktree}/${HOOK_DIR}/.gitignore`, "*\n");
    await Bun.write(`${worktree}/${HOOK_FILE}`, `${hookCommand}\n`);
    return { changed: [`${HOOK_DIR}/.gitignore`, HOOK_FILE] };
  },
  uninstall: async () => ({ changed: [] }),
  launch: (req) => ({
    argv: flagged("missing-bin") ? [MISSING_BIN, req.prompt] : ["bun", AGENT, req.prompt],
    env: { ...req.env, ...(req.resume !== undefined && { TEST_AGENT_RESUME: req.resume }) },
  }),
  normalize,
  respond: ({ answer }) => (answer.kind === "allow" ? { stdout: "", exit_code: 0 } : { stdout: `${JSON.stringify(answer)}\n`, exit_code: 0 }),
};

const runner: RunnerFactory<typeof HeadlessConfig> = {
  configSchema: HeadlessConfig,
  needsProcesses: true,
  create: (ctx, config) => {
    const procs = hostProcesses(ctx);
    if (!procs.ok) throw new Error(`the test runner needs ${procs.missing.join(", ")} from the host`);
    const headless = createHeadlessRunner(ctx, procs.value, config);
    return {
      ...headless,
      name: "test",
      capabilities: { attended: true, headless: true, paneInput: false },
      stop: async (handle) => (flagged("stop-fails") ? fail("unavailable", "test runner: the stop-fails flag is up") : headless.stop(handle)),
    };
  },
};

export const testHarnessPlugin = defineNornPlugin({
  name: "norn-plugin-test",
  api: "^1.5",
  provides: { harness: { test: harness }, runners: { test: runner }, packs: { e2e: { workflows: { "e2e.yaml": WORKFLOW }, shared: {}, skills: {} } } },
});
