/**
 * A test-only harness whose agent is a bun script (agent.ts) rather than a coding agent. It speaks a
 * small hook protocol of its own: the agent pipes `{...}` to the hook command with the hook's name as
 * its last argument, and reads the answer back as JSON on stdout. Everything between that pipe and the
 * answer is the real runtime: ingestHook, the event log, the kernel's reducer and answer.
 *
 * Hooks: `start`, `prompt` {prompt}, `tool` {id, kind, tool, detail?}, `tool-done` {id, ok?},
 * `stop`, `end` {reason?}. An unknown hook or a malformed payload is one `hook.error` event.
 */
import { defineNornPlugin, type Harness, type HarnessEvent, type NormalizeInput, type NornPlugin, readPromptMark } from "@norn/plugin-api";

export const SCRIPTED = "scripted";
const AGENT = new URL("./agent.ts", import.meta.url).pathname;

/** What one launch of the agent does; agent.ts reads it from SCRIPTED_PLAN. */
export interface AgentPlan {
  behavior: "work" | "die" | "ask";
  /** the outcome `norn done` reports */
  outcome?: string;
  /** files the agent commits in its worktree */
  commit?: Record<string, string>;
  /** a pause mid-work, so a tick runs while the agent does */
  pauseMs?: number;
  /** the question an `ask` agent asks */
  question?: string;
}

export interface ScriptedHarnessOptions {
  /** the `norn` stand-in the agent runs to report, as an argv prefix */
  norn: readonly string[];
  /** the plan of the next launch, in launch order */
  next(runId: string): AgentPlan;
}

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

/** The harness and the plugin that provides it; `installs` records every hook command install was given. */
export function scriptedHarness(opts: ScriptedHarnessOptions): { harness: Harness; plugin: NornPlugin; installs: Map<string, string> } {
  // install and launch run back to back in the launcher, so the hook command install was given reaches the launch here
  const installs = new Map<string, string>();
  // a resumed launch goes on with its run's plan: it is the same session, not a launch of its own
  const plans = new Map<string, AgentPlan>();
  const harness: Harness = {
    name: SCRIPTED,
    capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: false, limits: false, paneInput: false, promptMarks: true, resume: true },
    install: async ({ worktree, hookCommand }) => {
      installs.set(worktree, hookCommand);
      return { changed: [] };
    },
    uninstall: async () => ({ changed: [] }),
    launch: (req) => {
      const hook = installs.get(req.cwd);
      if (hook === undefined) throw new Error(`no hooks installed in ${req.cwd}`);
      const known = req.resume !== undefined ? plans.get(req.run_id) : undefined;
      if (req.resume !== undefined && !known) throw new Error(`no plan to resume run ${req.run_id} with`);
      const plan = known ?? opts.next(req.run_id);
      plans.set(req.run_id, plan);
      return {
        argv: ["bun", AGENT, req.prompt],
        env: {
          ...req.env,
          SCRIPTED_HOOK: hook,
          SCRIPTED_NORN: JSON.stringify(opts.norn),
          SCRIPTED_PLAN: JSON.stringify(plan),
          ...(req.resume !== undefined && { SCRIPTED_RESUME: req.resume }),
        },
      };
    },
    normalize,
    respond: ({ answer }) => (answer.kind === "allow" ? { stdout: "", exit_code: 0 } : { stdout: `${JSON.stringify(answer)}\n`, exit_code: 0 }),
  };
  const plugin = defineNornPlugin({ name: "test-scripted-harness", api: "^1.5", provides: { harness: { [SCRIPTED]: harness } } });
  return { harness, plugin, installs };
}
