/**
 * `norn status [--json] [<story|unit>]` (§15, MO2): stories, slices, runs and recently done units
 * from @norn/view (X1). With a key: that story (or slice) only. Text for a person; `--json` for data.
 *
 * `--segment [--ttl 30s]`: one plain line for Herdr's tab bar (`tab_bar_right`, run in the focused
 * pane's cwd; outside a repository it prints an empty line). Inside Herdr it also writes a `norn`
 * sidebar token on each `<story> orient` workspace and moves those workspaces so the ones that need
 * you come first — presentation only, never a fact (HC13); a prototype choice, see AGENTS.md.
 */
import { parseDuration } from "@norn/schema";
import { formatStatus, type ProjectView } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { cockpitHerdr } from "../runtime/cockpit.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { projectView } from "../runtime/human.ts";
import { isOrientWorkspace, planWorkspaceMoves, segmentLine, storyToken } from "../runtime/segment.ts";

/** The orient workspaces' tokens and order; failures are ignored (presentation, HC13). */
async function presentOrientWorkspaces(ctx: Context, view: ProjectView, ttlMs: number): Promise<{ tokens: number; moves: number }> {
  const cockpit = cockpitHerdr(ctx);
  if (!cockpit) return { tokens: 0, moves: 0 };
  const workspaces = await cockpit.listWorkspaces().catch(() => []);
  const ours = new Map<string, string>();
  for (const s of view.stories) for (const w of workspaces) if (isOrientWorkspace(w, s.key, s.root)) ours.set(w.workspace_id, s.key);
  const needs = new Set<string>();
  let tokens = 0;
  for (const [id, story] of ours) {
    const token = storyToken(view, story);
    if (token.needs) needs.add(id);
    if (await cockpit.reportWorkspace(id, { norn: token.text }, ttlMs).then(() => true, () => false)) tokens++;
  }
  const moves = planWorkspaceMoves(
    workspaces.map((w) => w.workspace_id),
    [...ours.keys()],
    needs,
  );
  for (const m of moves) await cockpit.moveWorkspace(m.workspace_id, m.index).catch(() => null);
  return { tokens, moves: moves.length };
}

async function segment(ctx: Context, ttlRaw: string) {
  let ttl: number;
  try {
    ttl = parseDuration(ttlRaw);
  } catch {
    throw usageError(`bad --ttl '${ttlRaw}' (use e.g. 30s)`, "norn status --segment --ttl 30s");
  }
  try {
    await ctx.locate();
  } catch {
    return rendered({ segment: "", repo: null }, ""); // the focused pane is not in a repository
  }
  let view: ProjectView;
  try {
    view = await projectView(ctx);
  } catch (e) {
    const line = `norn ! ${(e as Error).message.split("\n")[0]}`;
    return rendered({ segment: line, repo: ctx.root }, line);
  }
  const line = segmentLine(view);
  const presented = await presentOrientWorkspaces(ctx, view, ttl);
  return rendered({ segment: line, repo: ctx.root, ...presented }, line);
}

export const statusCommand = defineCommand({
  name: "status",
  summary: "Stories, slices, runs and claims at a glance",
  usage: "norn status [--json] [<story|unit>] | norn status --segment [--ttl 30s]",
  markdown: true,
  options: { segment: { type: "boolean" }, ttl: { type: "string" } },
  positionals: { max: 1 },
  // located below: a tab bar segment runs in whatever cwd the focused pane has
  repo: false,
  async run(ctx, args) {
    if (opt.bool(args, "segment")) return segment(ctx, opt.str(args, "ttl") ?? "30s");
    await ctx.locate();
    const view = await projectView(ctx);
    const raw = args.positionals[0];
    if (!raw) return rendered(view, formatStatus(view));
    const key = parseUnitKey(raw);
    const story = view.stories.find((s) => s.key === key.story);
    if (!story) throw refuse(`unknown story ${key.story}`, "norn status", "unknown_unit");
    const slice = key.slice ? story.slices.find((s) => s.key === key.slice) : null;
    if (key.slice && !slice) throw refuse(`no slice ${key.slice} in story ${key.story}`, `norn status ${key.story}`, "unknown_unit");
    const units = new Set([story.key, ...story.slices.map((s) => s.key)]);
    const filtered: ProjectView = {
      ...view,
      stories: [slice ? { ...story, slices: [slice] } : story],
      runs: view.runs.filter((r) => units.has(r.unit) && (!slice || r.unit === slice.key)),
      recently_done: view.recently_done.filter((d) => units.has(d.unit)),
    };
    return rendered(slice ?? story, formatStatus(filtered));
  },
});
