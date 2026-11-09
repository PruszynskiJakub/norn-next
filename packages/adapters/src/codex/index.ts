/**
 * Codex CLI agent adapter (`blocking` tier). Codex hooks share Claude Code's shape and live in
 * `<repo>/.codex/hooks.json`; `Stop` accepts `{"decision":"block","reason":…}` and continues the
 * turn with `reason` as the next prompt. PreToolUse denials and SessionStart and UserPromptSubmit
 * context use Claude Code's `hookSpecificOutput` shape, per Codex's hook docs (not yet observed).
 * Caveat: project-local hooks only run once the project's `.codex/` layer is trusted and the hooks
 * reviewed via `/hooks` in Codex — `norn doctor` must surface that.
 */
import { join } from "node:path";
import type { AgentAdapter, AgentFactory, AgentLaunchRequest, HookAnswer, HookResponse, ToolCall } from "@norn/core";
import type { HookEventKind, HookFact } from "@norn/schema";
import { SKILLS_DIR } from "@norn/store";
import * as shared from "../agent-hooks/index.ts";

const { buildFact, contextOutput, denyToolOutput, field, isObject, jsonHookInstaller, jsonResponse, kebab, launchEnv, nativeEvent, objField, pendingTool, readJsonl, shellCall, textOf } = shared;
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

export function hookResponse(fact: HookFact, answer: HookAnswer): HookResponse {
  const native = fact.native;
  if (answer.kind === "block" && fact.event === "turn_end" && native === "Stop") return jsonResponse({ decision: "block", reason: answer.reason });
  if (answer.kind === "deny" && native === "PreToolUse") return jsonResponse(denyToolOutput(native, answer.reason));
  if (answer.kind === "context" && (native === "SessionStart" || native === "UserPromptSubmit")) return jsonResponse(contextOutput(native, answer.text));
  return { stdout: "", exit_code: 0 };
}

/** Codex reports its shell tool as `Bash` in hook payloads. */
const SHELL_TOOLS = new Set(["Bash", "shell", "local_shell", "exec_command"]);
const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

/** The files an `apply_patch` envelope adds, updates, deletes or moves to, as written in it. */
function patchedFiles(input: shared.JsonObject): ToolCall | null {
  const patch = [input.command, input.input, input.patch].find((v): v is string => typeof v === "string");
  const paths = patch ? [...patch.matchAll(PATCH_FILE)].map((m) => m[1]!.trim()) : [];
  return paths.length ? { kind: "file_write", paths } : null;
}

export function toolCall(native: string, payload: unknown): ToolCall | null {
  const call = pendingTool(native, payload, "PreToolUse");
  if (!call) return null;
  if (SHELL_TOOLS.has(call.tool)) return shellCall(call.input);
  return call.tool === "apply_patch" ? patchedFiles(call.input) : null;
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
 * Codex rollout JSONL (`~/.codex/sessions/…/rollout-*.jsonl`): assistant output is
 * `{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text",…}]}}`;
 * `event_msg` lines of type `agent_message` carry the same text and are used as a fallback.
 * TODO: re-verify against a current Codex rollout file.
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
export const skillDir = (repoRoot: string) => join(repoRoot, SKILLS_DIR);

export const codexAgent: AgentAdapter = {
  name: NAME,
  tier: "blocking",
  setupNote: "Codex runs project hooks only once the project's .codex/ layer is trusted and the hooks reviewed via /hooks in Codex",
  hookEvents,
  ...jsonHookInstaller(NAME, settingsPath, hookSpecs),
  parseHookEvent,
  hookResponse,
  toolCall,
  skillDir,
  launchCommand,
  lastAssistantMessage,
};

export const createAgent: AgentFactory = () => codexAgent;
