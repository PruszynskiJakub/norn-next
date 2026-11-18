/**
 * A norn plugin the CLI's end-to-end tests install with `norn plugin add <this folder>`, so the
 * installed-plugin path (link, lock, dynamic import, API check) carries the run. It provides:
 *
 * - harness `test`, whose agent is a bun script (agent.ts) acting as a coding agent does: it runs
 *   the hook command install was given for each hook and reports with the real `norn` subprocesses;
 * - pack `e2e`, one workflow that walks an agent step, a check, a gate, open-pr and the merge.
 *
 * Hook protocol: the agent pipes a JSON payload to `<hook command> <hook>`, the answer comes back as
 * JSON on stdout (empty: allow). Hooks: `start`, `prompt` {prompt}, `tool` {id, kind, tool, detail?},
 * `tool-done` {id}, `stop`, `end`.
 */
import { defineNornPlugin, type Harness, type HarnessEvent, type NormalizeInput, readPromptMark } from "@norn/plugin-api";

const AGENT = new URL("./agent.ts", import.meta.url).pathname;

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
    argv: ["bun", AGENT, req.prompt],
    env: { ...req.env, ...(req.resume !== undefined && { TEST_AGENT_RESUME: req.resume }) },
  }),
  normalize,
  respond: ({ answer }) => (answer.kind === "allow" ? { stdout: "", exit_code: 0 } : { stdout: `${JSON.stringify(answer)}\n`, exit_code: 0 }),
};

export const testHarnessPlugin = defineNornPlugin({
  name: "norn-plugin-test",
  api: "^1.5",
  provides: { harness: { test: harness }, packs: { e2e: { workflows: { "e2e.yaml": WORKFLOW }, shared: {}, skills: {} } } },
});
