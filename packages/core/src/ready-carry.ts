/**
 * What happened to a story since the person's last `approve` at `ready`: whether that approval
 * carries over (only clean base merges, every check green since), and the merge commits brought in,
 * whose remerge-diffs are what a person reads when a resolution asks them again. Pure over the story
 * unit's receipts of the round, so every machine carries the same approvals.
 */
import type { UnitState, Workflow } from "@norn/schema";
import type { NumberedReceipt, StoryFacts, UnitFacts } from "./facts.ts";
import { edgeOf, stepOf } from "./workflow.ts";

/** The reason a carried approve records, and History shows. */
export const CARRIED_CLEAN = "clean base merge";

/** Receipts that send a finished story unit back into its workflow — the head will change, the ready gate is passed again. */
export const RE_ENTRY_KINDS = ["update", "workflow"] as const;

export interface ReadySince {
  /** the approval carries: since it, only `clean` updates, and every check after the last of them passed */
  carry: boolean;
  /** an update since the approval ended `resolved`: the person approves again */
  resolved: boolean;
  /** merge commits the light-path updates since the approval brought in, oldest first */
  merges: string[];
}

/** The `ready` gate: the step named so, or any gate whose `approve` goes to `$done` or to a merge step. */
export function isReadyGate(wf: Workflow, step: string): boolean {
  const to = edgeOf(wf, step, "approve")?.to ?? "";
  return step === "ready" || (stepOf(wf, step)?.type === "gate" && (to === "$done" || stepOf(wf, to)?.type === "merge"));
}

/**
 * The newest `approve` at the ready gate, unless a re-entry (`norn story update-branch`, `norn story
 * edit --at`) came after it, which voids it. `receipts` need at least the kinds `approve` and
 * RE_ENTRY_KINDS; order does not matter.
 */
export function readyApprovalReceipt(wf: Workflow, receipts: readonly NumberedReceipt[]): NumberedReceipt | undefined {
  const sorted = [...receipts].sort((a, b) => b.n - a.n);
  for (const nr of sorted) {
    const r = nr.receipt;
    if ((RE_ENTRY_KINDS as readonly string[]).includes(r.kind)) return undefined;
    if (r.kind === "approve" && isReadyGate(wf, r.step)) return nr;
  }
  return undefined;
}

const isUpdateStep = (wf: Workflow, step: string) => {
  const s = stepOf(wf, step);
  return s?.type === "git" && s.action === "update";
};

/**
 * Receipts allowed between a carried approval and the gate: a base move at a waiting step, an update
 * that merged cleanly, a git step done, a check green (or sent to update by a base move), and
 * bookkeeping. Anything else (an agent ran, a check went red, a person acted) needs a person again.
 */
function quiet(wf: Workflow, nr: NumberedReceipt): boolean {
  const r = nr.receipt;
  const type = stepOf(wf, r.step)?.type;
  switch (r.kind) {
    case "mode":
    case "take":
      return true;
    case "check":
      return r.outcome === "pass" || r.outcome === "stale";
    case "classify":
      if (isUpdateStep(wf, r.step)) return r.outcome === "clean";
      if (type === "gate" || type === "merge") return r.outcome === "stale";
      return type === "git" && r.outcome === "done";
    default:
      return false;
  }
}

/**
 * What happened since the ready approval; undefined when there is none in the round. `receipts`
 * must hold every receipt after that approval (and the approval itself); order does not matter.
 */
export function readySince(wf: Workflow, receipts: readonly NumberedReceipt[]): ReadySince | undefined {
  const approval = readyApprovalReceipt(wf, receipts);
  if (!approval) return undefined;
  const after = receipts.filter((nr) => nr.n > approval.n).sort((a, b) => a.n - b.n);
  const updates = after.filter((nr) => nr.receipt.kind === "classify" && isUpdateStep(wf, nr.receipt.step));
  const merges: string[] = [];
  for (const { receipt: r } of updates) {
    if (r.kind !== "classify" || !r.history) continue;
    // a receipt's history is newest first; each later update may repeat merges an earlier one listed
    for (const c of [...r.history.commits].reverse()) if (c.parents.length > 1 && !merges.includes(c.sha)) merges.push(c.sha);
  }
  const last = updates.at(-1);
  const greenSince = !!last && after.some((nr) => nr.n > last.n && nr.receipt.kind === "check" && nr.receipt.outcome === "pass");
  const resolved = updates.some((nr) => nr.receipt.kind === "classify" && nr.receipt.outcome === "resolved");
  return { carry: greenSince && after.every((nr) => quiet(wf, nr)), resolved, merges };
}

/**
 * The story waits at its ready gate and the person's last approval there carries over: norn approves
 * on its own. Needs the story head the base facts measured, the head the approval is recorded at.
 */
export function carriedApproval(story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): boolean {
  return uf.unit.slice === null && st.park?.kind === "gate" && isReadyGate(wf, st.step) && story.ready_since?.carry === true && !!story.base;
}

/** One command per merge that shows what its author changed beyond what git merged alone. */
export const remergeCommands = (merges: readonly string[]): string[] => merges.map((sha) => `git show --remerge-diff ${sha}`);
