/**
 * What `norn hook` answers the agent tool, decided from the unit's session, the hook fact and
 * the normalized tool call. Pure: the cli gathers the facts and keeps the one effectful gate,
 * taking one of the run's capped turn-end refusals, for after this answers block.
 */
import type { HookFact } from "@norn/schema";
import { type AgentUnit, currentRun, cursorStep, runAgentSession, standingReport } from "./agent-unit.ts";
import { cmd } from "./commands.ts";
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
  const outcomes = reportableOutcomes(step);
  return {
    kind: "block",
    reason:
      `norn: step ${s.state.step} of ${s.unit.key} has no report for this run. Before ending your turn, report exactly once: ` +
      `\`${cmd.done(`<${outcomes.join("|")}>`)}\`, \`${cmd.ask()}\` or \`${cmd.stuck()}\`. ` +
      `Run \`${cmd.brief()}\` to see what each outcome means.`,
  };
}

export function hookAnswer(input: HookAnswerInput): HookAnswer {
  return turnEndBlock(input);
}
