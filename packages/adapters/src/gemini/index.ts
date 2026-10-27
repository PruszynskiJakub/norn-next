/**
 * Gemini CLI agent adapter (M4, `blocking` tier). Hooks share Claude Code's shape and live in
 * `<repo>/.gemini/settings.json`. `AfterAgent` is the turn end; `{"decision":"deny","reason":…}`
 * makes Gemini retry the turn with `reason` as the prompt (A4). See geminicli.com/docs/hooks.
 */
import { join } from "node:path";
import type { AgentAdapter, AgentFactory, AgentLaunchRequest, HookDecision, HookResponse } from "@norn/core";
import type { HookEventKind, HookFact } from "@norn/schema";
import * as shared from "../agent-hooks/index.ts";

const { buildFact, field, isObject, jsonHookInstaller, kebab, launchEnv, nativeEvent, objField, readJsonFile, readJsonl, textOf } = shared;
const NAME = "gemini";

export const hookEvents = {
  SessionStart: "session_start",
  BeforeAgent: "turn_start",
  BeforeTool: "tool_use",
  AfterTool: "tool_use",
  Notification: "permission_prompt", // only notification_type today is `ToolPermission`
  AfterAgent: "turn_end",
  SessionEnd: "session_end",
} as const satisfies Record<string, HookEventKind>;

const TOOL_EVENTS = new Set(["BeforeTool", "AfterTool"]);

export const hookSpecs: shared.HookSpec[] = Object.keys(hookEvents).map((native) => ({
  native,
  arg: kebab(native),
  ...(TOOL_EVENTS.has(native) ? { matcher: "*" } : {}),
  extra: { name: `norn-${kebab(native)}` },
}));

export const settingsPath = (repoRoot: string) => join(repoRoot, ".gemini", "settings.json");

/** Common payload: session_id, transcript_path, cwd, hook_event_name, timestamp. */
export function parseHookEvent(arg: string, payload: unknown, env: Record<string, string | undefined>, at: string): HookFact | null {
  const native = nativeEvent(arg, payload, Object.keys(hookEvents));
  if (!native) return null;
  let event: HookEventKind = hookEvents[native as keyof typeof hookEvents];
  const toolInput = objField(payload, "tool_input");
  let command = typeof toolInput?.command === "string" ? toolInput.command : undefined;
  let message: string | undefined;
  if (native === "Notification") {
    message = field(payload, "message");
    if (field(payload, "notification_type") !== "ToolPermission") event = "waiting_input";
    else command = message;
  } else if (native === "BeforeAgent") message = field(payload, "prompt");
  else if (native === "AfterAgent") message = field(payload, "prompt_response");
  else if (native === "SessionStart") message = field(payload, "source");
  else if (native === "SessionEnd") message = field(payload, "reason");
  return buildFact(
    {
      event,
      agent: NAME,
      native,
      payload,
      at,
      agent_session_id: field(payload, "session_id") ?? env.GEMINI_SESSION_ID,
      transcript: field(payload, "transcript_path"),
      tool: field(payload, "tool_name"),
      command,
      message,
    },
    env,
  );
}

/** Gemini expects JSON-only stdout; `{}` = no opinion. */
export function hookResponse(fact: HookFact, decision: HookDecision): HookResponse {
  if (fact.event === "turn_end" && decision.block) {
    return { stdout: `${JSON.stringify({ decision: "deny", reason: decision.reason ?? "Report with norn done/ask/stuck before ending the turn." })}\n`, exit_code: 0 };
  }
  return { stdout: "{}\n", exit_code: 0 };
}

/** Interactive `gemini -i "<prompt>"` (prompt then stay interactive); headless `gemini -p`; resume `--resume <id>`. */
export function launchCommand(req: AgentLaunchRequest): { argv: string[]; env: Record<string, string> } {
  const argv = [req.config.command ?? "gemini"];
  if (req.model) argv.push("--model", req.model);
  if (req.resume) argv.push("--resume", req.resume);
  argv.push(...(req.config.args ?? []), req.headless ? "-p" : "-i", req.prompt);
  return { argv, env: launchEnv(req) };
}

/**
 * C4: Gemini chat recording is one JSON file `{sessionId, messages:[{type:"user"|"gemini", content}]}`.
 * TODO(M4): format is not documented; JSONL with the same message objects is accepted too.
 */
export async function lastAssistantMessage(transcriptPath: string): Promise<string | null> {
  const doc = await readJsonFile(transcriptPath);
  const messages: unknown[] = isObject(doc) && Array.isArray(doc.messages) ? doc.messages : ((await readJsonl(transcriptPath)) ?? []);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isObject(m) || (m.type !== "gemini" && m.role !== "model")) continue;
    const t = textOf(m.content ?? m.parts).trim();
    if (t) return t;
  }
  return null;
}

/** Gemini CLI Agent Skills: `.gemini/skills`. */
export const skillDir = (repoRoot: string) => join(repoRoot, ".gemini", "skills");

export const geminiAgent: AgentAdapter = {
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

export const createAgent: AgentFactory = () => geminiAgent;
