/**
 * `norn status [--json] [--details] [--notes] [--history [--since <iso|duration>]]`:
 * what needs a person, grouped by action — Your turn, Answer, Approve, Unblock, Check, Unclaimed,
 * Running, Notes, Recently done — each item with its reason, age and the exact command that resolves
 * it. Read only via @norn/view; text for a person, `--json` for data. `--details` adds each item's
 * full text (an implicit ask's whole pane screen). Notes show as one summary line; `--notes` lists
 * them. The JSON always carries every item. `--history` lists every item that needed a person,
 * with appeared_at / resolved_at / resolved_by, paired from the inbox changes each tick records.
 * The first `status` on a checkout says once on stderr that the story table is `norn story list`.
 *
 * `--watch [--interval 5s] [--pane]`: the live cockpit full screen (`runtime/status-watch.ts`);
 * `--pane` runs it in a Herdr pane split below the caller; `--watch --json` prints the cockpit model.
 *
 * `--segment [--ttl 30s]` (only in `help --all`): one plain line for Herdr's tab bar
 * (`tab_bar_right`, run in the focused pane's cwd; outside a repository it prints an empty line).
 * Inside Herdr it also writes a `norn` sidebar token on each `<story> orient` workspace and moves
 * those workspaces so the ones that need you come first — presentation only, never a fact.
 */
import { parseDuration } from "@norn/schema";
import { firstNotice, type InboxHistoryItem, inboxHistory } from "@norn/store";
import { delegatedCounts, formatDelegatedCounts, formatInbox, type ProjectView, stepTitle } from "@norn/view";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered, usageError } from "../output.ts";
import { cockpitHerdr } from "../runtime/cockpit.ts";
import { projectView } from "../runtime/human.ts";
import { statusWatch } from "../runtime/status-watch.ts";
import { isOrientWorkspace, planWorkspaceMoves, segmentLine, storyToken } from "../runtime/segment.ts";
import { cmd } from "@norn/core";

/** Told once per checkout, to a person (never under `--json`). */
const MOVED_NOTICE = "`norn status` now shows what needs you; the story listing moved to `norn story list`.";

function sinceOf(raw: string | undefined, now: number): string | undefined {
  if (raw === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  try {
    return new Date(now - parseDuration(raw)).toISOString();
  } catch {
    throw usageError(`--since must be an ISO time or a duration like 2h or 3d, not '${raw}'`, cmd.status({ since: "1d" }));
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
  if (opt.str(args, "since") !== undefined) throw usageError("--since goes with --history", cmd.status({ since: "1d" }));
  const view = await projectView(ctx);
  const details = opt.bool(args, "details");
  // A count per story of what a supervisor decided on the person's behalf: never an inbox item, apart from story view's `delegated` decisions
  const delegated_counts = delegatedCounts(view);
  const text = `${formatInbox(view, { details, notes: opt.bool(args, "notes"), home: ctx.env.HOME })}${formatDelegatedCounts(delegated_counts)}`;
  // The heartbeat as data, so a supervisor sees a missing watch before anything is in auto
  const heartbeat = view.heartbeat;
  if (details) return rendered({ ...view.inbox, delegated_counts, heartbeat }, text);
  // An item's full text (an implicit ask's pane screen) only with --details
  const groups = Object.fromEntries(Object.entries(view.inbox.groups).map(([g, items]) => [g, items.map(({ full: _full, ...it }) => it)]));
  return rendered({ ...view.inbox, groups, delegated_counts, heartbeat }, text);
}

/** The orient workspaces' tokens and order; failures are ignored (presentation only). */
async function presentOrientWorkspaces(ctx: Context, view: ProjectView, ttlMs: number): Promise<{ tokens: number; moves: number }> {
  const cockpit = cockpitHerdr(ctx);
  if (!cockpit) return { tokens: 0, moves: 0 };
  const workspaces = await cockpit.listWorkspaces().catch(() => []);
  const ours = new Map<string, string>();
  for (const s of view.stories) for (const w of workspaces) if (isOrientWorkspace(w, s.key, s.root)) ours.set(w.workspace_id, s.key);
  const needs = new Set<string>();
  // each workspace's token is its own: reported side by side; the moves below go one by one, in order
  const reported = await Promise.all(
    [...ours].map(([id, story]) => {
      const token = storyToken(view, story);
      if (token.needs) needs.add(id);
      return cockpit.reportWorkspace(id, { norn: token.text }, ttlMs).then(() => true, () => false);
    }),
  );
  const tokens = reported.filter(Boolean).length;
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
    // the line and the tokens read only the inbox and the story statuses
    view = await projectView(ctx, { inboxOnly: true });
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
  version: "reads",
  summary: "What needs you, grouped by action, with the command to resolve each item; --history for when items came and went",
  usage: "norn status [--json] [--details] [--notes] [--history [--since <iso|duration>]] | norn status --watch [--interval 5s] [--pane]",
  markdown: true,
  optionHelp: {
    "--details": "each item's full text",
    "--notes": "list the open notes, not one summary line",
    "--history [--since <iso|duration>]": "every item that needed you, with when it came and went",
    "--watch": "the live cockpit full screen: act on items by key, q or Esc quits",
    "--interval <duration>": "with --watch: how often it refreshes (default 5s)",
    "--pane": "with --watch: run it in a Herdr pane split below this one",
  },
  options: {
    details: { type: "boolean" },
    notes: { type: "boolean" },
    history: { type: "boolean" },
    since: { type: "string" },
    segment: { type: "boolean" },
    ttl: { type: "string" },
    watch: { type: "boolean" },
    interval: { type: "string" },
    pane: { type: "boolean" },
  },
  // located below: a tab bar segment runs in whatever cwd the focused pane has
  repo: false,
  async run(ctx, args) {
    if (opt.bool(args, "segment")) return segment(ctx, opt.str(args, "ttl") ?? "30s");
    if (opt.bool(args, "watch")) return statusWatch(ctx, args);
    const stray = (["interval", "pane"] as const).find((o) => args.values[o] !== undefined);
    if (stray) throw usageError(`--${stray} needs --watch`, cmd.statusWatch());
    await ctx.locate();
    const out = await inbox(ctx, args);
    if (!args.json && firstNotice(ctx.root, "status-is-the-inbox")) ctx.stderr.push(MOVED_NOTICE);
    return out;
  },
});
