/**
 * The outcome of a `git: update` step, chosen from what the merge of the base did and, for the
 * light path, from the story's first-parent commits since the round's latest `approve`. Act performs
 * the merge and gathers the git summary; the choice is pure so every outcome the step can take is
 * testable with scripted input, and the same receipts and history choose the same outcome on every
 * machine. A dirty worktree or a diverged story branch never reaches here: act ends the step
 * `stuck` before any merge.
 */
import { outcomeEdge, type Workflow } from "@norn/schema";
import type { NumberedReceipt } from "./facts.ts";
import { allRegenerable, REGENERATED_TRAILER, type RegenerateGlobs } from "./regenerate.ts";

/** What merging the base into the story branch did: merged it, found nothing missing, or conflicted (aborted, paths named). */
export type UpdateMerge = { outcome: "merged" } | { outcome: "up_to_date" } | { outcome: "conflict"; files: string[] };

/** One commit on the story's first-parent line since the anchor, as the git port reports it. */
export interface UpdateCommit {
  sha: string;
  parents: string[];
  /** paths changed against the first parent */
  paths: string[];
  trailers: Record<string, string>;
  /** a merge: its other parents are in the base's history */
  from_base?: boolean;
  /** a merge: paths of its remerge-diff ([] = git merged it alone); null = git could not tell */
  remerge?: string[] | null;
}

/** The story's commits from the anchor (exclusive) to the head after the merge, newest first. */
export interface UpdateHistory {
  /** the head at the latest `approve` of the round */
  anchor: string;
  /** the story's spec folder, repo-relative */
  spec_dir: string;
  commits: UpdateCommit[];
}

export interface UpdateSummary {
  merge: UpdateMerge;
  /** absent or null: no `approve` to measure from, or its head is not under the branch */
  history?: UpdateHistory | null;
  /** the team's regenerate mapping; absent = none, so no merge counts as regenerated */
  regenerate?: readonly RegenerateGlobs[];
}

export type UpdateOutcome = "done" | "conflict" | "clean" | "resolved";

/** The light-path outcomes, taken only where the workflow routes them. */
export const LIGHT_OUTCOMES = ["clean", "resolved"] as const;

const isMerge = (c: UpdateCommit) => c.parents.length > 1;

/** Bookkeeping: a commit that changes only the spec folder, never its `spec.md` (the contract). */
function bookkeeping(c: UpdateCommit, specDir: string): boolean {
  const dir = specDir.replace(/\/+$/, "");
  return c.paths.every((p) => p.startsWith(`${dir}/`) && p !== `${dir}/spec.md`);
}

/** Every commit since the anchor is a merge of the base or spec-folder bookkeeping. */
function light(h: UpdateHistory): boolean {
  return h.commits.every((c) => (isMerge(c) ? c.from_base === true : bookkeeping(c, h.spec_dir)));
}

/**
 * A merge the light path carries without review: git made it alone (empty remerge-diff), or norn
 * regenerated it (its trailer) and everything it changed over git's own merge is a generated file.
 */
function cleanMerge(c: UpdateCommit, regenerate: readonly RegenerateGlobs[]): boolean {
  if (!Array.isArray(c.remerge)) return false;
  if (c.remerge.length === 0) return true;
  return REGENERATED_TRAILER in c.trailers && allRegenerable(regenerate, c.remerge);
}

/** `routed`: the outcomes the update step declares; a light outcome it does not route falls back to `done`. */
export function updateOutcome(summary: UpdateSummary, routed: readonly string[] = []): UpdateOutcome {
  if (summary.merge.outcome === "conflict") return "conflict";
  const h = summary.history;
  if (!h || !light(h)) return "done";
  const clean = h.commits.filter(isMerge).every((c) => cleanMerge(c, summary.regenerate ?? []));
  const outcome = clean ? "clean" : "resolved";
  return routed.includes(outcome) ? outcome : "done";
}

const isOpenPr = (wf: Workflow, step: string) => {
  const s = wf.steps[step];
  return s?.type === "git" && s.action === "open-pr";
};

/** Steps the round can reach from its start without passing a `git: open-pr` step. */
function beforeOpenPr(wf: Workflow): Set<string> {
  const seen = new Set<string>();
  const queue = isOpenPr(wf, wf.start) ? [] : [wf.start];
  while (queue.length) {
    const step = queue.shift() as string;
    if (seen.has(step)) continue;
    seen.add(step);
    for (const spec of Object.values((wf.steps[step]?.outcomes ?? {}) as Record<string, Parameters<typeof outcomeEdge>[0] | undefined>)) {
      if (spec === undefined) continue;
      const to = outcomeEdge(spec).to;
      if (wf.steps[to] && !isOpenPr(wf, to)) queue.push(to);
    }
  }
  return seen;
}

/**
 * The head at the latest receipt of the round whose outcome is `approve` — a gate's approve or an
 * agent's (a review) — or null when there is none, that receipt recorded no head, or the story's PR
 * does not already hold every approval the light path skips: the full path is the safe one. The light
 * path goes back through `open-pr`, never through the gates and describe before it, so it is taken
 * only when `open-pr` ended `done` after the anchor, or the anchor's step is reachable only past
 * `open-pr` (ready, merge). Otherwise a gate the person has not ruled on yet (human-qa parked when
 * the base moved), or a PR body never written, would be skipped. `receipts` are the story unit's of
 * this round; order does not matter.
 */
export function lightAnchor(receipts: readonly NumberedReceipt[], wf: Workflow): string | null {
  let latest: NumberedReceipt | null = null;
  for (const nr of receipts) {
    const r = nr.receipt;
    const approve = r.kind === "approve" || (r.kind === "done" && r.outcome === "approve");
    if (approve && (!latest || nr.n > latest.n)) latest = nr;
  }
  const r = latest?.receipt;
  if (!latest || !r || (r.kind !== "approve" && r.kind !== "done") || !r.head_sha) return null;
  const anchorN = latest.n;
  const openedSince = receipts.some((nr) => nr.n > anchorN && isOpenPr(wf, nr.receipt.step) && "outcome" in nr.receipt && nr.receipt.outcome === "done");
  const pastOpenPr = wf.steps[r.step] !== undefined && !beforeOpenPr(wf).has(r.step);
  return openedSince || pastOpenPr ? r.head_sha : null;
}
