/**
 * `norn inbox [--text]` (O1): what needs a person, grouped by action — Your turn, Answer,
 * Approve, Unblock, Check, Unclaimed, Running, Recently done — each item with its reason, age and
 * the exact command that resolves it. Read only via @norn/view (X1); JSON unless `--text`.
 * `--details` adds each item's full text (L1: an implicit ask's whole pane screen).
 *
 * `norn inbox --history [--since <iso|duration>]` (O1, O4): every item that needed a person, with
 * appeared_at / resolved_at / resolved_by, paired from the inbox changes each tick records.
 */
import { parseDuration } from "@norn/schema";
import { formatInbox } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { textOutput, usageError } from "../output.ts";
import { projectView } from "../runtime/human.ts";
import { type InboxHistoryItem, inboxHistory } from "../runtime/inbox-history.ts";

function sinceOf(raw: string | undefined, now: number): string | undefined {
  if (raw === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  try {
    return new Date(now - parseDuration(raw)).toISOString();
  } catch {
    throw usageError(`--since must be an ISO time or a duration like 2h or 3d, not '${raw}'`, "norn inbox --history --since 1d");
  }
}

function formatHistory(items: readonly InboxHistoryItem[]): string {
  if (!items.length) return "No inbox history.\n";
  const lines = items.map((i) => {
    const unit = i.slice ?? i.story;
    const when = `${i.appeared_at ?? "?"} → ${i.resolved_at ?? "open"}`;
    const by = i.resolved_by ? ` (${i.resolved_by})` : "";
    return `${when}  ${unit.padEnd(10)} ${i.group.padEnd(9)} ${i.step ? `${i.step}: ` : ""}${i.title}${by}${i.url ? `\n      ${i.url}` : ""}`;
  });
  return `${lines.join("\n")}\n`;
}

export const inboxCommand = defineCommand({
  name: "inbox",
  summary: "What needs you, grouped by action, with the command to resolve each item; --history for when items came and went (O1)",
  usage: "norn inbox [--text] [--details] [--history [--since <iso|duration>]]",
  options: { text: { type: "boolean" }, details: { type: "boolean" }, history: { type: "boolean" }, since: { type: "string" } },
  async run(ctx, args) {
    if (opt.bool(args, "history")) {
      const since = sinceOf(opt.str(args, "since"), ctx.clock.now());
      const items = inboxHistory(ctx.root, since);
      if (opt.bool(args, "text")) return textOutput(formatHistory(items));
      return { ...(since ? { since } : {}), items, open: items.filter((i) => i.resolved_at === null).length };
    }
    if (opt.str(args, "since") !== undefined) throw usageError("--since goes with --history", "norn inbox --history --since 1d");
    const view = await projectView(ctx);
    const details = opt.bool(args, "details");
    if (opt.bool(args, "text")) return textOutput(formatInbox(view, { details, home: ctx.env.HOME }));
    if (details) return view.inbox;
    // L1 (A7): an item's full text (an implicit ask's pane screen) only with --details
    const groups = Object.fromEntries(Object.entries(view.inbox.groups).map(([g, items]) => [g, items.map(({ full: _full, ...it }) => it)]));
    return { ...view.inbox, groups };
  },
});
