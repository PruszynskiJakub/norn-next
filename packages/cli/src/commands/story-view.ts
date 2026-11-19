/**
 * `norn story view <key>`: show one story (a slice's key shows the story it belongs to): the round
 * it is in, its units with their worktrees, runs, gates and asks, who moved its claim between machines, the branch updates a person made, and for a unit waiting at a gate the criteria
 * its last report left unsettled and the notes for a person not yet acknowledged, read-only. A key no store holds is refused, naming where to look; a story with a
 * corrupt unit is a corrupt error (exit 4).
 */
import { parseUnitId } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import type { CriterionVerdict } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { corruptError, failure, refuse, rendered } from "../output.ts";
import { noteLine, type OpenNote, openNotesOf } from "../notes.ts";
import { loadProjectView, type StoryView, storyHead, unitLine } from "../views.ts";

/** One `norn story take` on the record of the story's own unit. */
export interface TakeoverView {
  at: string;
  /** null: nobody held the claim */
  from: string | null;
  to: string;
  by: string;
  reason: string | null;
}

/** One `norn story update-branch` on the record of the story's own unit. */
export interface BranchUpdateView {
  at: string;
  base: string;
  base_sha: string;
  merged: boolean;
  head: string;
  pushed: boolean;
  by: string;
  reason: string | null;
}

/** The criteria a unit's last report did not pass, for the person deciding the gate it waits at. */
export interface CriteriaToCheck {
  unit: string;
  step: string | null;
  attempt: number | null;
  at: string;
  /** every verdict but `pass`, with its repro, reason or how to check it */
  verdicts: CriterionVerdict[];
}

interface PersonRecord {
  /** the rounds the story's record started, the first included: the round it is in */
  round: number;
  takeovers: TakeoverView[];
  branch_updates: BranchUpdateView[];
  criteria: CriteriaToCheck[];
  notes: OpenNote[];
}

/** Every claim takeover and branch update on the story's own unit, oldest first, and what each unit at a gate leaves to check; the facts carry only receipts not yet applied, so the record is read whole. */
async function recordOf(env: RuntimeEnv, key: string, story: StoryView): Promise<PersonRecord> {
  const read = await env.journal.readUnit(key);
  if (!read.ok) throw failure(`cannot read ${key}: ${read.failure.message}`, "try again", read.failure.code);
  const out: PersonRecord = { round: 0, takeovers: [], branch_updates: [], criteria: [], notes: [] };
  for (const r of read.value.receipts) {
    const d = r.data;
    if (d.kind === "round.started") out.round++;
    if (d.kind === "claim.taken") out.takeovers.push({ at: r.at, from: d.from ?? null, to: d.to, by: d.by, reason: d.reason ?? null });
    if (d.kind === "branch.updated")
      out.branch_updates.push({ at: r.at, base: d.base, base_sha: d.base_sha, merged: d.merged, head: d.head, pushed: d.pushed, by: d.by, reason: d.reason ?? null });
  }
  for (const u of story.units) {
    if (u.waiting?.for !== "gate") continue;
    const receipts = u.id === key ? read.value.receipts : await receiptsOf(env, u.id);
    const left = unsettled(u.id, receipts);
    if (left) out.criteria.push(left);
    out.notes.push(...openNotesOf(u.id, receipts));
  }
  // a record with no round.started is in its first round
  out.round = Math.max(out.round, 1);
  return out;
}

/** Where a unit's worktree is, while it is on disk: where a person looks into its work. */
async function worktreeOf(env: RuntimeEnv, unit: string): Promise<string | null> {
  const vcs = env.slots.vcs;
  if (!vcs.capabilities.worktrees) return null;
  const path = vcs.worktree.path(unit);
  const cut = path.lastIndexOf("/");
  return (await env.ctx.files.list(path.slice(0, cut))).includes(path.slice(cut + 1)) ? path : null;
}

async function receiptsOf(env: RuntimeEnv, unit: string) {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) throw failure(`cannot read ${unit}: ${read.failure.message}`, "try again", read.failure.code);
  return read.value.receipts;
}

/**
 * The unit's newest criteria report, when no gate was decided since and it left a verdict short of
 * `pass`: what the gate's person checks. A report a gate already ruled on was settled there.
 */
function unsettled(unit: string, receipts: Awaited<ReturnType<typeof receiptsOf>>): CriteriaToCheck | null {
  for (let i = receipts.length - 1; i >= 0; i--) {
    const r = receipts[i] as (typeof receipts)[number];
    const d = r.data;
    if (d.kind === "gate.decided") return null;
    if (d.kind !== "run.reported" || !d.criteria) continue;
    const verdicts = d.criteria.filter((c) => c.verdict !== "pass");
    return verdicts.length ? { unit, step: d.step ?? null, attempt: d.attempt ?? null, at: r.at, verdicts } : null;
  }
  return null;
}

