/**
 * `norn story view [<story|slice>]` (B16, D6): one story at a glance for a person and the agent that
 * sits with them (`norn story chat`) — what the story is, each slice with its workflow and step, the
 * PR and its state, open notes by unit, what waits for the person (exact commands) and where to look.
 * Built on the orient report, which it extends. Pure: a ProjectView in, a report out; read only (X1).
 */
import { cmd, formatAge, type InboxGroup } from "@norn/core";
import type { RemoteProvider, StoryStatus } from "@norn/schema";
import { inboxItemsInOrder } from "./format.ts";
import type { ClaimView, PrView, ProjectView, SliceView, StoryView, UnitView } from "./types.ts";

/** Inbox groups that wait for the person (O1), in order. */
const WAITING: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check", "unclaimed"];

export interface OrientUnit {
  key: string;
  title: string;
  status: UnitView["status"];
  /** the unit's workflow (pinned, else the one it would start with) */
  workflow: string;
  step: string | null;
  attempt: number | null;
  last_outcome: { step: string; outcome: string; at: string } | null;
  /** next command for a person or agent (S9) */
  next: string | null;
  /** slices only: integrated into the story branch */
  integrated: boolean;
  /** slices only: frontmatter status and the slices it waits for */
  slice_status?: SliceView["slice_status"];
  depends_on?: string[];
}

export interface OrientItem {
  group: InboxGroup;
  unit: string;
  step: string | null;
  title: string;
  command: string;
  age: string;
  url?: string;
}

export interface OrientNote {
  id: string;
  step: string;
  text: string;
  criterion?: string;
  at: string;
  /** shows the report the note came from */
  command: string;
}

export interface OrientReport {
  /** the key asked for (story or slice) */
  key: string;
  story: string;
  title: string;
  url: string | null;
  story_status: StoryStatus | null;
  claim: string;
  mode: string;
  /** the story unit */
  unit: OrientUnit;
  slices: OrientUnit[];
  /** story worktree (or checkout) the spec was read from */
  root: string;
  spec: string;
  branch: string;
  pr: PrView | null;
  /** the PR's state in one word; null when no PR was seen */
  pr_state: "draft" | "open" | "closed" | "merged" | null;
  /** `gh pr view <branch>` / `glab mr view <branch>` */
  pr_command: string;
  waiting: OrientItem[];
  running: OrientItem[];
  /** open notes grouped by unit, the unit with the newest note first */
  notes: Array<{ unit: string; notes: OrientNote[] }>;
  note_count: number;
  look: { spec: string; trace: string; why: string; status: string };
}

/** The provider CLI that shows the story PR (`--web` opens it in the browser). */
export function prCommand(provider: RemoteProvider, branch: string, web = false): string {
  const base = provider === "glab" ? `glab mr view ${branch}` : `gh pr view ${branch}`;
  return web ? `${base} --web` : base;
}

function claimLine(c: ClaimView): string {
  if (c.state === "mine") return "held here";
  if (c.state === "other") return `held by ${c.holder}`;
  if (c.state === "expired") return `unclaimed (expired ${c.holder})`;
  return c.state === "corrupt" ? "claim corrupt" : "unclaimed";
}

const orientUnit = (u: UnitView): OrientUnit => ({ key: u.key, title: u.title, status: u.status, workflow: u.workflow, step: u.step, attempt: u.attempt, last_outcome: u.last_outcome, next: u.next, integrated: false });
const orientSlice = (s: SliceView): OrientUnit => ({ ...orientUnit(s), integrated: s.integrated, slice_status: s.slice_status, depends_on: s.depends_on });

function prState(pr: PrView | null): OrientReport["pr_state"] {
  if (!pr) return null;
  return pr.state === "open" && pr.is_draft ? "draft" : pr.state;
}

