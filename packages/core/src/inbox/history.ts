/**
 * Inbox history (O1, O4): the open/resolved lifecycle of the items that need a person, diffed
 * tick to tick and recorded in the tick trace.
 */
import type { InboxChange } from "@norn/schema";
import type { Decision } from "../actions.ts";
import type { Facts } from "../facts.ts";
import type { InboxGroup, InboxItem } from "../ports.ts";
import { iso } from "../time.ts";
import { type Inbox, INBOX_GROUPS } from "./items.ts";

/** Groups whose items are tracked in the inbox history: the ones needing a person, and notes (NT2). */
const HISTORY_GROUPS: readonly InboxGroup[] = INBOX_GROUPS.filter((g) => g !== "running" && g !== "recently_done");

/** What resolved an item: the last receipt applied to its unit this tick, else the rule that acted on it. */
function resolvedBy(item: InboxItem, facts: Facts, decisions: readonly Decision[], nowIso: string): { by: string; at: string } {
  const unit = item.slice ?? item.story;
  const mine = decisions.filter((d) => d.unit === unit || (item.slice === null && d.unit === item.story));
  for (const d of mine) {
    const a = d.action;
    if (a.kind !== "apply_receipts") continue;
    const uf = facts.stories.find((s) => s.key === item.story)?.units.find((u) => u.unit.key === unit);
    const applied = (uf?.unapplied ?? []).filter((r) => a.applied.includes(r.n));
    const last = applied.findLast((r) => r.receipt.kind !== "started" && r.receipt.kind !== "mode") ?? applied.at(-1);
    if (last) {
      const r = last.receipt;
      const outcome = "outcome" in r ? ` ${r.outcome}` : "";
      return { by: `${r.kind}${outcome} by ${r.who ?? r.by} (${last.file.split("/").at(-1)})`, at: r.at };
    }
  }
  const acted = mine.find((d) => d.action.kind !== "noop" && d.rule !== "claim.renew");
  return acted ? { by: `tick: ${acted.rule}`, at: nowIso } : { by: "no longer pending", at: nowIso };
}

/**
 * Inbox lifecycle of one tick (O1 history): diff the items needing a person after act against the
 * ones open before. Pure: `open` is what the previous tick left open; returns the changes to record
 * in the tick trace and the new open set. `facts` are the facts decide saw (their unapplied receipts
 * name who resolved an item); `inbox` is built from the post-act facts.
 */
export function inboxChanges(
  open: Readonly<Record<string, InboxItem>>,
  inbox: Inbox,
  facts: Facts,
  decisions: readonly Decision[],
): { changes: InboxChange[]; open: Record<string, InboxItem> } {
  const nowIso = iso(facts.now);
  const next: Record<string, InboxItem> = {};
  for (const g of HISTORY_GROUPS) for (const { age: _age, ...it } of inbox.groups[g]) next[it.id] = it;
  const changes: InboxChange[] = [];
  const base = (it: InboxItem) => ({
    id: it.id,
    group: it.group,
    story: it.story,
    slice: it.slice,
    step: it.step,
    title: it.title,
    command: it.command,
    ...(it.detail ? { detail: it.detail } : {}),
    ...(it.url ? { url: it.url } : {}),
  });
  for (const [id, it] of Object.entries(open)) {
    if (next[id]) continue;
    const r = resolvedBy(it, facts, decisions, nowIso);
    changes.push({ event: "resolved", ...base(it), at: r.at, resolved_by: r.by });
  }
  for (const [id, it] of Object.entries(next)) if (!open[id]) changes.push({ event: "appeared", ...base(it), at: it.since });
  return { changes, open: next };
}
