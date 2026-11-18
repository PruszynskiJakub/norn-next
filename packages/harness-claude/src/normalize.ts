/** Claude Code hook stdin → normalized harness events. Pure: it translates and never classifies. */
import { type HarnessEvent, type NormalizeInput, readPromptMark, type TurnSource, validateHarnessEvent } from "@norn/plugin-api";
import { type Draft, need, PayloadError } from "./draft.ts";
import { type ClaudeHook, isClaudeHook } from "./hooks.ts";
import { isObject, str } from "./payload.ts";
import { notification, stop, stopFailure } from "./signals.ts";
import { postToolUse, preToolUse } from "./tools.ts";

/**
 * The older, per-launch rule: set in the session's env, it marks every prompt of the process. Read
 * only when a prompt carries no prompt mark, for a host that does not mark its prompts yet.
 */
export const PROMPT_SOURCE_ENV = "NORN_PROMPT_SOURCE";
const NORN_SOURCES: ReadonlySet<string> = new Set(["brief", "nudge", "answer"]);

function nornSource(env: NormalizeInput["env"]): Exclude<TurnSource, "person"> | undefined {
  const s = env[PROMPT_SOURCE_ENV];
  return s !== undefined && NORN_SOURCES.has(s) ? (s as Exclude<TurnSource, "person">) : undefined;
}

function userPrompt(payload: unknown, env: NormalizeInput["env"]): Draft[] {
  const mark = readPromptMark(str(payload, "prompt") ?? "");
  const source = mark?.source ?? nornSource(env);
  if (source === undefined) return [{ type: "turn.started", source: "person" }, { type: "input.received", by: "pane" }];
  const started: Draft = { type: "turn.started", source, ...(mark && { prompt_id: mark.id }) };
  return source === "answer" ? [started, { type: "input.received", by: "norn" }] : [started];
}

function drafts(hook: ClaudeHook, payload: unknown, env: NormalizeInput["env"]): Draft[] {
  switch (hook) {
    case "SessionStart": {
      const transcript = str(payload, "transcript_path");
      return [{ type: "session.started", harness_session: need(str(payload, "session_id"), "session_id"), ...(transcript && { transcript }) }];
    }
    case "UserPromptSubmit":
      return userPrompt(payload, env);
    case "PreToolUse":
      return preToolUse(payload);
    case "PostToolUse":
      return postToolUse(payload, true, nornSource(env) === "answer" ? "norn" : "pane");
    case "PostToolUseFailure":
      return postToolUse(payload, false, "pane");
    case "Notification":
      return notification(payload);
    case "Stop":
      return stop(payload);
    case "StopFailure":
      return stopFailure(payload);
    case "SubagentStop": {
      // an older Claude Code names no agent: a foreground subagent already finished with its tool call
      const id = str(payload, "agent_id");
      return id ? [{ type: "subagent.finished", id }] : [];
    }
    case "PreCompact":
      return [{ type: "context.compacted" }];
    case "SessionEnd":
      // Claude Code reports only why it exited on its own; a kill or crash sends no SessionEnd
      return [{ type: "session.ended", reason: "exit" }];
  }
}

function readDrafts(hook: string, payload: unknown, env: NormalizeInput["env"]): Draft[] {
  if (!isClaudeHook(hook)) return [{ type: "hook.error", hook, message: `unknown Claude Code hook ${JSON.stringify(hook)}` }];
  if (!isObject(payload)) return [{ type: "hook.error", hook, message: "payload is not a JSON object" }];
  const named = str(payload, "hook_event_name");
  if (named !== undefined && named !== hook) return [{ type: "hook.error", hook, message: `payload is for ${named}, not ${hook}` }];
  try {
    return drafts(hook, payload, env);
  } catch (e) {
    if (e instanceof PayloadError) return [{ type: "hook.error", hook, message: e.message }];
    throw e;
  }
}

/**
 * Translate one hook call. Never throws: a hook that throws leaves Claude Code with no answer, and
 * it reads no answer as allow. Every event is checked against the contract, so a payload that
 * would yield an invalid event becomes one `hook.error` instead.
 */
export function normalize(input: NormalizeInput): HarnessEvent[] {
  const envelope = (i: number) => ({ run_id: input.run_id, seq: input.seq + i, at: input.at });
  let out: Draft[];
  try {
    out = readDrafts(input.hook, input.payload, input.env);
  } catch (e) {
    out = [{ type: "hook.error", hook: input.hook, message: e instanceof Error ? e.message : String(e) }];
  }
  const events = out.map((d, i) => ({ ...envelope(i), ...d }) as HarnessEvent);
  const bad = events.map(validateHarnessEvent).find((r) => !r.ok);
  if (bad && !bad.ok) {
    const why = bad.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ");
    return [{ ...envelope(0), type: "hook.error", hook: input.hook, message: `invalid event: ${why}` }];
  }
  return events;
}