/** Report for the story of `key` (a story or slice key); null when the view has no such story. */
export function orientReport(view: ProjectView, key: string, provider: RemoteProvider): OrientReport | null {
  const storyKey = key.split("/")[0] as string;
  const story: StoryView | undefined = view.stories.find((s) => s.key === storyKey);
  if (!story) return null;
  const items = inboxItemsInOrder(view).filter((i) => i.story === storyKey);
  const toItem = (i: (typeof items)[number]): OrientItem => ({
    group: i.group,
    unit: i.slice ?? i.story,
    step: i.step,
    title: i.title,
    command: i.command,
    age: i.age,
    ...(i.url ? { url: i.url } : {}),
  });
  const byUnit = new Map<string, OrientNote[]>();
  for (const n of story.notes) {
    const list = byUnit.get(n.unit) ?? [];
    list.push({ id: n.id, step: n.step, text: n.text, ...(n.criterion ? { criterion: n.criterion } : {}), at: n.at, command: cmd.runView(n.unit, { receipt: n.receipt_id }) });
    byUnit.set(n.unit, list);
  }
  const newest = (ns: OrientNote[]) => Math.max(...ns.map((n) => Date.parse(n.at)));
  const notes = [...byUnit.entries()].map(([unit, ns]) => ({ unit, notes: ns })).sort((a, b) => newest(b.notes) - newest(a.notes) || a.unit.localeCompare(b.unit));
  const spec = `${story.root.replace(/\/+$/, "")}/${story.spec_dir}`;
  const focus = key === storyKey ? storyKey : key;
  return {
    key,
    story: storyKey,
    title: story.title,
    url: story.url,
    story_status: story.story_status,
    claim: claimLine(story.claim),
    mode: story.mode_downgraded ? `${story.mode}→${story.effective_mode}` : story.effective_mode,
    unit: orientUnit(story),
    slices: story.slices.map(orientSlice),
    root: story.root,
    spec,
    branch: story.branch,
    pr: story.pr,
    pr_state: prState(story.pr),
    pr_command: prCommand(provider, story.branch),
    waiting: items.filter((i) => WAITING.includes(i.group)).map(toItem),
    running: items.filter((i) => i.group === "running").map(toItem),
    notes,
    note_count: story.notes.length,
    look: { spec, trace: cmd.runList(focus), why: cmd.runView(focus, { why: true }), status: cmd.storyView(focus) },
  };
}

/** One line for a unit: where it stands and how its last step ended. */
function unitStanding(u: OrientUnit): string {
  if (u.status === "not_started") return "not started";
  const where = u.status === "done" ? "done" : `${u.status}${u.step ? ` at ${u.step}` : ""}`;
  const last = u.last_outcome ? ` (last: ${u.last_outcome.step} → ${u.last_outcome.outcome})` : "";
  return `${where}${u.integrated ? ", integrated" : ""}${last}`;
}

/** One line for the PR, e.g. `#2 draft, open — https://…`. */
function prLine(pr: PrView | null): string {
  if (!pr) return "none seen yet";
  return `#${pr.number} ${pr.is_draft && pr.state === "open" ? "draft, open" : pr.state} — ${pr.url}`;
}

const GROUP_WORD: Record<InboxGroup, string> = {
  your_turn: "Your turn",
  answer: "Answer",
  approve: "Approve",
  unblock: "Unblock",
  check: "Check",
  unclaimed: "Unclaimed",
  running: "Running",
  notes: "Note",
  recently_done: "Done",
};

const indent = (text: string, pad: string) => text.trim().split("\n").join(`\n${pad}`);

/**
 * The agent's part of the orient workspace: summarize, then answer; act only when told. It never
 * reports an outcome (`done`/`ask`/`stuck`): an orient session is no run (B3).
 */
