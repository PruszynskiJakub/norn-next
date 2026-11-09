/**
 * What `norn hook` answers the agent tool, decided from the unit's session, the hook fact and
 * the normalized tool call. Pure: the cli gathers the facts and keeps the one effectful gate,
 * taking one of the run's capped turn-end refusals, for after this answers block.
 */
import type { HookFact, Step } from "@norn/schema";
import { type AgentUnit, currentRun, cursorStep, runAgentSession, standingReport } from "./agent-unit.ts";
import { cmd } from "./commands.ts";
import { HARD_RULES, ruleWithReason } from "./hard-rules.ts";
import type { AgentAdapter, HookAnswer, ToolCall } from "./ports.ts";
import { reportableOutcomes } from "./workflow.ts";

export interface HookAnswerInput {
  /** the worktree's unit; null when it has not started or does not load */
  session: AgentUnit | null;
  fact: HookFact;
  toolCall: ToolCall | null;
  adapter: Pick<AgentAdapter, "name" | "tier" | "hookEvents">;
}

const ALLOW: HookAnswer = { kind: "allow" };

/**
 * A fact the adapter can refuse is a turn end raised by the adapter's own turn-end hook — its
 * native event maps to `turn_end` in `adapter.hookEvents` (Claude/Codex `Stop`, Gemini
 * `AfterAgent`). A turn end derived from another event (Claude's `Notification` idle_prompt)
 * cannot be refused, so it is never blocked nor counted toward the cap.
 */
const refusableTurnEnd = (adapter: HookAnswerInput["adapter"], fact: HookFact): boolean =>
  adapter.tier === "blocking" && fact.event === "turn_end" && fact.agent === adapter.name && Object.hasOwn(adapter.hookEvents, fact.native) && adapter.hookEvents[fact.native] === "turn_end";

/** The fact comes from an agent session other than the one `run_id` belongs to. */
export function foreignFact(s: AgentUnit, run_id: string, fact: HookFact): boolean {
  const owner = runAgentSession(s, run_id);
  return !!owner && !!fact.agent_session_id && fact.agent_session_id !== owner;
}

const reportLine = (step: Step): string =>
  `\`${cmd.done(`<${reportableOutcomes(step).join("|")}>`)}\`, \`${cmd.ask()}\` or \`${cmd.stuck()}\``;

/** Block the turn end only in an unattended agent step whose live run has not reported. */
function turnEndBlock({ session: s, fact, adapter }: HookAnswerInput): HookAnswer {
  if (!refusableTurnEnd(adapter, fact) || !s) return ALLOW;
  const step = cursorStep(s);
  if (!step || step.type !== "agent" || step.attended) return ALLOW;
  if (s.state.status !== "running" && s.state.status !== "ready") return ALLOW;
  const run = currentRun(s);
  if (!run || (fact.run_id && fact.run_id !== run.run_id)) return ALLOW;
  if (foreignFact(s, run.run_id, fact)) return ALLOW; // It cannot report the run, so it is not held to it
  if (standingReport(s, run.run_id)) return ALLOW;
  return {
    kind: "block",
    reason:
      `norn: step ${s.state.step} of ${s.unit.key} has no report for this run. Before ending your turn, report exactly once: ${reportLine(step)}. ` +
      `Run \`${cmd.brief()}\` to see what each outcome means.`,
  };
}

type AgentStep = Extract<Step, { type: "agent" }>;

const agentStep = (s: AgentUnit | null): AgentStep | null => {
  const step = s && cursorStep(s);
  return step?.type === "agent" ? step : null;
};

/**
 * Every session source but start-up (compact, resume, clear) has lost the brief it was given;
 * at start-up the agent is about to read the brief, so a note would only repeat it. A source the
 * tool does not name is treated as start-up.
 */
function sessionNote({ session: s, fact }: HookAnswerInput): HookAnswer {
  if (fact.event !== "session_start" || !fact.message || fact.message === "startup") return ALLOW;
  const step = agentStep(s);
  if (!s || !step) return ALLOW;
  const rules = HARD_RULES.map((r) => `- ${ruleWithReason(r.id)}`);
  return {
    kind: "context",
    text: [
      `norn: this session works step ${s.state.step} of ${s.unit.key}. Report exactly once: ${reportLine(step)}.`,
      "The hard rules:",
      ...rules,
      `Run \`${cmd.brief()}\` for the rest.`,
    ].join("\n"),
  };
}

/** A long conversation buries the brief, so each prompt of an attended step restates how it ends. */
function attendedReminder({ session: s, fact }: HookAnswerInput): HookAnswer {
  if (fact.event !== "turn_start" || !agentStep(s)?.attended) return ALLOW;
  return {
    kind: "context",
    text: "norn: report `norn done` only once the person agrees the work is finished, and ask in this session rather than with `norn ask`.",
  };
}

export function hookAnswer(input: HookAnswerInput): HookAnswer {
  if (input.fact.event === "session_start") return sessionNote(input);
  if (input.fact.event === "turn_start") return attendedReminder(input);
  return turnEndBlock(input);
}
