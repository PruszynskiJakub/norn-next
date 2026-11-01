/**
 * PROTOTYPE (throwaway): variant T — the cockpit in three tabs, `1 Now` (what needs you and what is in
 * flight), `2 Backlog` (not started), `3 Done`. Every tab is variant 0+ with all its fixes on, over that
 * tab's stories; the person's verdict so far: backlog visited now and then, done rarely, Now all day.
 */
import { initialState } from "/Users/jakubpruszynski/Projects/norn/packages/cli/src/runtime/cockpit-tui.ts";
import { type CockpitModel, type CockpitRow, type Key, type Look, paint, phaseOf, type Variant, visible } from "../shared.ts";
import { frame as fixedFrame, handle as fixedHandle, type S as Fixed } from "./d.ts";

type Tab = "now" | "backlog" | "done";
const TABS: Array<{ id: Tab; key: string; label: string }> = [
  { id: "now", key: "1", label: "Now" },
  { id: "backlog", key: "2", label: "Backlog" },
  { id: "done", key: "3", label: "Done" },
];
interface S { tab: Tab; per: Record<Tab, Fixed> }

/** The rows a tab holds: a story that needs you is Now whatever its phase. */
function tabModel(model: CockpitModel, tab: Tab): CockpitModel {
  const waiting = new Set(model.rows.filter((r) => r.kind === "item").map((r) => r.story));
  const where = (r: CockpitRow): Tab => (r.kind === "item" || waiting.has(r.story) ? "now" : phaseOf(r) === "done" ? "done" : phaseOf(r) === "backlog" ? "backlog" : "now");
  const rows = model.rows.filter((r) => where(r) === tab);
  // Done: newest first (no closed_at in the model yet, so by issue number)
  if (tab === "done") rows.sort((a, b) => Number(b.story.slice(3)) - Number(a.story.slice(3)));
  return { ...model, rows };
}
/** Items count once each; a story counts only when it is not already behind an item. */
function count(model: CockpitModel, tab: Tab): number {
  const rows = tabModel(model, tab).rows;
  const waiting = new Set(rows.filter((r) => r.kind === "item").map((r) => r.story));
  return rows.filter((r) => r.kind === "item" || !waiting.has(r.story)).length;
}

const fixed = (tab: Tab): Fixed => ({ tui: initialState(), fixes: new Set([1, 2, 3, 4, 5, 6]), showDone: tab === "done", locked: true });

function strip(model: CockpitModel, s: S, width: number): string {
  const items = model.rows.filter((r) => r.kind === "item").length;
  const tabs = TABS.map((t) => {
    const n = count(model, t.id);
    const label = ` ${t.key} ${t.label} ${t.id === "now" && items ? `${items} need you · ${n - items} in flight` : n} `;
    return t.id === s.tab ? paint(label, ["inverse", "bold"]) : paint(label, ["dim"]);
  }).join(paint("│", ["dim"]));
  return `${tabs}${paint("─".repeat(Math.max(0, width - visible(tabs))), ["dim"])}`;
}

export const variant: Variant<S> = {
  key: "T",
  name: "tabs",
  init: () => ({ tab: "now", per: { now: fixed("now"), backlog: fixed("backlog"), done: fixed("done") } }),
  handle(s, key: Key, model, look: Look) {
    const typing = s.per[s.tab].tui.filtering || s.per[s.tab].tui.prompt;
    const tab = key.kind === "char" && !typing ? TABS.find((t) => t.key === key.char) : undefined;
    if (tab) return { state: { ...s, tab: tab.id } };
    const { state, effect } = fixedHandle(s.per[s.tab], key, tabModel(model, s.tab), look);
    return { state: { ...s, per: { ...s.per, [s.tab]: state } }, ...(effect ? { effect } : {}) };
  },
  frame(model, s, look) {
    const lines = fixedFrame(tabModel(model, s.tab), s.per[s.tab], look).split("\n");
    // the header keeps the whole repo's count; the rule under it becomes the tab strip
    const t = s.per[s.tab].tui;
    if (!t.filtering && !t.filter) lines[0] = fixedFrame(model, s.per.now, { ...look, height: 3 }).split("\n")[0] as string;
    lines[1] = strip(model, s, look.width);
    return lines.join("\n");
  },
};

