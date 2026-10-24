/**
 * Inbox history (O1, O4): each tick diffs the items needing a person after act against the ones
 * open before and records the changes in its trace record (`inbox`); `norn inbox --history` pairs
 * them. The open set lives machine-locally in the gitignored trace dir (`inbox.json`), like
 * `notified.json`; when it is missing every current item appears again (harmless for pairing).
 */
import { join } from "node:path";
import { buildInbox, type Decision, type Facts, type InboxItem, inboxChanges } from "@norn/core";
import { type InboxChange, type ResolvedConfig, type TickTrace } from "@norn/schema";
import { atomicWriteJson, readText, readTrace, traceDir } from "@norn/store";

const openPath = (root: string) => join(traceDir(root), "inbox.json");

function readOpen(root: string): Record<string, InboxItem> {
  try {
    return (JSON.parse(readText(openPath(root)) ?? "{}") as { open?: Record<string, InboxItem> }).open ?? {};
  } catch {
    return {};
  }
}

/** This tick's inbox changes; `commit()` persists the new open set once the trace record is written. */
export function trackInbox(root: string, post: Facts, pre: Facts, decisions: readonly Decision[], config: ResolvedConfig): { changes: InboxChange[]; commit: () => void } {
  const r = inboxChanges(readOpen(root), buildInbox(post, config), pre, decisions);
  return { changes: r.changes, commit: () => atomicWriteJson(openPath(root), { open: r.open }) };
}

export interface InboxHistoryItem {
  id: string;
  group: string;
  story: string;
  slice: string | null;
  step: string | null;
  title: string;
  command: string | null;
  url: string | null;
  /** null when it appeared before the window read */
  appeared_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** Pair appeared/resolved changes from the tick trace, oldest first; still open items have resolved_at null. */
export function inboxHistory(root: string, since?: string): InboxHistoryItem[] {
  const { events } = readTrace(root, { types: ["tick"], ...(since ? { since } : {}) });
  const out: InboxHistoryItem[] = [];
  const open = new Map<string, InboxHistoryItem>();
  for (const ev of events as TickTrace[])
    for (const c of ev.inbox ?? []) {
      const cur = open.get(c.id);
      if (c.event === "appeared") {
        if (cur) continue;
        const item: InboxHistoryItem = {
          id: c.id,
          group: c.group,
          story: c.story,
          slice: c.slice,
          step: c.step,
          title: c.title,
          command: c.command ?? null,
          url: c.url ?? null,
          appeared_at: c.at,
          resolved_at: null,
          resolved_by: null,
        };
        open.set(c.id, item);
        out.push(item);
        continue;
      }
      const item = cur ?? { id: c.id, group: c.group, story: c.story, slice: c.slice, step: c.step, title: c.title, command: c.command ?? null, url: c.url ?? null, appeared_at: null, resolved_at: null, resolved_by: null };
      if (!cur) out.push(item);
      item.resolved_at = c.at;
      item.resolved_by = c.resolved_by ?? null;
      open.delete(c.id);
    }
  return out;
}
