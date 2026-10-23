/**
 * Inbox read model (O1): what needs a person, grouped by action, built from Facts only.
 * Each item carries the question/reason, its age and the exact command that resolves it.
 *
 * Groups (O1 order): Your turn (work only a person does: attended steps, manual starts, merging
 * the story PR — GR6, F25), Answer, Approve (gates), Unblock, Check (informational: something
 * changed outside norn — the PR head moved after the ready approval, commits norn did not make;
 * F35, Q6), Unclaimed, Running, Recently done.
 */
import type { InboxChange, Mode, ResolvedConfig, UnitState } from "@norn/schema";
import type { Decision } from "./actions.ts";
import { nextCommand, startAgentCommand } from "./commands.ts";
import type { Facts, StoryFacts, UnitFacts } from "./facts.ts";
import type { InboxGroup, InboxItem } from "./ports.ts";
import { epoch, formatAge, iso } from "./time.ts";
import { stepOf } from "./workflow.ts";

export const INBOX_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check", "unclaimed", "running", "recently_done"];

export const INBOX_TITLES: Record<InboxGroup, string> = {
  your_turn: "Your turn",
  answer: "Answer",
  approve: "Approve",
  unblock: "Unblock",
  check: "Check",
  unclaimed: "Unclaimed",
  running: "Running",
  recently_done: "Recently done",
};

export interface InboxEntry extends InboxItem {
  /** compact age, e.g. `12m` */
  age: string;
}

export interface Inbox {
  at: string;
  groups: Record<InboxGroup, InboxEntry[]>;
  /** items needing a person (everything except running and recently done) */
  pending: number;
}

/** How long a finished unit stays under "Recently done". */
export const RECENT_MS = 24 * 3_600_000;

/** MO2: manual if the step is attended or no runner is configured; else the story's mode. */
export function effectiveMode(story: Mode, attended: boolean, runner: string | null): { mode: Mode; downgraded: boolean } {
  if (attended) return { mode: "manual", downgraded: false };
  if (!runner) return { mode: "manual", downgraded: story === "auto" };
  return { mode: story, downgraded: false };
}

/**
 * C1 (decide `agent.*.surface`): a counted nudge norn could not type — manual effective mode, or
 * no session on this machine's runner. Shown until the agent shows activity again.
 */
function undeliveredNudge(story: StoryFacts, uf: UnitFacts, facts: Facts): { outcome: string; at: string } | null {
  const st = uf.state;
  const last = st?.last_outcome;
  if (!st?.run || !last || last.source !== "classified" || last.step !== st.step || st.nudges_used < 1) return null;
  if (!["silent", "timeout", "stalled"].includes(last.outcome)) return null;
  const step = uf.workflow ? stepOf(uf.workflow, st.step) : null;
  const { mode } = effectiveMode(story.mode, step?.type === "agent" && !!step.attended, facts.machine.runner);
  const session = st.run.session;
  if (session && mode === "auto" && session.runner === facts.machine.runner) return null;
  const activity = uf.run?.run_id === st.run.run_id ? (uf.run.last_activity_at ?? 0) : 0;
  if (activity > epoch(last.at)) return null;
  return { outcome: last.outcome, at: last.at };
}

/** The command a person runs to start the unit's step agent in its worktree. */
export function startCommandFor(uf: UnitFacts, story: StoryFacts, config: ResolvedConfig): string {
  const step = uf.workflow && uf.state ? stepOf(uf.workflow, uf.state.step) : null;
  const name = (step?.type === "agent" && step.agent) || config.default_agent;
  const agent = config.agents[name];
  const worktree = uf.worktree?.path ?? (uf.unit.slice === null ? (story.worktree?.path ?? null) : null);
  return startAgentCommand(worktree, agent?.command ?? agent?.adapter ?? name);
}

const short = (sha: string) => sha.slice(0, 7);
const prCli = (story: StoryFacts) => (story.frontmatter?.provider ?? story.key.slice(0, 2)) === "gl" ? "glab mr" : "gh pr";

