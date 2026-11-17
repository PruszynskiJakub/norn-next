/** The payloads norn's pi extension forwards → normalized harness events. Pure: it translates and never classifies. */
import { type HarnessEvent, type NormalizeInput, readPromptMark, type ToolKind, validateHarnessEvent } from "@norn/plugin-api";
import { type Draft, need, PayloadError } from "./draft.ts";
import { isPiHook, type PiHook, WRITE_TOOLS } from "./hooks.ts";
import { bool, isObject, obj, stableId, str, summarize } from "./payload.ts";

export function toolKind(tool: string): ToolKind {
  if (tool === "bash") return "shell";
  if (WRITE_TOOLS.includes(tool)) return "write";
  return "other";
}

/**
 * A run a prompt started: norn's by its prompt mark, else typed by a person in the pane. A run that
 * a custom message started (another extension's) carries no prompt and answers nothing.
 */
function agentStart(payload: unknown): Draft[] {
  const prompt = str(payload, "prompt");
  const mark = readPromptMark(prompt ?? "");
  if (mark) {
    const started: Draft = { type: "turn.started", source: mark.source, prompt_id: mark.id };
    return mark.source === "answer" ? [started, { type: "input.received", by: "norn" }] : [started];
  }
  if (prompt === undefined && str(payload, "message_type") === "custom") return [{ type: "turn.started", source: "person" }];
  return [{ type: "turn.started", source: "person" }, { type: "input.received", by: "pane" }];
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * The file a write lands in, which is what norn guards. The extension resolves it as pi will (a
 * leading `@` dropped, `~` and `file://` expanded) and sends it as `resolved_path`; without that,
 * the raw path gets the same rules here, and a home this payload cannot name reads as outside any
 * worktree, never as a path relative to it.
 */
export function writtenPath(payload: unknown, env: Readonly<Record<string, string | undefined>>): string | undefined {
  const resolved = str(payload, "resolved_path");
  if (resolved?.startsWith("/")) return resolved;
  const raw = str(obj(payload, "tool_input"), "path");
  if (raw === undefined) return undefined;
  let p = raw.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~" || p.startsWith("~/")) {
    const home = env.HOME?.startsWith("/") ? env.HOME : "/~";
    return p === "~" ? home : `${home}/${p.slice(2)}`;
  }
  if (p.startsWith("file://")) {
    try {
      const url = new URL(p);
      return url.host === "" || url.host === "localhost" ? decodeURIComponent(url.pathname) : `//${url.host}${decodeURIComponent(url.pathname)}`;
    } catch {
      return "/~unreadable-file-url";
    }
  }
  return p;
}

function toolCall(payload: unknown, env: Readonly<Record<string, string | undefined>>): Draft[] {
  const id = need(str(payload, "tool_call_id"), "tool_call_id");
  const tool = need(str(payload, "tool_name"), "tool_name");
  const kind = toolKind(tool);
  const detail = kind === "write" ? (writtenPath(payload, env) ?? summarize(obj(payload, "tool_input"))) : summarize(obj(payload, "tool_input"));
  return [{ type: "tool.requested", id, kind, tool, ...(detail !== undefined && { detail }) }];
}

/**
 * A run that settled. One that stopped on a provider error still ends the turn (pi has retried by
 * then), with the error as its last words, since the agent's own may say nothing about it.
 */
function settle(payload: unknown): Draft[] {
  const error = str(payload, "stop_reason") === "error" ? (str(payload, "error_message") ?? "pi stopped on a provider error") : undefined;
  const last = error !== undefined ? `pi stopped on an error: ${error}` : str(payload, "last_assistant_message");
  return [{ type: "turn.ended", ...(last && { last_message: last }) }];
}

function drafts(hook: PiHook, payload: unknown, env: Readonly<Record<string, string | undefined>>): Draft[] {
  switch (hook) {
    case "session_start": {
      const transcript = str(payload, "transcript_path");
      return [{ type: "session.started", harness_session: need(str(payload, "session_id"), "session_id"), ...(transcript && { transcript }) }];
    }
    case "before_agent_start":
      return agentStart(payload);
    case "tool_call":
      return toolCall(payload, env);
    case "tool_execution_end":
      // a call pi never executed (an unknown tool, invalid arguments, a refusal) still ends here, as an error
      return [{ type: "tool.finished", id: need(str(payload, "tool_call_id"), "tool_call_id"), ok: bool(payload, "is_error") !== true }];
    case "ui_prompt_start": {
      // pi names no prompt: the extension numbers each opening, so a dialog asked again with the same
      // words is a new input, while a retried delivery of one opening keeps its id
      const question = str(payload, "title") ?? `an extension waits on a ${str(payload, "kind") ?? "dialog"}`;
      const seq = need(str(payload, "prompt_seq"), "prompt_seq");
      return [{ type: "input.requested", id: stableId("input", str(payload, "session_id"), seq), question }];
    }
    case "ui_prompt_end":
      // answered or dismissed in the pane; it names no input, so it answers whichever is open
      return [{ type: "input.received", by: "pane" }];
    case "session_compact":
      return [{ type: "context.compacted" }];
    case "agent_before_settle":
      return settle(payload);
    case "agent_settled": {
      // a run that settled normally already ended at agent_before_settle; one that stopped on an error
      // or an abort was never forwarded there, so it ends here, with how it stopped when it says
      const outcome = str(payload, "outcome");
      if (outcome !== undefined && outcome !== "completed") return settle(payload);
      return bool(payload, "aborted") === true ? [{ type: "turn.ended" }] : [];
    }
    case "session_shutdown":
      // a reload, /new, /resume or /fork replaces the session inside the same process, and its session_start follows
      return str(payload, "reason") === "quit" ? [{ type: "session.ended", reason: "exit" }] : [];
  }
}

function readDrafts(hook: string, payload: unknown, env: Readonly<Record<string, string | undefined>>): Draft[] {
  if (!isPiHook(hook)) return [{ type: "hook.error", hook, message: `unknown pi event ${JSON.stringify(hook)}` }];
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
 * Translate one forwarded event. Never throws: a throw leaves the extension with no reply, which it
 * reads as a failed hook. Every event is checked against the contract, so a payload that would
 * yield an invalid event becomes one `hook.error` instead.
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
