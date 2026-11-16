/**
 * What an agent's report must come with. Pure: `norn done` asks `checkHandBack` before it writes a
 * receipt, so an outcome that sends work back carries what the next agent works from.
 */
import { type AgentStep, type HandBack, outcomeEdge } from "@norn/schema";
import { cmd } from "./commands.ts";

export interface HandBackRefusal {
  code: "hand_back_required";
  error: string;
  do_instead: string;
  details: { outcome: string; hand_back: HandBack };
}

export interface HandBackInput {
  step: AgentStep;
  step_name: string;
  outcome: string;
  /** findings parsed from `--findings`; null = flag not given */
  findings: number | null;
  /** an `--evidence` folder was given */
  evidence: boolean;
}

const FORMAT: Record<HandBack, string> = {
  findings: 'a JSON file {"findings": [{"severity": "blocking" | "major" | "minor" | "nit", "title": "…", "detail"?, "file"?, "line"?, "criterion"?, "repro"?}]}, at least one finding',
  evidence: "a folder of the files that show it",
};

/** null when the report may be written; otherwise why not and the command to run instead. */
export function checkHandBack(input: HandBackInput): HandBackRefusal | null {
  const need = input.step.hand_back?.[input.outcome];
  if (need === undefined) return null;
  // An empty findings file sends the work back with nothing to rework, the same as none
  if (need === "findings" ? (input.findings ?? 0) > 0 : input.evidence) return null;
  const spec = input.step.outcomes[input.outcome];
  const criteria = input.step.criteria === "required" || (spec !== undefined && outcomeEdge(spec).verdict !== undefined);
  return {
    code: "hand_back_required",
    error: `step ${input.step_name} hands back ${need} with outcome ${input.outcome} (hand_back), and this report has none`,
    do_instead: `write ${FORMAT[need]}, then run: ${cmd.done(input.outcome, { criteria, [need]: true })}`,
    details: { outcome: input.outcome, hand_back: need },
  };
}