/** Absolute path of a receipt file as observed (repo-relative to the unit's worktree, or absolute). */
function absFile(file: string, story: StoryFacts, uf: UnitFacts): string {
  if (file.startsWith("/")) return file;
  const wt = uf.worktree?.path ?? story.worktree?.path ?? "";
  return wt ? `${wt.replace(/\/+$/, "")}/${file}` : file;
}

/**
 * F21: what a gate judges — the report that led there (e.g. qa `partial`) and its evidence folder,
 * as absolute paths a person can open.
 */
function judgedDetail(story: StoryFacts, uf: UnitFacts): string | null {
  const nr = uf.last_outcome_receipt;
  if (!nr) return null;
  const r = nr.receipt;
  const file = absFile(nr.file, story, uf);
  const parts = [`${r.step}#${r.attempt} reported ${"outcome" in r ? r.outcome : r.kind}: ${file}`];
  if (r.kind === "done" && r.evidence) {
    const runsDir = file.replace(/\/receipts\/[^/]+$/, "");
    parts.push(`evidence: ${runsDir}/${r.evidence.replace(/\/+$/, "")}/`);
  }
  return parts.join(" · ");
}

/**
 * GR6/F25: the story unit finished its workflow and its PR is open — merging it is the person's
 * last action, so it is an item (Your turn) with the PR URL, not "Recently done".
 */
function mergeItem(story: StoryFacts, st: UnitState): InboxItem | null {
  const pr = story.pr;
  // GR6: a branch already contained in origin/<base> (merged by ancestry, e.g. a merge commit
  // pushed by hand) needs no merge, even while the PR still reads `open`.
  if (!pr || pr.state !== "open" || story.merged_by_ancestry || story.frontmatter?.status === "done") return null;
  const draft = pr.is_draft;
  const cli = prCli(story);
  return {
    id: `merge:${story.key}:${pr.number}`,
    group: "your_turn",
    story: story.key,
    slice: null,
    step: null,
    title: `Merge PR #${pr.number}${draft ? " (still a draft)" : ""}`,
    detail: draft ? `${pr.url} · draft: mark it ready first (${cli} ready ${pr.number})` : pr.url,
    command: `${cli} merge ${pr.number}`,
    since: st.updated_at,
    url: pr.url,
  };
}