const ORIENT_RULES = [
  "You sit with the person to help them get oriented on this story. Follow these rules:",
  "1. Open with a summary of at most 5 lines: what the story is, where it stands, and what waits for the person, with its command. Count the open notes; do not list them yet.",
  "2. Then answer their questions. Read the spec, the code and the commands below as needed.",
  "3. Run a norn command that changes anything (`norn story approve`, `norn story answer`, `norn story checkout`, `norn run rerun`, …) only when the person tells you to.",
  "4. Never edit code, commit, or report an outcome: no `norn done`, `norn ask` or `norn stuck` — this session is not a run.",
  "5. When the person asks about the notes, group and dedupe them by topic: spec readings to confirm, polish, follow-ups, FYI.",
].join("\n");

/** A slice's line after its title: where it stands, the slices it waits for, its workflow. */
function sliceLine(s: OrientUnit): string {
  const deps = s.depends_on?.length ? ` · after ${s.depends_on.map((d) => d.split("/").at(-1)).join(",")}` : "";
  const next = s.next && s.status !== "running" ? `\n  - \`${s.next}\`` : "";
  return `- ${s.key} ${s.title} — ${unitStanding(s)}${deps} · ${s.workflow}${next}`;
}

/**
 * Markdown for `norn story view`; `rules` puts the chat agent's rules first (`norn story chat`
 * starts its agent on this view, B29).
 */
export function formatStoryView(r: OrientReport, now: number, o: { rules?: boolean } = {}): string {
  const out: string[] = [`# ${r.story} — ${r.title}`, ""];
  if (o.rules) out.push(...ORIENT_RULES.split("\n").map((l) => `> ${l}`), "");
  out.push("## The story", "");
  if (r.url) out.push(`- Issue: ${r.url}`);
  out.push(`- Story: ${unitStanding(r.unit)} · ${r.unit.workflow} · ${r.mode} · ${r.claim}`);
  out.push(`- Worktree: \`${r.root}\` · branch \`${r.branch}\``);
  out.push(`- Spec: \`${r.spec}\``, "");
  out.push("## Slices", "");
  if (r.slices.length === 0) out.push("No slices yet.");
  for (const s of r.slices) out.push(sliceLine(s));
  out.push("", "## Pull request", "");
  const seen = r.pr ? ` (seen ${formatAge(now - Date.parse(r.pr.seen_at))} ago)` : "";
  out.push(`- ${prLine(r.pr)}${seen}`, `- Look: \`${r.pr_command}\`; open it in the browser: \`${cmd.storyView(r.story, { web: true })}\``, "");
  out.push("## Waits for the person", "");
  if (r.waiting.length === 0) out.push("Nothing waits for the person.");
  for (const w of r.waiting) {
    out.push(`- **${GROUP_WORD[w.group]}** ${w.unit}${w.step ? ` (${w.step})` : ""}, ${w.age}: ${w.title}`);
    out.push(`  - \`${w.command}\``);
    if (w.group === "approve") out.push(`  - reject: \`${cmd.storyReject(w.unit)}\``);
  }
  if (r.running.length) {
    out.push("", "## Running", "");
    for (const w of r.running) out.push(`- ${w.unit}${w.step ? ` (${w.step})` : ""}, ${w.age}: ${w.title}`);
  }
  out.push("", `## Open notes (${r.note_count})`, "");
  if (r.note_count === 0) out.push("No open notes.");
  else out.push("Agents left these for the person; they need no action. When asked, summarize them by topic (spec readings to confirm, polish, follow-ups, FYI), not one by one.", "");
  for (const g of r.notes) {
    out.push(`### ${g.unit} (${g.notes.length})`, "");
    for (const n of g.notes) out.push(`- [${n.step}${n.criterion ? ` · ${n.criterion}` : ""}] ${indent(n.text, "  ")}`);
    out.push("");
  }
  if (r.note_count) out.pop();
  out.push("", "## Where to look", "");
  out.push(`- Spec folder: \`${r.look.spec}\``, `- Every step and who acted: \`${r.look.trace}\``, `- Why norn did what it did: \`${r.look.why}\``, `- Status: \`${r.look.status}\``);
  return `${out.join("\n")}\n`;
}
