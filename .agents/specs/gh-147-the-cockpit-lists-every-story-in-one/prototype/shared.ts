/**
 * PROTOTYPE (throwaway) — shared bits for the cockpit layout variants. Question: how should the cockpit
 * lay out a growing list of stories so it is not cramped, the stage of each story is obvious, and it
 * stays navigable? Variants render the real CockpitModel (`norn status --watch --json`) and only read.
 */
export type { CockpitModel, CockpitRow, CockpitAction } from "/Users/jakubpruszynski/Projects/norn/packages/view/src/cockpit.ts";
export { parseKeys, fit, wrap, previewLines, type Key, type Look } from "/Users/jakubpruszynski/Projects/norn/packages/cli/src/runtime/cockpit-tui.ts";
import type { CockpitAction, CockpitModel, CockpitRow } from "/Users/jakubpruszynski/Projects/norn/packages/view/src/cockpit.ts";
import type { Key, Look } from "/Users/jakubpruszynski/Projects/norn/packages/cli/src/runtime/cockpit-tui.ts";

/** What a variant returns besides its next state. `run` is stubbed: the harness shows "would run …". */
export type Effect = { kind: "run"; row: CockpitRow; action: CockpitAction; input?: string } | { kind: "quit" };

export interface Variant<S = any> {
  key: string;
  name: string;
  init(model: CockpitModel): S;
  handle(s: S, key: Key, model: CockpitModel, look: Look): { state: S; effect?: Effect };
  /** the whole screen, exactly look.height lines, none wider than look.width (visible columns) */
  frame(model: CockpitModel, s: S, look: Look & { toast: string | null }): string;
}

// ---------------------------------------------------------------- styling

export const STYLE = { bold: "1", dim: "2", italic: "3", underline: "4", inverse: "7", red: "31", green: "32", yellow: "33", blue: "34", magenta: "35", cyan: "36", gray: "90", bgGray: "48;5;236", bgSel: "48;5;238" } as const;
export type Style = keyof typeof STYLE;
export const paint = (t: string, styles: readonly Style[] = []) => (styles.length && t ? `\x1b[${styles.map((k) => STYLE[k]).join(";")}m${t}\x1b[0m` : t);
export const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
/** Pad a styled string to n visible columns. */
export const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - visible(s)));

export const GROUP_MARK: Record<string, string> = { your_turn: "▶", answer: "◆", approve: "●", unblock: "✖", check: "◇", unclaimed: "○", running: "◐" };
export const GROUP_WORD: Record<string, string> = { your_turn: "your turn", answer: "answer", approve: "approve", unblock: "stuck", check: "check" };
export const GROUP_STYLE: Record<string, Style[]> = { your_turn: ["bold", "green"], answer: ["bold", "yellow"], approve: ["bold", "cyan"], unblock: ["bold", "red"], check: ["magenta"] };

// ---------------------------------------------------------------- stages

/**
 * One cross-workflow phase per step, so stories in different workflows line up:
 * backlog (not started) → intake (triage/reproduce) → shape (refine…approve-plan) → build → ship → done.
 */
export type Phase = "backlog" | "intake" | "shape" | "build" | "ship" | "done";
export const PHASES: Phase[] = ["backlog", "intake", "shape", "build", "ship", "done"];
const STEP_PHASE: Record<string, Phase> = {
  explore: "intake", reproduce: "intake", confirm: "intake",
  refine: "shape", clarify: "shape", plan: "shape", slice: "shape", "approve-plan": "shape",
  sync: "build", "sync-resolve": "build", implement: "build", slices: "build", update: "build", resolve: "build", test: "build", review: "build", qa: "build", prepare: "build",
  "human-qa": "ship", describe: "ship", "open-pr": "ship", ci: "ship", ready: "ship", integrate: "ship", merge: "ship",
};
/** Steps of each workflow in order (from .agents/workflows/*.yaml), for a per-story progress strip. */
export const WORKFLOW_STEPS: Record<string, string[]> = {
  triage: ["explore", "confirm"],
  reproduce: ["reproduce", "confirm"],
  quick: ["sync", "implement", "test", "review", "describe", "open-pr", "ci", "ready"],
  fix: ["sync", "implement", "test", "review", "describe", "open-pr", "ci", "ready"],
  story: ["refine", "clarify", "plan", "slice", "approve-plan", "sync", "slices", "test", "qa", "human-qa", "describe", "open-pr", "ci", "ready"],
  release: ["prepare", "open-pr", "ci", "ready"],
};

/** The phase a story row is in. A closed story (story_status done) is done whatever its unit says. */
export function phaseOf(r: CockpitRow): Phase {
  const rep = r.preview.report;
  if (rep.story_status === "done" || rep.unit.status === "done") return "done";
  if (rep.unit.status === "not_started" || !rep.unit.step) return "backlog";
  return STEP_PHASE[rep.unit.step] ?? "build";
}

/** How a story's unit is doing right now, as one word. */
export type Health = "needs-you" | "running" | "stuck" | "parked" | "ready" | "idle" | "done";
export function healthOf(story: string, model: CockpitModel): Health {
  const s = model.rows.find((r) => r.kind === "story" && r.story === story);
  const rep = s?.preview.report;
  if (model.rows.some((r) => r.kind === "item" && r.story === story)) return "needs-you";
  if (!rep) return "idle";
  if (rep.story_status === "done" || rep.unit.status === "done") return "done";
  if (rep.unit.status === "stuck" || rep.unit.status === "corrupt") return "stuck";
  if (rep.unit.status === "running" || rep.running.length) return "running";
  if (rep.unit.status === "parked") return "parked";
  if (rep.unit.status === "ready") return "ready";
  return "idle";
}

/** The story rows, and the items (needs-you rows) by story. */
export function split(model: CockpitModel) {
  const stories = model.rows.filter((r) => r.kind === "story");
  const items = model.rows.filter((r) => r.kind === "item");
  const itemsBy = new Map<string, CockpitRow[]>();
  for (const i of items) itemsBy.set(i.story, [...(itemsBy.get(i.story) ?? []), i]);
  return { stories, items, itemsBy };
}

/** A key's name for action lookup: `enter` or the char. */
export const keyName = (k: Key) => (k.kind === "enter" ? "enter" : k.kind === "char" ? k.char : null);