/** Inbox item for one unit's current state, or null when nothing is shown for it. */
export function unitInboxItem(story: StoryFacts, uf: UnitFacts, facts: Facts, config: ResolvedConfig): InboxItem | null {
  const st = uf.state;
  const key = uf.unit.key;
  const base = { story: story.key, slice: uf.unit.slice, url: story.frontmatter?.url };
  if (uf.errors.length || st?.status === "corrupt") {
    const files = uf.errors.map((e) => e.file).join(", ") || "state.json";
    return { ...base, id: `corrupt:${key}:${files}`, group: "unblock", step: st?.step ?? null, title: `corrupt: ${files} failed validation (S2)`, command: `norn why ${key}`, since: iso(facts.now) };
  }
  if (!st) return null;
  const item = (group: InboxGroup, title: string, command: string, since: string, extra: Partial<InboxItem> = {}): InboxItem => ({
    ...base,
    id: extra.id ?? `${group}:${key}:${st.step}#${st.attempt}`,
    group,
    step: st.step,
    title,
    command,
    since,
    ...extra,
  });
  const park = st.park;
  switch (st.status) {
    case "parked":
      if (park?.kind === "ask")
        return item("answer", park.reason, nextCommand(key, st) as string, park.since, {
          ...(park.receipt_id ? { id: park.receipt_id } : {}),
          ...(park.command ? { detail: `pending command: ${park.command}` } : {}),
        });
      if (park?.kind === "gate") {
        const judged = judgedDetail(story, uf);
        const reject = `or reject: norn approve ${key} --reject --reason "…"`;
        return item("approve", park.reason, `norn approve ${key}`, park.since, { detail: judged ? `${judged} · ${reject}` : reject });
      }
      if (park?.kind === "attended") return item("your_turn", `${st.step}: attended step — work with the agent`, startCommandFor(uf, story, config), park.since);
      return item("unblock", park?.reason ?? "parked", `norn unstick ${key}`, park?.since ?? st.updated_at);
    case "stuck":
      return item("unblock", park?.reason ?? "stuck", `norn unstick ${key}`, park?.since ?? st.updated_at, park?.receipt_id ? { id: park.receipt_id } : {});
    case "running": {
      const nudge = undeliveredNudge(story, uf, facts);
      if (nudge) return item("your_turn", "agent ended its turn without reporting — reopen the agent and run norn brief", startCommandFor(uf, story, config), nudge.at, { id: `${nudge.outcome}:${key}:${st.step}#${st.attempt}:${st.nudges_used}` });
    }
      return item("running", `${st.step} #${st.attempt}${st.run ? ` (${st.run.how})` : ""}`, `norn trace ${key}`, st.run?.started_at ?? st.step_entered_at);
    case "ready": {
      const step = uf.workflow ? stepOf(uf.workflow, st.step) : null;
      if (step?.type === "agent") {
        const { mode, downgraded } = effectiveMode(story.mode, !!step.attended, facts.machine.runner);
        if (mode === "manual")
          return item("your_turn", `${st.step} is ready (manual): start an agent in the worktree`, startCommandFor(uf, story, config), st.step_entered_at, {
            ...(downgraded ? { detail: "auto requested, no runner; running manual (MO2)" } : {}),
          });
      }
      return item("running", `${st.step} #${st.attempt} (queued)`, `norn trace ${key}`, st.step_entered_at);
    }
    case "done": {
      if (uf.unit.slice === null) {
        const merge = mergeItem(story, st);
        if (merge) return merge;
      }
      if (facts.now - epoch(st.updated_at) > RECENT_MS) return null;
      // story.md says `done` once norn saw the merge (GR6) — the durable record when no PR was fetched
      const waiting = uf.unit.slice === null && story.pr?.state !== "merged" && !story.merged_by_ancestry && story.frontmatter?.status !== "done";
      return item("recently_done", waiting ? "workflow done — waiting for the PR merge (GR6)" : "done", `norn trace ${key}`, st.updated_at);
    }
  }
}

const isStarted = (s: StoryFacts) => s.units.some((u) => u.state !== null);

/** GR6: the story unit reached `$done`, or story.md says done/dropped — finished, never "unclaimed". */
export function storyFinished(story: StoryFacts): boolean {
  const status = story.frontmatter?.status;
  if (status === "done" || status === "dropped") return true;
  return story.units.find((u) => u.unit.slice === null)?.state?.status === "done";
}

/** GR8: the remote body changed after refine finished. */
export function bodyChangedItem(story: StoryFacts): InboxItem | null {
  const fm = story.frontmatter;
  if (!fm?.refined_body_hash || !fm.body_hash || fm.body_hash === fm.refined_body_hash) return null;
  return {
    id: `body:${story.key}:${fm.body_hash}`,
    group: "your_turn",
    story: story.key,
    slice: null,
    step: null,
    title: "issue body changed since refine",
    detail: "the spec body is never overwritten; fold the change into the spec if it matters",
    command: `norn status ${story.key}`,
    since: fm.intake_at,
    url: fm.url,
  };
}

/** F35: the PR head moved after the `ready.approve` — what would merge is not what was reviewed. */
export function headChangedItem(story: StoryFacts): InboxItem | null {
  const pr = story.pr;
  const ready = story.ready_head_sha;
  if (!pr || pr.state !== "open" || !ready || !pr.head_sha || pr.head_sha === ready) return null;
  const st = story.units.find((u) => u.unit.slice === null)?.state;
  return {
    id: `head:${story.key}:${pr.head_sha}`,
    group: "check",
    story: story.key,
    slice: null,
    step: null,
    title: `PR #${pr.number} head changed after ready approval (${short(ready)} → ${short(pr.head_sha)})`,
    detail: "what would merge is not the head the ready gate let through; look at the new commits before merging",
    command: `git log --stat ${ready}..${pr.head_sha}`,
    since: st?.updated_at ?? story.frontmatter?.intake_at ?? "1970-01-01T00:00:00.000Z",
    url: pr.url,
  };
}

