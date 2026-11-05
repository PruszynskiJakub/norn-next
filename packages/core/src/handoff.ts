/**
 * A unit's status (S9), rendered from state.json. gh-195 D9 (B6, B7): `brief` and `story checkout` print
 * it above the handoff; it is never written into the handoff, which holds only what agents and people
 * write there (Goal / Progress / Resume).
 */
import type { UnitState, Workflow } from "@norn/schema";
import { nextCommand } from "./commands.ts";

export const STATUS_BEGIN = "<!-- norn:status — generated from state.json, do not edit -->";
export const STATUS_END = "<!-- /norn:status -->";

/** The unit's counters as the status shows them, `review_loop 1/3, test_loop 0/5`; "none" without any. */
export function handoffCounters(state: UnitState, workflow?: Workflow | null): string {
  const max = workflow?.counters ?? {};
  const counters = Object.keys({ ...max, ...state.counters })
    .sort()
    .map((c) => `${c} ${state.counters[c] ?? 0}${max[c] ? `/${max[c].max}` : ""}`);
  return counters.length ? counters.join(", ") : "none";
}

/** The unit's last outcome as the status shows it, `review.changes_requested (agent, <at>)`; "none" before any. */
export function handoffLastOutcome(state: UnitState): string {
  return state.last_outcome ? `${state.last_outcome.step}.${state.last_outcome.outcome} (${state.last_outcome.source}, ${state.last_outcome.at})` : "none";
}

/**
 * The status block (S9): story, slice, step, attempt, counters, last outcome, next command. gh-195 D9
 * (B7): rendered from state.json for `brief` and `story checkout` to print above the handoff, never
 * written into the file (B6).
 */
export function renderHandoffStatus(state: UnitState, opts: { workflow?: Workflow | null; next?: string | null } = {}): string {
  const key = state.slice ?? state.story;
  const status = state.park ? `${state.status} (${state.park.kind}: ${state.park.reason})` : state.status;
  const next = opts.next === undefined ? nextCommand(key, state) : opts.next;
  const lines = [
    STATUS_BEGIN,
    `- Story: ${state.story}${state.slice ? ` · Slice: ${state.slice}` : ""}`,
    // gh-71 B28 (D10): the story's round next to its workflow; a slice has no rounds of its own
    `- ${state.slice ? "" : `Round ${state.round ?? 1} · `}Workflow: ${state.workflow} · Step: ${state.step} (attempt ${state.attempt})`,
    `- Status: ${status}`,
    `- Counters: ${handoffCounters(state, opts.workflow)}`,
    `- Last outcome: ${handoffLastOutcome(state)}`,
    `- Next: ${next ? `\`${next}\`` : "nothing — done"}`,
    `- Updated: ${state.updated_at}`,
    STATUS_END,
  ];
  return lines.join("\n");
}

/**
 * gh-195 D9 (B7): what `story checkout` prints for a unit: its status block (markers dropped), then the
 * handoff's written part `prose` (null: no handoff on the branch).
 */
export function renderHandoffWithStatus(state: UnitState, prose: string | null, opts: { workflow?: Workflow | null } = {}): string {
  const status = renderHandoffStatus(state, opts)
    .split("\n")
    .filter((l) => l !== STATUS_BEGIN && l !== STATUS_END)
    .join("\n");
  return prose?.trim() ? `${status}\n\n${prose.replace(/^\n+/, "")}` : `${status}\n`;
}
