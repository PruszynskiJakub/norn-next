/**
 * `norn status [--json] [--details] [--notes] [--history [--since <iso|duration>]]` (B9, B10, O1):
 * what needs a person, grouped by action — Your turn, Answer, Approve, Unblock, Check, Unclaimed,
 * Running, Notes, Recently done — each item with its reason, age and the exact command that resolves
 * it. Read only via @norn/view (X1); text for a person, `--json` for data. `--details` adds each item's
 * full text (L1: an implicit ask's whole pane screen). Notes show as one summary line; `--notes` lists
 * them (NT6). The JSON always carries every item. `--history` lists every item that needed a person,
 * with appeared_at / resolved_at / resolved_by, paired from the inbox changes each tick records (O4).
 * The story table this command printed before is `norn story list` (B15); the first `status` on a
 * checkout says so once on stderr (B13).
 *
 * `--segment [--ttl 30s]` (B14, only in `help --all`): one plain line for Herdr's tab bar
 * (`tab_bar_right`, run in the focused pane's cwd; outside a repository it prints an empty line).
 * Inside Herdr it also writes a `norn` sidebar token on each `<story> orient` workspace and moves
 * those workspaces so the ones that need you come first — presentation only, never a fact (HC13);
 * a prototype choice, see AGENTS.md.
 */
import { parseDuration } from "@norn/schema";
import { firstNotice, type InboxHistoryItem, inboxHistory } from "@norn/store";
import { formatInbox, type ProjectView, stepTitle } from "@norn/view";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered, usageError } from "../output.ts";
import { cockpitHerdr } from "../runtime/cockpit.ts";
import { projectView } from "../runtime/human.ts";
import { isOrientWorkspace, planWorkspaceMoves, segmentLine, storyToken } from "../runtime/segment.ts";
import { cmd } from "@norn/core";

/** B13: told once per checkout, to a person (never under `--json`). */
const MOVED_NOTICE = "`norn status` now shows what needs you; the story listing moved to `norn story list`.";

function sinceOf(raw: string | undefined, now: number): string | undefined {
  if (raw === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  try {
    return new Date(now - parseDuration(raw)).toISOString();
  } catch {
    throw usageError(`--since must be an ISO time or a duration like 2h or 3d, not '${raw}'`, cmd.inbox({ since: "1d" }));
  }
}

function formatHistory(items: readonly InboxHistoryItem[]): string {
  if (!items.length) return "No inbox history.\n";
  const lines = items.map((i) => {
    const unit = i.slice ?? i.story;
    const when = `${i.appeared_at ?? "?"} → ${i.resolved_at ?? "open"}`;
    const by = i.resolved_by ? ` (${i.resolved_by})` : "";
    return `${when}  ${unit.padEnd(10)} ${i.group.padEnd(9)} ${stepTitle(i.step, i.title)}${by}${i.url ? `\n      ${i.url}` : ""}`;
  });
  return `${lines.join("\n")}\n`;
}

async function inbox(ctx: Context, args: ParsedArgs) {
  if (opt.bool(args, "history")) {
    const since = sinceOf(opt.str(args, "since"), ctx.clock.now());
    const items = inboxHistory(ctx.root, since);
    return rendered({ ...(since ? { since } : {}), items, open: items.filter((i) => i.resolved_at === null).length }, formatHistory(items));
  }
  if (opt.str(args, "since") !== undefined) throw usageError("--since goes with --history", cmd.inbox({ since: "1d" }));
  const view = await projectView(ctx);
  const details = opt.bool(args, "details");
  const text = formatInbox(view, { details, notes: opt.bool(args, "notes"), home: ctx.env.HOME });
  if (details) return rendered(view.inbox, text);
  // L1 (A7): an item's full text (an implicit ask's pane screen) only with --details
  const groups = Object.fromEntries(Object.entries(view.inbox.groups).map(([g, items]) => [g, items.map(({ full: _full, ...it }) => it)]));
  return rendered({ ...view.inbox, groups }, text);
}

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
  summary: "What needs you, grouped by action, with the command to resolve each item; --history for when items came and went (O1)",
  usage: "norn status [--json] [--details] [--notes] [--history [--since <iso|duration>]]",
  markdown: true,
  options: { details: { type: "boolean" }, notes: { type: "boolean" }, history: { type: "boolean" }, since: { type: "string" }, segment: { type: "boolean" }, ttl: { type: "string" } },
  // located below: a tab bar segment runs in whatever cwd the focused pane has
  repo: false,
  async run(ctx, args) {
    if (opt.bool(args, "segment")) return segment(ctx, opt.str(args, "ttl") ?? "30s");
    await ctx.locate();
    const out = await inbox(ctx, args);
    if (!args.json && firstNotice(ctx.root, "status-is-the-inbox")) ctx.stderr.push(MOVED_NOTICE);
    return out;
  },
});