/** Q6: commits norn did not make, one informational item per branch (newest commit in the id). */
export function foreignCommitItems(story: StoryFacts): InboxItem[] {
  const byBranch = new Map<string, NonNullable<StoryFacts["foreign_commits"]>>();
  for (const c of story.foreign_commits ?? []) byBranch.set(c.branch, [...(byBranch.get(c.branch) ?? []), c]);
  return [...byBranch].map(([branch, cs]) => {
    const newest = cs.reduce((a, b) => (epoch(b.at) > epoch(a.at) ? b : a));
    const oldest = cs.reduce((a, b) => (epoch(b.at) < epoch(a.at) ? b : a));
    const shown = cs.slice(0, 3).map((c) => `${short(c.sha)} ${c.subject} (${c.author})`);
    if (cs.length > 3) shown.push(`… ${cs.length - 3} more`);
    return {
      id: `foreign:${story.key}:${newest.sha}`,
      group: "check" as const,
      story: story.key,
      slice: null,
      step: null,
      title: `${cs.length} ${cs.length === 1 ? "commit" : "commits"} outside norn on ${branch}`,
      detail: shown.join(" · "),
      command: `git log --stat -n ${cs.length} ${newest.sha}`,
      since: oldest.at,
      ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
    };
  });
}

/** Build the whole inbox (O1). Stories held by another heartbeat are not shown. */
export function buildInbox(facts: Facts, config: ResolvedConfig): Inbox {
  const groups = Object.fromEntries(INBOX_GROUPS.map((g) => [g, [] as InboxEntry[]])) as Record<InboxGroup, InboxEntry[]>;
  const add = (it: InboxItem | null) => {
    if (it) groups[it.group].push({ ...it, age: formatAge(facts.now - epoch(it.since)) });
  };
  for (const story of facts.stories) {
    const claim = story.claim.state;
    if (claim === "other") continue;
    if ((claim === "none" || claim === "expired") && isStarted(story) && !storyFinished(story)) {
      const since = story.claim.state === "expired" ? story.claim.blob.expires_at : (story.frontmatter?.intake_at ?? iso(facts.now));
      add({
        id: `unclaimed:${story.key}`,
        group: "unclaimed",
        story: story.key,
        slice: null,
        step: null,
        title: `Unclaimed — ${story.frontmatter?.title ?? story.key}`,
        command: `norn take ${story.key}`,
        since,
        ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
      });
      continue;
    }
    if (story.frontmatter_error) {
      add({ id: `corrupt:${story.key}:story.md`, group: "unblock", story: story.key, slice: null, step: null, title: `corrupt: ${story.frontmatter_error.file} failed validation (S2)`, command: `norn why ${story.key}`, since: iso(facts.now) });
      continue;
    }
    add(bodyChangedItem(story));
    add(headChangedItem(story));
    for (const it of foreignCommitItems(story)) add(it);
    for (const uf of story.units) add(unitInboxItem(story, uf, facts, config));
  }
  for (const g of INBOX_GROUPS) groups[g].sort((a, b) => epoch(a.since) - epoch(b.since) || a.id.localeCompare(b.id));
  const pending = INBOX_GROUPS.filter((g) => g !== "running" && g !== "recently_done").reduce((n, g) => n + groups[g].length, 0);
  return { at: iso(facts.now), groups, pending };
}


// ---------------------------------------------------------------- history (O1, O4)

/** Groups whose items are tracked in the inbox history: the ones needing a person. */
export const HISTORY_GROUPS: readonly InboxGroup[] = INBOX_GROUPS.filter((g) => g !== "running" && g !== "recently_done");

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
