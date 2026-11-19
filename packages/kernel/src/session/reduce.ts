import type { HarnessEvent } from "@norn/plugin-api";
import type { SessionView } from "./view.ts";

/** Mutable working copy; the closed-id sets never leave the reducer. */
interface Acc {
  view: SessionView;
  tools: Map<string, PendingToolKind>;
  // what each pending call is, `Bash(rm -rf build)`, for the permission prompt that asks about it
  calls: Map<string, string>;
  subagents: Map<string, boolean>;
  // an id once finished never reopens: a hook replayed with a fresh seq must not resurrect a call or an ask
  closedTools: Set<string>;
  closedSubagents: Set<string>;
  closedInputs: Set<string>;
  // the call an open permission is about, when its own id names none: an agent may raise a prompt
  // without naming the call, and the prompt must close when that call runs
  permissionTool?: string;
  lastAtMs: number;
}

type PendingToolKind = SessionView["pending_tools"][number]["kind"];

function emptyView(): SessionView {
  return { active: false, pending_tools: [], subagents: [], turn_ended: false, compactions: 0, pane_answers: 0, errors: [] };
}

/** The agent did something only a running agent can do; it ends a turn end and outlives a limit. */
function resumed(acc: Acc): void {
  acc.view.active = true;
  acc.view.turn_ended = false;
  delete acc.view.limit;
}

function dropTools(acc: Acc): void {
  for (const id of acc.tools.keys()) acc.closedTools.add(id);
  acc.tools.clear();
  acc.calls.clear();
}

function dropSubagents(acc: Acc, which: (background: boolean) => boolean): void {
  for (const [id, background] of acc.subagents)
    if (which(background)) {
      acc.subagents.delete(id);
      acc.closedSubagents.add(id);
    }
}

function closePermission(acc: Acc): void {
  delete acc.view.permission;
  delete acc.permissionTool;
}

/** The most recently requested call still pending: the one an unnamed permission prompt is about. */
function latestPendingTool(acc: Acc): string | undefined {
  return [...acc.tools.keys()].at(-1);
}

function nameCall(acc: Acc, id: string | undefined): void {
  const tool = id !== undefined ? acc.calls.get(id) : undefined;
  if (acc.view.permission && id !== undefined && tool !== undefined) acc.view.permission.call = { id, tool };
}

function closeInput(acc: Acc, id: string): void {
  acc.closedInputs.add(id);
  if (acc.view.input?.id === id) delete acc.view.input;
}

/**
 * An input no tool call backs (a dialog, a logged-out agent) has no finish of its own to close it.
 * The agent acting again shows it was answered, so any agent activity closes it; an input a tool
 * call holds stays open until that call finishes, whatever else runs beside it.
 */
function closeUnbackedInput(acc: Acc, except?: string): void {
  const input = acc.view.input;
  if (!input || input.id === except || acc.tools.has(input.id)) return;
  closeInput(acc, input.id);
}

function closeAnyInput(acc: Acc): void {
  if (acc.view.input) closeInput(acc, acc.view.input.id);
}

