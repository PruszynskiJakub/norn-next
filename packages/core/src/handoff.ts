/**
 * A unit's status, rendered from state.json. `brief` and `story checkout` print it above the
 * handoff; it is never written into the handoff, which holds only what agents and people write.
 */
import type { UnitState, Workflow } from "@norn/schema";
import { nextCommand } from "./commands.ts";

export const STATUS_BEGIN = "<!-- norn:status — generated from state.json, do not edit -->";
const STATUS_END = "<!-- /norn:status -->";

/**
 * The handoff's sections, in order, each with what it holds. The handoff is the unit's current state,
 * rewritten by whoever works on it; what happened is in the receipts, which the brief lists as History.
 */
export const HANDOFF_SECTIONS: ReadonlyArray<readonly [heading: string, holds: string]> = [
  ["Goal", "what this unit must achieve, in one or two lines"],
  ["Proof", "each thing the goal needs, and what proves it: a named test, a command, an evidence file"],
  ["Easy to miss", "the rule or edge case the quick path would break"],
  ["Not proven yet", "what is still open or unverified"],
  ["Notes", "decisions and why, what was tried and failed, and what the next step must know, such as a repro loop or a seam"],
  ["Resume", "the exact next action, so a fresh agent or a person can continue from git alone"],
];

/** A new handoff: the section headings, empty. */
export const HANDOFF_SKELETON = HANDOFF_SECTIONS.map(([h]) => `## ${h}\n`).join("\n");

/** `norn done` refuses a handoff over this size: past it, a handoff has turned into a log. */
export const HANDOFF_MAX_BYTES = 8 * 1024;

/** The handoff's size in bytes, as `norn done` measures it. */
export const handoffBytes = (text: string): number => new TextEncoder().encode(text).length;

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

export function renderHandoffStatus(state: UnitState, opts: { workflow?: Workflow | null; next?: string | null } = {}): string {
  const key = state.slice ?? state.story;
  const status = state.park ? `${state.status} (${state.park.kind}: ${state.park.reason})` : state.status;
  const next = opts.next === undefined ? nextCommand(key, state) : opts.next;
  const lines = [
    STATUS_BEGIN,
    `- Story: ${state.story}${state.slice ? ` · Slice: ${state.slice}` : ""}`,
    // a slice has no rounds of its own
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
 * What `story checkout` prints for a unit: its status block (markers dropped), then the
 * handoff's written part `prose` (null: no handoff on the branch).
 */
export function renderHandoffWithStatus(state: UnitState, prose: string | null, opts: { workflow?: Workflow | null } = {}): string {
  const status = renderHandoffStatus(state, opts)
    .split("\n")
    .filter((l) => l !== STATUS_BEGIN && l !== STATUS_END)
    .join("\n");
  return prose?.trim() ? `${status}\n\n${prose.replace(/^\n+/, "")}` : `${status}\n`;
}
