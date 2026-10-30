/**
 * Codex CLI agent adapter (M4, `blocking` tier). Codex hooks share Claude Code's shape and live in
 * `<repo>/.codex/hooks.json`; `Stop` accepts `{"decision":"block","reason":…}` and continues the
 * turn with `reason` as the next prompt (A4).
 * Caveat: project-local hooks only run once the project's `.codex/` layer is trusted and the hooks
 * reviewed via `/hooks` in Codex — `norn doctor` (A7) must surface that.
 */
import { join } from "node:path";
import type { AgentAdapter, AgentFactory, AgentLaunchRequest, HookDecision, HookResponse } from "@norn/core";
import type { HookEventKind, HookFact } from "@norn/schema";
import * as shared from "../agent-hooks/index.ts";

const { buildFact, field, isObject, jsonHookInstaller, kebab, launchEnv, nativeEvent, objField, readJsonl, textOf } = shared;
const NAME = "codex";

export const hookEvents = {
  SessionStart: "session_start",
  UserPromptSubmit: "turn_start",
  PreToolUse: "tool_use",
  PostToolUse: "tool_use",
  PermissionRequest: "permission_prompt",
  Stop: "turn_end",
  SessionEnd: "session_end",
} as const satisfies Record<string, HookEventKind>;

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);

export const hookSpecs: shared.HookSpec[] = Object.keys(hookEvents).map((native) => ({
  native,
  arg: kebab(native),
  ...(TOOL_EVENTS.has(native) ? { matcher: "*" } : {}),
}));

export const settingsPath = (repoRoot: string) => join(repoRoot, ".codex", "hooks.json");

/** Common payload: session_id, transcript_path, cwd, hook_event_name, model, turn_id. */
export function parseHookEvent(arg: string, payload: unknown, env: Record<string, string | undefined>, at: string): HookFact | null {
  const native = nativeEvent(arg, payload, Object.keys(hookEvents));
  if (!native) return null;
  const toolInput = objField(payload, "tool_input");
  const command = typeof toolInput?.command === "string" ? toolInput.command : undefined;
  const message =
    native === "Stop" ? field(payload, "last_assistant_message") : native === "UserPromptSubmit" ? field(payload, "prompt") : field(payload, "source");
  return buildFact(
    {
      event: hookEvents[native as keyof typeof hookEvents],
      agent: NAME,
      native,
      payload,
      at,
      agent_session_id: field(payload, "session_id"),
      transcript: field(payload, "transcript_path"),
      tool: field(payload, "tool_name"),
      command,
      message,
    },
    env,
  );
}

export function hookResponse(fact: HookFact, decision: HookDecision): HookResponse {
  if (fact.event === "turn_end" && decision.block) {
    return { stdout: `${JSON.stringify({ decision: "block", reason: decision.reason ?? "Report with norn done/ask/stuck before ending the turn." })}\n`, exit_code: 0 };
  }
  return { stdout: "", exit_code: 0 };
}

/** Interactive `codex [resume <id>] "<prompt>"`; headless `codex exec [resume <id>] "<prompt>"`. */
export function launchCommand(req: AgentLaunchRequest): { argv: string[]; env: Record<string, string> } {
  const argv = [req.config.command ?? "codex"];
  if (req.headless) argv.push("exec");
  if (req.resume) argv.push("resume", req.resume);
  if (req.model) argv.push("--model", req.model);
  argv.push(...(req.config.args ?? []), req.prompt);
  return { argv, env: launchEnv(req) };
}

/**
 * C4: Codex rollout JSONL (`~/.codex/sessions/…/rollout-*.jsonl`): assistant output is
 * `{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text",…}]}}`;
 * `event_msg` lines of type `agent_message` carry the same text and are used as a fallback.
 * TODO(M4): re-verify against a current Codex rollout file.
 */
export async function lastAssistantMessage(transcriptPath: string): Promise<string | null> {
  const lines = await readJsonl(transcriptPath);
  if (!lines) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = lines[i]!.payload;
    if (!isObject(p)) continue;
    if (lines[i]!.type === "response_item" && p.type === "message" && p.role === "assistant") {
      const t = textOf(p.content, ["output_text", "text"]).trim();
      if (t) return t;
    }
    if (lines[i]!.type === "event_msg" && p.type === "agent_message" && typeof p.message === "string" && p.message.trim()) {
      return p.message.trim();
    }
  }
  return null;
}

/** Codex discovers Agent Skills in `.agents/skills`, where norn keeps them: no links needed. */
export const skillDir = (repoRoot: string) => join(repoRoot, ".agents", "skills");

export const codexAgent: AgentAdapter = {
  name: NAME,
  tier: "blocking",
  hookEvents,
  ...jsonHookInstaller(NAME, settingsPath, hookSpecs),
  parseHookEvent,
  hookResponse,
  skillDir,
  launchCommand,
  lastAssistantMessage,
};

export const createAgent: AgentFactory = () => codexAgent;
