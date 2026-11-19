/**
 * The cockpit model: rows (what needs the person, then each other story once in its tab, then the
 * intake no tick has taken yet), each with the actions it offers as data. Pure: a ProjectView in,
 * plain JSON out. The terminal renderer maps actions to keys and runs their effects; it never decides
 * which actions fit a row. Every write is a norn command, the one a person would type.
 */
import type { OpenNote } from "../notes.ts";
import type { ProjectView, StoryView, UnitView } from "../views.ts";
import { type CockpitGroup, finished, groupOf, NEEDS } from "./groups.ts";

export type CockpitActionId = "view" | "agent" | "start" | "answer" | "approve" | "reject" | "unstick" | "take" | "pr" | "issue";

/** What an action does. `{input}` in argv is the text the person typed. */
export type CockpitEffect = { kind: "verb"; argv: string[]; show?: boolean } | { kind: "link"; url: string } | { kind: "attach"; unit: string };

export interface CockpitAction {
  id: CockpitActionId;
  label: string;
  /** a single letter, or `enter` */
  key: string;
  input?: { prompt: string; required: boolean };
  effect: CockpitEffect;
}

/** Where a row is listed: now (needs you, in flight), backlog (intake not taken in yet), done (finished). */
export type CockpitTab = "now" | "backlog" | "done";

export interface CockpitRow {
  /** `unit:<id>`, `story:<key>` or `intake:<key>`; stable across refreshes */
  id: string;
  kind: "item" | "story" | "intake";
  tab: CockpitTab;
  /** an item's: what it needs from the person */
  group: CockpitGroup | null;
  story: string;
  unit: string;
  step: string | null;
  title: string;
  /** an item's question, prompt or reason, and the command that resolves it */
  text: string | null;
  command: string | null;
  /** when its run started, for the oldest first */
  since: string | null;
  actions: CockpitAction[];
}

export interface CockpitModel {
  /** `pending`: how many rows need the person */
  header: { repo: string; pending: number; problems: string[] };
  rows: CockpitRow[];
  /** every story by key, for the preview */
  stories: Record<string, StoryView>;
  notes: OpenNote[];
  /** intake's links, for the preview of an intake row */
  intake: Record<string, { title: string; url: string | null }>;
}

export interface CockpitOptions {
  repo: string;
  /** whether a run's pane can be brought in front, by the executor that runs it */
  places: (executor: string) => boolean;
  notes?: readonly OpenNote[];
}

const ACTION: Record<CockpitActionId, { label: string; key: string }> = {
  view: { label: "view", key: "enter" },
  agent: { label: "agent", key: "g" },
  start: { label: "start", key: "s" },
  answer: { label: "answer", key: "a" },
  approve: { label: "approve", key: "y" },
  reject: { label: "reject", key: "x" },
  unstick: { label: "rerun", key: "u" },
  take: { label: "take", key: "t" },
  pr: { label: "PR", key: "o" },
  issue: { label: "issue", key: "i" },
};

const action = (id: CockpitActionId, effect: CockpitEffect, input?: CockpitAction["input"]): CockpitAction => ({ id, ...ACTION[id], ...(input ? { input } : {}), effect });

/** The actions every row of a story offers: its view, its run's pane, a take, its PR and item links. */
function storyActions(s: StoryView, holder: string, o: CockpitOptions, unit: UnitView | null): CockpitAction[] {
  const out = [action("view", { kind: "verb", argv: ["story", "view", s.key], show: true })];
  const live = unit?.run ? unit : s.units.find((u) => u.run && u.ended === undefined);
  if (live?.run && o.places(live.run.executor)) out.push(action("agent", { kind: "attach", unit: live.id }));
  // a claim nobody holds is this machine's at its next tick: only another holder's is worth a take
  if (!finished(s) && s.claim !== null && s.claim.holder !== holder && s.unsynced === undefined) out.push(action("take", { kind: "verb", argv: ["story", "take", s.key] }));
  if (s.change?.url) out.push(action("pr", { kind: "link", url: s.change.url }));
  if (s.url) out.push(action("issue", { kind: "link", url: s.url }));
  return out;
}

