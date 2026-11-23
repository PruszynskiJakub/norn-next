/**
 * The lab agent's hook protocol, modelled on a coding agent's: the agent pipes one JSON payload to
 * `<hook command> <hook>` and reads the answer as JSON on stdout (empty: allow). normalize is pure:
 * it translates and never classifies.
 */
import { type HarnessEvent, type NativeReply, type NormalizeInput, readPromptMark, type RespondInput, type ToolKind } from "@norn/plugin-api";

/**
 * Every hook the lab agent fires, and its payload:
 * - `start` {session_id}: the session began; a resumed session fires none, as norn records its own
 * - `prompt` {prompt}: a turn began; norn's prompts carry a prompt mark, any other was typed by a person
 * - `tool` {id, kind, tool, detail?} and `tool-done` {id, ok?}: a call began and ended
 * - `permission` {id, prompt}: a call waits on the person's approval
 * - `ask` {id, question, options?} and `answer` {id?, by}: the agent asked in its session, and the answer came
 * - `compact`: the agent compacted its context
 * - `stop` {last_message?, error?}: the turn ended
 * - `end` {reason?}: the session ended
 */
export const LAB_HOOKS = Object.freeze(["start", "prompt", "tool", "tool-done", "permission", "ask", "answer", "compact", "stop", "end"] as const);
export type LabHook = (typeof LAB_HOOKS)[number];

const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>(["shell", "write", "ask", "subagent", "other"]);
const END_REASONS: ReadonlySet<string> = new Set(["exit", "killed", "crash"]);

const field = (p: unknown, k: string): unknown => (p !== null && typeof p === "object" ? (p as Record<string, unknown>)[k] : undefined);
const str = (p: unknown, k: string): string | undefined => {
  const v = field(p, k);
  return typeof v === "string" && v !== "" ? v : undefined;
};
const strings = (p: unknown, k: string): string[] | undefined => {
  const v = field(p, k);
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
};

type Draft = HarnessEvent extends infer E ? (E extends HarnessEvent ? Omit<E, "run_id" | "seq" | "at"> : never) : never;

class PayloadError extends Error {}

const need = (p: unknown, hook: string, k: string): string => {
  const v = str(p, k);
  if (v === undefined) throw new PayloadError(`${hook}: no ${k}`);
  return v;
};

function prompted(p: unknown): Draft[] {
  const prompt = need(p, "prompt", "prompt");
  const mark = readPromptMark(prompt);
  if (!mark) return [{ type: "turn.started", source: "person" }, { type: "input.received", by: "pane" }];
  const started: Draft = { type: "turn.started", source: mark.source, prompt_id: mark.id };
  return mark.source === "answer" ? [started, { type: "input.received", by: "norn" }] : [started];
}

function drafts(hook: string, p: unknown): Draft[] {
  switch (hook as LabHook) {
    case "start":
      return [{ type: "session.started", harness_session: need(p, hook, "session_id") }];
    case "prompt":
      return prompted(p);
    case "tool": {
      const kind = str(p, "kind") ?? "other";
      if (!TOOL_KINDS.has(kind)) throw new PayloadError(`tool: unknown kind ${JSON.stringify(kind)}`);
      const detail = str(p, "detail");
      return [{ type: "tool.requested", id: need(p, hook, "id"), kind: kind as ToolKind, tool: str(p, "tool") ?? kind, ...(detail !== undefined && { detail }) }];
    }
    case "tool-done":
      return [{ type: "tool.finished", id: need(p, hook, "id"), ok: field(p, "ok") !== false }];
    case "permission":
      return [{ type: "tool.permission", id: need(p, hook, "id"), prompt: need(p, hook, "prompt") }];
    case "ask": {
      const options = strings(p, "options");
      return [{ type: "input.requested", id: need(p, hook, "id"), question: need(p, hook, "question"), ...(options !== undefined && { options }) }];
    }
    case "answer": {
      const by = str(p, "by") ?? "pane";
      if (by !== "pane" && by !== "norn") throw new PayloadError(`answer: unknown by ${JSON.stringify(by)}`);
      const id = str(p, "id");
      return [{ type: "input.received", by, ...(id !== undefined && { id }) }];
    }
    case "compact":
      return [{ type: "context.compacted" }];
    case "stop": {
      const last = str(p, "last_message");
      const error = str(p, "error");
      return [{ type: "turn.ended", ...(last !== undefined && { last_message: last }), ...(error !== undefined && { error }) }];
    }
    case "end": {
      const reason = str(p, "reason") ?? "exit";
      if (!END_REASONS.has(reason)) throw new PayloadError(`end: unknown reason ${JSON.stringify(reason)}`);
      return [{ type: "session.ended", reason: reason as "exit" }];
    }
    default:
      throw new PayloadError(`unknown hook ${JSON.stringify(hook)}`);
  }
}

/** A malformed payload or an unknown hook is one `hook.error`, never a throw. */
export function normalize(input: NormalizeInput): HarnessEvent[] {
  const base = { run_id: input.run_id, at: input.at };
  try {
    return drafts(input.hook, input.payload).map((d, i) => ({ ...d, ...base, seq: input.seq + i }) as HarnessEvent);
  } catch (e) {
    if (!(e instanceof PayloadError)) throw e;
    return [{ type: "hook.error", ...base, seq: input.seq, hook: input.hook, message: e.message }];
  }
}

/** Allow is an empty answer; a deny, a block or context goes back as the answer's JSON. */
export function respond({ answer }: RespondInput): NativeReply {
  return answer.kind === "allow" ? { stdout: "", exit_code: 0 } : { stdout: `${JSON.stringify(answer)}\n`, exit_code: 0 };
}
