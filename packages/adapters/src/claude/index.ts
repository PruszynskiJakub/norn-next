/**
 * Claude Code agent adapter (first-class, `blocking` tier). Implements AgentAdapter from
 * packages/core/src/ports.ts.
 *
 * Hooks (A1, A2) go into `<repo>/.claude/settings.json`; each runs `<hookCommand> <arg> # norn-owned`.
 * `Stop` is the blocking one (A4): `norn hook stop` decides, `hookResponse` encodes
 * `{"decision":"block","reason":…}` per https://docs.claude.com/en/docs/claude-code/hooks.
 */
import { join } from "node:path";
import type { AgentAdapter, AgentFactory, AgentLaunchRequest, HookDecision, HookResponse } from "@norn/core";
import type { HookEventKind, HookFact } from "@norn/schema";
import {
  buildFact,
  field,
  type HookSpec,
  isObject,
  type JsonObject,
  jsonHookInstaller,
  kebab,
  launchEnv,
  nativeEvent,
  objField,
  readJsonl,
  textOf,
} from "../agent-hooks/index.ts";

const NAME = "claude";

export const hookEvents = {
  SessionStart: "session_start",
  UserPromptSubmit: "turn_start",
  PreToolUse: "tool_use",
  PostToolUse: "tool_use",
  Notification: "waiting_input", // refined by notification_type, see NOTIFICATION_EVENTS
  Stop: "turn_end",
  SessionEnd: "session_end",
} as const satisfies Record<string, HookEventKind>;

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

/**
 * A2: Claude Code `Notification.notification_type` → normalized event; `null` = ignore.
 * Types and timing per https://code.claude.com/docs/en/hooks (Notification matchers):
 * - `idle_prompt` fires ~60 s after Claude *finished responding*: the turn ended, nobody asked
 *   anything → `turn_end` (§10 silent → nudge), never an Answer.
 * - permission / MCP elicitation dialogs / background-agent questions / a usage-limit wait that
 *   needs Enter really wait on a person → `permission_prompt` / `waiting_input` (§10 implicit ask).
 * - the rest are informational. Unknown future types are ignored rather than parking a unit.
 */
const NOTIFICATION_EVENTS: Record<string, HookEventKind | null> = {
  permission_prompt: "permission_prompt",
  idle_prompt: "turn_end",
  elicitation_dialog: "waiting_input",
  elicitation_url_dialog: "waiting_input",
  agent_needs_input: "waiting_input",
  quota_auto_resume_stale: "waiting_input",
  auth_success: null,
  elicitation_complete: null,
  elicitation_response: null,
  agent_completed: null,
  quota_auto_resume_fired: null,
  quota_auto_resume_disabled: null,
  plugin_notification: null,
};

/** Notification without `notification_type` (older Claude Code): classify by the message text. */
function untypedNotification(message: string | undefined): HookEventKind {
  if (/permission/i.test(message ?? "")) return "permission_prompt";
  if (/waiting for your input/i.test(message ?? "")) return "turn_end"; // the old idle notification text
  return "waiting_input";
}

/** One-line summary of a tool call's input: the shell command, else the path/url/pattern, else compact JSON. */
function summarizeToolInput(input: JsonObject | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of ["command", "file_path", "notebook_path", "url", "pattern", "query", "path"]) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  const json = JSON.stringify(input);
  if (json === "{}") return undefined;
  return json.length > 300 ? `${json.slice(0, 299)}…` : json;
}

export const hookSpecs: HookSpec[] = Object.keys(hookEvents).map((native) => ({
  native,
  arg: native === "Stop" ? "stop" : kebab(native),
  ...(TOOL_EVENTS.has(native) ? { matcher: "*" } : {}),
}));

export const settingsPath = (repoRoot: string) => join(repoRoot, ".claude", "settings.json");