/** The actions what a unit waits for offers, each the command its `next` names. */
function itemActions(u: UnitView, group: CockpitGroup): CockpitAction[] {
  const next = u.waiting?.next ?? "";
  if (group === "your_turn" && next.startsWith(`norn run start ${u.id}`)) return [action("start", { kind: "verb", argv: ["run", "start", u.id] })];
  if (group === "answer")
    return [
      action("answer", { kind: "verb", argv: ["story", "answer", u.id, "{input}"] }, { prompt: u.waiting?.for === "permission" ? "Option (1 allows, no refuses)" : "Your answer", required: true }),
    ];
  if (group === "approve")
    return [action("approve", { kind: "verb", argv: ["story", "approve", u.id] }), action("reject", { kind: "verb", argv: ["story", "reject", u.id, "--reason", "{input}"] }, { prompt: "What to change", required: true })];
  if (next.includes(`norn run rerun ${u.id}`)) return [action("unstick", { kind: "verb", argv: ["run", "rerun", u.id] })];
  return [];
}

const byKey = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function cockpitModel(view: ProjectView, o: CockpitOptions): CockpitModel {
  const items: CockpitRow[] = [];
  for (const s of view.stories) {
    // a diverged store holds the whole story until a person carries it on
    if (s.unsynced?.waiting) {
      const take = s.unsynced.next.startsWith("norn story take ") ? [action("take", { kind: "verb", argv: s.unsynced.next.split(" ").slice(1) })] : [];
      const [shown, ...rest] = storyActions(s, view.holder, o, null);
      items.push(row(s, null, "unblock", [shown as CockpitAction, ...take, ...rest.filter((a) => a.id !== "take")], { text: `run data unsynced: ${s.unsynced.text}`, command: s.unsynced.next }));
      continue;
    }
    for (const u of s.units) {
      const g = groupOf(u);
      if (!g || g === "running") continue;
      const [shown, ...rest] = storyActions(s, view.holder, o, u);
      items.push(row(s, u, g, [shown as CockpitAction, ...itemActions(u, g), ...rest], { text: u.waiting?.text ?? "an attended step: its agent works where you work beside it", command: u.waiting?.next ?? null }));
    }
  }
  items.sort((a, b) => NEEDS.indexOf(a.group as CockpitGroup) - NEEDS.indexOf(b.group as CockpitGroup) || (a.since ?? "").localeCompare(b.since ?? "") || byKey(a.unit, b.unit));
  const waiting = new Set(items.map((r) => r.story));
  const stories = view.stories
    .filter((s) => !waiting.has(s.key) && !(finished(s) && s.open === false))
    .map((s): CockpitRow => ({ ...row(s, null, null, storyActions(s, view.holder, o, null), { text: null, command: null }), tab: finished(s) ? "done" : "now" }))
    .sort((a, b) => (a.tab === b.tab ? (a.tab === "done" ? byKey(b.unit, a.unit) : byKey(a.unit, b.unit)) : a.tab === "now" ? -1 : 1));
  const intake = view.intake.map(
    (i): CockpitRow => ({
      id: `intake:${i.key}`,
      kind: "intake",
      tab: "backlog",
      group: null,
      story: i.key,
      unit: i.key,
      step: null,
      title: i.title,
      text: null,
      command: null,
      since: null,
      actions: i.url ? [action("issue", { kind: "link", url: i.url })] : [],
    }),
  );
  return {
    header: { repo: o.repo, pending: items.length, problems: [...view.problems] },
    rows: [...items, ...stories, ...intake],
    stories: Object.fromEntries(view.stories.map((s) => [s.key, s])),
    notes: [...(o.notes ?? [])],
    intake: Object.fromEntries(view.intake.map((i) => [i.key, { title: i.title, url: i.url }])),
  };
}

function row(s: StoryView, u: UnitView | null, group: CockpitGroup | null, actions: CockpitAction[], what: { text: string | null; command: string | null }): CockpitRow {
  const unit = u?.id ?? s.key;
  const own = u ?? s.units.find((x) => x.id === s.key) ?? null;
  return {
    id: group ? `unit:${unit}` : `story:${s.key}`,
    kind: group ? "item" : "story",
    tab: "now",
    group,
    story: s.key,
    unit,
    step: own?.step ?? null,
    title: s.title ?? s.key,
    ...what,
    since: u?.run?.started_at ?? null,
    actions,
  };
}

/** Fill `{input}` in a verb's argv. */
export const withInput = (argv: readonly string[], input: string): string[] => argv.map((a) => (a === "{input}" ? input : a));
