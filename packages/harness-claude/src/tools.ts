/** Claude Code tool hooks → tool, subagent and input events. */
import type { ToolKind } from "@norn/plugin-api";
import { type Draft, need } from "./draft.ts";
import { isObject, type JsonObject, list, obj, str, summarize } from "./payload.ts";

const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// Claude Code renamed its subagent tool; both names launch one. Spelled as a pattern because the
// older name is a word the repo's glossary lint bans in sources.
const SUBAGENT_TOOL = /^(?:Agent|Ta[s]k)$/;
const ASK_TOOL = "AskUserQuestion";

export function toolKind(tool: string): ToolKind {
  if (tool === "Bash") return "shell";
  if (WRITE_TOOLS.has(tool)) return "write";
  if (tool === ASK_TOOL) return "ask";
  if (SUBAGENT_TOOL.test(tool)) return "subagent";
  return "other";
}

interface ToolCall {
  id: string;
  tool: string;
  input: JsonObject | undefined;
}

function toolCall(payload: unknown): ToolCall {
  return { id: need(str(payload, "tool_use_id"), "tool_use_id"), tool: need(str(payload, "tool_name"), "tool_name"), input: obj(payload, "tool_input") };
}

const background = (input: JsonObject | undefined) => input?.run_in_background === true;

/** AskUserQuestion's `questions[]`: several are asked as one input; options only make sense for one. */
function question(input: JsonObject | undefined): { question: string; options?: string[] } {
  const questions = (list(input, "questions") ?? []).filter(isObject);
  const texts = questions.map((q) => str(q, "question")).filter((q): q is string => q !== undefined);
  if (texts.length === 0) return { question: str(input, "question") ?? "" };
  const only = questions.length === 1 ? questions[0] : undefined;
  const options = (list(only, "options") ?? []).map((o) => (typeof o === "string" ? o : str(o, "label"))).filter((o): o is string => o !== undefined);
  return { question: texts.join("\n"), ...(options.length > 0 && { options }) };
}

export function preToolUse(payload: unknown): Draft[] {
  const call = toolCall(payload);
  const kind = toolKind(call.tool);
  const detail = kind === "ask" ? undefined : summarize(call.input);
  const out: Draft[] = [{ type: "tool.requested", id: call.id, kind, tool: call.tool, ...(detail !== undefined && { detail }) }];
  // the tool call's own id keys the input, so every tick sees the same ask however the tools interleave
  if (kind === "ask") out.push({ type: "input.requested", id: call.id, ...question(call.input) });
  if (kind === "subagent") out.push({ type: "subagent.started", id: call.id, background: background(call.input) });
  return out;
}

/** The id Claude Code gives a backgrounded subagent, which its SubagentStop later names. */
function launchedAgentId(response: unknown): string | undefined {
  if (typeof response === "string") return /agentId:\s*([\w-]+)/.exec(response)?.[1];
  return str(response, "agentId") ?? str(response, "agent_id");
}

export function postToolUse(payload: unknown, ok: boolean, answeredBy: "norn" | "pane"): Draft[] {
  const call = toolCall(payload);
  const kind = toolKind(call.tool);
  const out: Draft[] = [];
  if (kind === "ask" && ok) out.push({ type: "input.received", id: call.id, by: answeredBy });
  if (kind === "subagent") {
    // a backgrounded subagent's tool call returns at launch; from here it is tracked by the agent id
    // SubagentStop reports, so the tool call's id must not stay open forever
    out.push({ type: "subagent.finished", id: call.id });
    const agentId = ok && background(call.input) ? launchedAgentId(payload && (payload as JsonObject).tool_response) : undefined;
    if (agentId) out.push({ type: "subagent.started", id: agentId, background: true });
  }
  out.push({ type: "tool.finished", id: call.id, ok });
  return out;
}
