/**
 * `norn story view <key>`: show one story: its units, runs, gates and asks, who moved its claim
 * between machines, and the branch updates a person made, read-only. A key no store holds is refused, naming where to look; a story with a
 * corrupt unit is a corrupt error (exit 4).
 */
import type { RuntimeEnv } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import { corruptError, failure, refuse, rendered } from "../output.ts";
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

interface PersonRecord {
  takeovers: TakeoverView[];
  branch_updates: BranchUpdateView[];
}

/** Every claim takeover and branch update on the story's own unit, oldest first; the facts carry only receipts not yet applied, so the record is read whole. */
async function recordOf(env: RuntimeEnv, key: string): Promise<PersonRecord> {
  const read = await env.journal.readUnit(key);
  if (!read.ok) throw failure(`cannot read ${key}: ${read.failure.message}`, "try again", read.failure.code);
  const out: PersonRecord = { takeovers: [], branch_updates: [] };
  for (const r of read.value.receipts) {
    const d = r.data;
    if (d.kind === "claim.taken") out.takeovers.push({ at: r.at, from: d.from ?? null, to: d.to, by: d.by, reason: d.reason ?? null });
    if (d.kind === "branch.updated")
      out.branch_updates.push({ at: r.at, base: d.base, base_sha: d.base_sha, merged: d.merged, head: d.head, pushed: d.pushed, by: d.by, reason: d.reason ?? null });
  }
  return out;
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

function markdown(s: StoryView, { takeovers, branch_updates }: PersonRecord): string {
  const out = [`# ${storyHead(s)}`, ""];
  if (s.url) out.push(`Item: ${s.url}`);
  if (s.change?.url) out.push(`Change: ${s.change.url}`);
  if (s.url || s.change?.url) out.push("");
  out.push("## Units", "", ...s.units.map((u) => `- ${unitLine(u)}${u.pending_receipts ? ` (${u.pending_receipts} receipts not applied yet)` : ""}`));
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
    const key = args.positionals[0] as string;
    const env = await ctx.runtimeEnv();
    const view = await loadProjectView(env);
    const story = view.stories.find((s) => s.key === key);
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
    const record = await recordOf(env, key);
    return rendered({ ...story, ...record, problems: view.problems.filter((p) => p.startsWith(`${key}:`) || p.startsWith(`${key} `)) }, markdown(story, record));
  },
});