function verdictLine(c: CriterionVerdict): string {
  const said = [c.repro, c.reason && `(${c.reason})`, c.how && `how to check: ${c.how}`, c.evidence && `evidence: ${c.evidence}`].filter(Boolean).join("; ");
  return `  - \`${c.id}\` ${c.verdict}${said ? `: ${said}` : ""}`;
}

function criteriaLines(c: CriteriaToCheck): string[] {
  const from = `${c.step ?? "a step"}${c.attempt ? ` #${c.attempt}` : ""}`;
  return [`- ${c.unit}, reported by ${from} at ${c.at}:`, ...c.verdicts.map(verdictLine)];
}

function updateLine(u: BranchUpdateView): string {
  const what = u.merged ? `merged ${u.base} (${u.base_sha.slice(0, 12)})` : `already held ${u.base}`;
  return `- ${u.at}: ${what}, now at ${u.head.slice(0, 12)}${u.pushed ? ", pushed" : ""}, by ${u.by}${u.reason ? ` — ${u.reason}` : ""}`;
}

function takeoverLine(t: TakeoverView): string {
  const from = t.from ? ` from ${t.from}` : "";
  const by = t.by === t.to ? "" : ` by ${t.by}`;
  return `- ${t.at}: taken${from} to ${t.to}${by}${t.reason ? ` — ${t.reason}` : ""}`;
}

type ShownUnit = StoryView["units"][number] & { worktree: string | null };

function markdown(s: Omit<StoryView, "units"> & { units: ShownUnit[] }, { round, takeovers, branch_updates, criteria, notes }: PersonRecord): string {
  const out = [`# ${storyHead(s)}`, ""];
  if (s.url) out.push(`Item: ${s.url}`);
  if (s.change?.url) out.push(`Change: ${s.change.url}${s.change.merge_sha ? ` (merged as ${s.change.merge_sha.slice(0, 12)})` : ""}`);
  const workflow = s.units.find((u) => u.id === s.key)?.workflow;
  if (round > 1) out.push(`Round ${round}${workflow ? `, of ${workflow}` : ""}.`);
  if (s.url || s.change?.url || round > 1) out.push("");
  out.push(
    "## Units",
    "",
    ...s.units.flatMap((u) => [`- ${unitLine(u)}${u.pending_receipts ? ` (${u.pending_receipts} receipts not applied yet)` : ""}`, ...(u.worktree ? [`  - worktree: ${u.worktree}`] : [])]),
  );
  if (criteria.length) out.push("", "## Criteria to check", "", ...criteria.flatMap(criteriaLines));
  if (notes.length) out.push("", "## Notes for you", "", "Left by the agents' reports; an approve at the gate acknowledges them.", "", ...notes.map(noteLine));
  if (takeovers.length) out.push("", "## Claim taken", "", ...takeovers.map(takeoverLine));
  if (branch_updates.length) out.push("", "## Branch updated", "", ...branch_updates.map(updateLine));
  return out.join("\n");
}

export const storyViewCommand = defineCommand({
  name: "story view",
  summary: "Show one story: its units, runs, gates and asks",
  usage: "norn story view <key>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const asked = args.positionals[0] as string;
    // a slice is shown within its story, where its order and the gates between slices are read
    const slice = parseUnitId(asked)?.slice != null ? asked : null;
    const key = slice ? (parseUnitId(asked)?.story as string) : asked;
    const env = await ctx.runtimeEnv();
    const view = await loadProjectView(env);
    const story = view.stories.find((s) => s.key === key);
    if (story && slice && !story.units.some((u) => u.id === slice)) throw refuse(`${key} has no slice ${slice}`, `norn story view ${key}`, "story_not_found", { key: slice });
    if (!story) {
      const queued = view.intake.find((i) => i.key === key);
      throw queued
        ? refuse(`${key} is in the intake but no tick has taken it yet`, "norn tick", "story_not_started", { key })
        : refuse(`no story ${key}`, "norn story list", "story_not_found", { key });
    }
    const corrupt = story.units.filter((u) => u.corrupt !== undefined);
    // a record that fails validation is shown as what it is, never as a story at some step
    if (corrupt.length > 0)
      throw corruptError(
        `${key} is corrupt: ${corrupt.map((u) => `${u.id}: ${u.corrupt}`).join("; ")}`,
        "a person restores or removes the unit's run state; norn never repairs it",
        { story },
      );
    const record = await recordOf(env, key, story);
    const shown = { ...story, units: await Promise.all(story.units.map(async (u) => ({ ...u, worktree: await worktreeOf(env, u.id) }))) };
    return rendered({ ...shown, ...record, problems: view.problems.filter((p) => p.startsWith(`${key}:`) || p.startsWith(`${key} `)) }, markdown(shown, record));
  },
});
