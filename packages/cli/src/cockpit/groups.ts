/**
 * What each unit needs from the person, in the words and marks the cockpit, the tab bar segment and
 * the sidebar token share. Pure: a unit's view in, its group out.
 */
import type { StoryView, UnitView } from "../views.ts";

/** What a row needs from the person; `running` only counts, in the segment and a story's preview. */
export type CockpitGroup = "your_turn" | "answer" | "approve" | "unblock" | "running";

/** One mark per group, shared by the cockpit rows, the tab bar segment and the sidebar token. */
export const GROUP_MARK: Readonly<Record<CockpitGroup, string>> = { your_turn: "▶", answer: "◆", approve: "●", unblock: "✖", running: "◐" };
export const GROUP_WORD: Readonly<Record<CockpitGroup, string>> = { your_turn: "your turn", answer: "answer", approve: "approve", unblock: "stuck", running: "running" };
/** The groups that wait for the person, in the order the cockpit lists them. */
export const NEEDS: readonly CockpitGroup[] = ["your_turn", "answer", "approve", "unblock"];

/** What a unit needs from the person, by what it waits for and the command that resolves it; null when nothing. */
export function groupOf(u: UnitView): CockpitGroup | null {
  const w = u.waiting;
  if (w) {
    if (w.for === "gate") return "approve";
    if (w.for === "answer" || w.for === "permission") return "answer";
    if (w.next?.startsWith(`norn run start ${u.id}`)) return "your_turn";
    return "unblock";
  }
  if (!u.run || u.ended !== undefined) return null;
  // an attended run is a person's to work beside
  return u.run.attended ? "your_turn" : "running";
}

/** Every unit of the story ended done, with nothing left on its record. */
export function finished(s: StoryView): boolean {
  return s.units.length > 0 && s.unsynced === undefined && s.units.every((u) => u.ended === "done" && u.pending_receipts === 0);
}
