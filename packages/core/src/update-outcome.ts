/**
 * The outcome of a `git: update` step, chosen from what the merge of the base did. Act performs
 * the merge and reports it here; the choice is pure so every outcome the step can take is
 * testable with scripted input. A dirty worktree or a diverged story branch never reaches here:
 * act ends the step `stuck` before any merge.
 */

/** What merging the base into the story branch did: merged it, found nothing missing, or conflicted (aborted, paths named). */
export type UpdateMerge = { outcome: "merged" } | { outcome: "up_to_date" } | { outcome: "conflict"; files: string[] };

export interface UpdateSummary {
  merge: UpdateMerge;
}

export type UpdateOutcome = "done" | "conflict";

export function updateOutcome(summary: UpdateSummary): UpdateOutcome {
  return summary.merge.outcome === "conflict" ? "conflict" : "done";
}