function apply(acc: Acc, e: HarnessEvent): void {
  const v = acc.view;
  switch (e.type) {
    case "session.started":
      // a resumed session starts again after its end, on a prompt: the turn that ended was the last process's
      v.harness_session = e.harness_session;
      delete v.ended;
      v.turn_ended = false;
      return;
    case "turn.started":
      resumed(acc);
      // a new turn means every tool of the last one is over, even one whose finish hook never fired,
      // and so is any ask: the agent is acting on a new prompt
      dropTools(acc);
      closePermission(acc);
      closeAnyInput(acc);
      delete v.report;
      return;
    case "tool.requested":
      if (acc.closedTools.has(e.id) || acc.tools.has(e.id)) return;
      resumed(acc);
      closeUnbackedInput(acc, e.id);
      acc.tools.set(e.id, e.kind);
      acc.calls.set(e.id, e.detail !== undefined ? `${e.tool}(${e.detail})` : e.tool);
      if (v.permission && v.permission.id !== e.id) closePermission(acc);
      return;
    case "tool.permission":
      if (acc.closedTools.has(e.id)) return;
      resumed(acc);
      v.permission = { id: e.id, prompt: e.prompt };
      if (acc.tools.has(e.id)) delete acc.permissionTool;
      else acc.permissionTool = latestPendingTool(acc);
      nameCall(acc, acc.tools.has(e.id) ? e.id : acc.permissionTool);
      return;
    case "tool.finished":
      if (!acc.tools.has(e.id)) return;
      acc.tools.delete(e.id);
      acc.calls.delete(e.id);
      acc.closedTools.add(e.id);
      if (v.permission && (v.permission.id === e.id || acc.permissionTool === e.id)) closePermission(acc);
      closeInput(acc, e.id);
      return;
    case "subagent.started":
      if (acc.closedSubagents.has(e.id) || acc.subagents.has(e.id)) return;
      resumed(acc);
      acc.subagents.set(e.id, e.background);
      return;
    case "subagent.finished":
      if (!acc.subagents.has(e.id)) return;
      acc.subagents.delete(e.id);
      acc.closedSubagents.add(e.id);
      return;
    case "input.requested":
      if (acc.closedInputs.has(e.id)) return;
      resumed(acc);
      v.input = e.options ? { id: e.id, question: e.question, options: [...e.options] } : { id: e.id, question: e.question };
      return;
    case "input.received":
      if (e.by === "pane") v.pane_answers++;
      // an answer without an id is typed into the pane, and answers whatever is open
      if (e.id !== undefined) closeInput(acc, e.id);
      else if (v.input) closeInput(acc, v.input.id);
      // an ask is a report the answer settles: left standing, it would read as asked again and park the unit anew
      if (v.report?.verb === "ask") delete v.report;
      return;
    case "limit.hit":
      v.limit = e.resets_at ? { kind: e.kind, resets_at: e.resets_at } : { kind: e.kind };
      return;
    case "context.compacted":
      v.compactions++;
      return;
    case "turn.ended":
      v.active = true;
      v.turn_ended = true;
      if (e.last_message !== undefined) v.last_message = e.last_message;
      if (e.error !== undefined) v.error = e.error;
      else delete v.error;
      // a turn cannot end while a call or a foreground subagent runs, so any left are hooks that never
      // fired; background subagents outlive the turn and report back later
      dropTools(acc);
      dropSubagents(acc, (background) => !background);
      closePermission(acc);
      closeAnyInput(acc);
      return;
    case "report.made":
      v.report = e.outcome !== undefined ? { verb: e.verb, outcome: e.outcome } : { verb: e.verb };
      return;
    case "session.ended":
      v.ended = e.reason;
      dropTools(acc);
      dropSubagents(acc, () => true);
      closePermission(acc);
      return;
    case "hook.error":
      v.errors.push({ hook: e.hook, message: e.message });
      return;
  }
}

/**
 * Fold a run's events into one view. Level-triggered: it reads the whole list each time, in seq
 * order whatever order the events arrive in, keeping the first event of a repeated seq, so a replay
 * or a late hook yields the same view as an orderly stream.
 */
export function reduceSession(events: readonly HarnessEvent[]): SessionView {
  const acc: Acc = {
    view: emptyView(),
    tools: new Map(),
    calls: new Map(),
    subagents: new Map(),
    closedTools: new Set(),
    closedSubagents: new Set(),
    closedInputs: new Set(),
    lastAtMs: Number.NEGATIVE_INFINITY,
  };
  const seen = new Set<number>();
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.seq - b.e.seq || a.i - b.i);
  for (const { e } of ordered) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    apply(acc, e);
    const at = Date.parse(e.at);
    if (at > acc.lastAtMs) {
      acc.lastAtMs = at;
      acc.view.last_event_at = e.at;
    }
  }
  acc.view.pending_tools = [...acc.tools].map(([id, kind]) => ({ id, kind }));
  acc.view.subagents = [...acc.subagents].map(([id, background]) => ({ id, background }));
  return acc.view;
}