/** Normalize one Claude Code hook stdin payload (common: session_id, transcript_path, cwd, hook_event_name). */
export function parseHookEvent(arg: string, payload: unknown, env: Record<string, string | undefined>, at: string): HookFact | null {
  const native = nativeEvent(arg, payload, Object.keys(hookEvents));
  if (!native) return null;
  let event: HookEventKind = hookEvents[native as keyof typeof hookEvents];
  const command = TOOL_EVENTS.has(native) ? summarizeToolInput(objField(payload, "tool_input")) : undefined;
  let message: string | undefined;
  if (native === "Notification") {
    message = field(payload, "message");
    const type = field(payload, "notification_type");
    const mapped = type === undefined ? untypedNotification(message) : NOTIFICATION_EVENTS[type];
    if (!mapped) return null;
    // a permission prompt's pending command comes from the preceding PreToolUse: refineHooks
    event = mapped;
  } else if (native === "UserPromptSubmit") {
    message = field(payload, "prompt");
  } else if (native === "Stop") {
    message = field(payload, "last_assistant_message"); // present in newer Claude Code versions
  } else if (native === "SessionStart" || native === "SessionEnd") {
    message = field(payload, native === "SessionStart" ? "source" : "reason");
  }
  return buildFact(
    {
      event,
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

/**
 * §10: give each Claude `permission_prompt` fact the tool call it is asking about. The
 * Notification payload names no command; Claude Code runs PreToolUse *before* its permission
 * check, so the pending call is the latest tool fact of the same session — if that is a
 * PreToolUse (a later PostToolUse means it already ran). Sets `tool` and `command` as
 * `Tool(input)` (Claude's permission-rule syntax, e.g. `Bash(rm -rf build)`). Pure; facts in
 * trace order; other agents' facts pass through unchanged.
 */
function refineHooks(hooks: readonly HookFact[]): HookFact[] {
  return hooks.map((h, i) => {
    if (h.agent !== NAME || h.event !== "permission_prompt" || h.tool) return h;
    for (let j = i - 1; j >= 0; j--) {
      const p = hooks[j]!;
      if (p.agent !== NAME || p.agent_session_id !== h.agent_session_id) continue;
      if (p.event === "turn_start" || p.event === "turn_end" || p.event === "session_start") return h;
      if (p.event !== "tool_use") continue;
      if (p.native !== "PreToolUse" || !p.tool) return h;
      return { ...h, tool: p.tool, command: p.command ? `${p.tool}(${p.command})` : p.tool };
    }
    return h;
  });
}

/** A4: only `Stop` (turn_end) can be blocked; everything else (incl. idle_prompt turn_end) is acknowledged silently. */
export function hookResponse(fact: HookFact, decision: HookDecision): HookResponse {
  if (fact.event === "turn_end" && fact.native === "Stop" && decision.block) {
    return { stdout: `${JSON.stringify({ decision: "block", reason: decision.reason ?? "Report with norn done/ask/stuck before ending the turn." })}\n`, exit_code: 0 };
  }
  return { stdout: "", exit_code: 0 };
}

/**
 * B5/B2: interactive `claude [opts] -- "<prompt>"`, headless `claude -p`, resume `--resume <id>`.
 * B3: `--` ends the options, so a variadic flag in the configured args (`--allowedTools a b`) cannot
 * take the prompt as one more value.
 */
export function launchCommand(req: AgentLaunchRequest): { argv: string[]; env: Record<string, string> } {
  const argv = [req.config.command ?? "claude"];
  if (req.headless) argv.push("-p");
  if (req.model) argv.push("--model", req.model);
  if (req.resume) argv.push("--resume", req.resume);
  argv.push(...(req.config.args ?? []), "--", req.prompt);
  return { argv, env: launchEnv(req) };
}

/**
 * C4: last assistant text in a Claude Code JSONL transcript. One API message is split over
 * several lines (one per content block) sharing `message.id`; their text blocks are joined.
 * Sidechain (subagent) lines are ignored.
 */
export async function lastAssistantMessage(transcriptPath: string): Promise<string | null> {
  const lines = await readJsonl(transcriptPath);
  if (!lines) return null;
  const assistant = lines.filter((l) => l.type === "assistant" && l.isSidechain !== true && isObject(l.message));
  for (let i = assistant.length - 1; i >= 0; i--) {
    const msg = assistant[i]!.message as JsonObject;
    if (!textOf(msg.content).trim()) continue;
    const id = msg.id;
    const parts = assistant
      .filter((l) => id !== undefined && (l.message as JsonObject).id === id)
      .map((l) => textOf((l.message as JsonObject).content))
      .filter((t) => t.trim());
    return (id === undefined ? textOf(msg.content) : parts.join("\n")).trim();
  }
  return null;
}

export const skillDir = (repoRoot: string) => join(repoRoot, ".claude", "skills");

export const claudeAgent: AgentAdapter = {
  name: NAME,
  tier: "blocking",
  hookEvents,
  ...jsonHookInstaller(NAME, settingsPath, hookSpecs),
  parseHookEvent,
  refineHooks,
  hookResponse,
  skillDir,
  launchCommand,
  lastAssistantMessage,
};

export const createAgent: AgentFactory = () => claudeAgent;
