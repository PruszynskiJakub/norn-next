/**
 * The cockpit model (SPEC-cockpit CP1–CP5): rows — what needs the person, then every story — each with
 * its story's orient preview and the actions it offers, as data. Pure: a ProjectView in, plain JSON
 * out. Renderers (the terminal `norn cockpit`, a web panel later) map actions to keys or buttons and
 * run their effects; they never decide which actions fit a row (CP4). Writes stay CLI verbs (X1).
 */
import type { InboxGroup, InboxItem } from "@norn/core";
import type { RemoteProvider } from "@norn/schema";
import { inboxItemsInOrder } from "./format.ts";
import { type OrientReport, orientReport } from "./orient.ts";
import type { HeartbeatView, InboxEntry, ProjectView, StoryView } from "./types.ts";
import { cmd } from "@norn/core";

/** CP2: inbox groups that are rows, in O1 order; running, notes and recently done live in the preview. */
const COCKPIT_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check"];

export type CockpitActionId = "orient" | "agent" | "start" | "answer" | "approve" | "reject" | "unstick" | "take" | "trace" | "pr" | "issue";

/** CP4: what an action does. `{input}` in argv is the text the person typed. */
export type CockpitEffect =
  | { kind: "verb"; argv: string[]; show?: boolean }
  | { kind: "link"; url: string }
  | { kind: "place"; place: "agent" | "orient"; story: string; reach?: InboxItem["reach"] };

export interface CockpitAction {
  id: CockpitActionId;
  label: string;
  /** default key: a single letter, or `enter` */
  key: string;
  input?: { prompt: string; required: boolean };
  effect: CockpitEffect;
}

export interface CockpitRow {
  /** the inbox item id, or `story:<key>`; stable across rebuilds */
  id: string;
  kind: "item" | "story";
  group: InboxGroup | null;
  story: string;
  unit: string;
  step: string | null;
  title: string;
  since: string | null;
  age: string | null;
  /** CP3: the story's orient report, and the item for an item row */
  preview: { report: OrientReport; item: { title: string; detail?: string; full?: string; command: string } | null };
  actions: CockpitAction[];
}

export interface CockpitModel {
  at: string;
  /** `pending`: how many rows the needs-you section holds */
  header: { repo: string; pending: number; heartbeat: HeartbeatView };
  rows: CockpitRow[];
}

export interface CockpitOptions {
  /** CP1: the front end can focus an agent's pane and open an orient workspace (the terminal inside Herdr) */
  places: boolean;
  /** shown in the preview's PR command (`config.remote.provider`) */
  provider: RemoteProvider;
}

const ACTION: Record<CockpitActionId, { label: string; key: string }> = {
  orient: { label: "orient", key: "enter" },
  agent: { label: "agent", key: "g" },
  start: { label: "start", key: "s" },
  answer: { label: "answer", key: "a" },
  approve: { label: "approve", key: "y" },
  reject: { label: "reject", key: "x" },
  unstick: { label: "unstick", key: "u" },
  take: { label: "take", key: "t" },
  trace: { label: "trace", key: "v" },
  pr: { label: "PR", key: "o" },
  issue: { label: "issue", key: "i" },
};

const action = (id: CockpitActionId, effect: CockpitEffect, input?: CockpitAction["input"]): CockpitAction => ({ id, ...ACTION[id], ...(input ? { input } : {}), effect });

/** Actions on every row of a story: orient, trace, its PR and issue links; take on the story's own row. */
function storyActions(s: StoryView, unit: string, o: CockpitOptions, own: boolean): CockpitAction[] {
  const out = [o.places ? action("orient", { kind: "place", place: "orient", story: s.key }) : action("orient", { kind: "verb", argv: ["story", "view", s.key], show: true })];
  out.push(action("trace", { kind: "verb", argv: ["run", "list", unit], show: true }));
  if (own && s.claim.unclaimed) out.push(action("take", { kind: "verb", argv: ["story", "checkout", s.key] }));
  if (s.pr) out.push(action("pr", { kind: "link", url: s.pr.url }));
  if (s.url) out.push(action("issue", { kind: "link", url: s.url }));
  return out;
}

/** CP4: the actions an inbox item offers, by the table. */
function itemActions(i: InboxEntry, unit: string, o: CockpitOptions): CockpitAction[] {
  const out: CockpitAction[] = [];
  if (o.places && i.reach) out.push(action("agent", { kind: "place", place: "agent", story: i.story, reach: i.reach }));
  // MO5: a manual start the runner opens itself
  if (i.group === "your_turn" && !i.reach && i.command.startsWith(`${cmd.storyStart()} `)) out.push(action("start", { kind: "verb", argv: ["story", "start", unit] }));
  if (i.group === "answer") out.push(action("answer", { kind: "verb", argv: ["story", "answer", unit, "{input}"] }, { prompt: "Your answer", required: true }));
  if (i.group === "approve") {
    out.push(action("approve", { kind: "verb", argv: ["story", "approve", unit] }));
    out.push(action("reject", { kind: "verb", argv: ["story", "reject", unit, "--reason", "{input}"] }, { prompt: "What to change", required: true }));
  }
  if (i.command.startsWith(`${cmd.runRerun()} `)) out.push(action("unstick", { kind: "verb", argv: ["run", "rerun", unit] }));
  return out;
}

export function cockpitModel(view: ProjectView, o: CockpitOptions): CockpitModel {
  const reports = new Map<string, OrientReport>();
  const report = (story: string) => {
    let r = reports.get(story);
    if (!r) {
      r = orientReport(view, story, o.provider) as OrientReport;
      reports.set(story, r);
    }
    return r;
  };
  const stories = new Map(view.stories.map((s) => [s.key, s]));
  const items: CockpitRow[] = inboxItemsInOrder(view)
    .filter((i) => COCKPIT_GROUPS.includes(i.group) && stories.has(i.story))
    .map((i) => {
      const unit = i.slice ?? i.story;
      const s = stories.get(i.story) as StoryView;
      const [orient, ...rest] = storyActions(s, unit, o, false);
      return {
        id: i.id,
        kind: "item" as const,
        group: i.group,
        story: i.story,
        unit,
        step: i.step,
        title: i.title,
        since: i.since,
        age: i.age,
        preview: { report: report(i.story), item: { title: i.title, ...(i.detail ? { detail: i.detail } : {}), ...(i.full ? { full: i.full } : {}), command: i.command } },
        actions: [orient as CockpitAction, ...itemActions(i, unit, o), ...rest],
      };
    });
  const storyRows: CockpitRow[] = view.stories.map((s) => ({
    id: `story:${s.key}`,
    kind: "story" as const,
    group: null,
    story: s.key,
    unit: s.key,
    step: s.step,
    title: s.title,
    since: s.since,
    age: s.age,
    preview: { report: report(s.key), item: null },
    actions: storyActions(s, s.key, o, true),
  }));
  // the header counts the rows that need you, so it matches what is listed under them
  return { at: view.at, header: { repo: view.repo, pending: items.length, heartbeat: view.heartbeat }, rows: [...items, ...storyRows] };
}

/** Fill `{input}` in a verb's argv. */
export const withInput = (argv: readonly string[], input: string): string[] => argv.map((a) => (a === "{input}" ? input : a));
