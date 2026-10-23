/**
 * Inbox read model (O1): what needs a person, grouped by action, built from Facts only.
 * Each item carries the question/reason, its age and the exact command that resolves it.
 */
import type { Mode, ResolvedConfig } from "@norn/schema";
import { nextCommand, startAgentCommand } from "./commands.ts";
import type { Facts, StoryFacts, UnitFacts } from "./facts.ts";
import type { InboxGroup, InboxItem } from "./ports.ts";
import { epoch, formatAge, iso } from "./time.ts";
import { stepOf } from "./workflow.ts";

export const INBOX_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "unclaimed", "running", "recently_done"];

export const INBOX_TITLES: Record<InboxGroup, string> = {
  your_turn: "Your turn",
  answer: "Answer",
  approve: "Approve",
  unblock: "Unblock",
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
      if (park?.kind === "gate")
        return item("approve", park.reason, `norn approve ${key}`, park.since, { detail: `or reject: norn approve ${key} --reject` });
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
      if (facts.now - epoch(st.updated_at) > RECENT_MS) return null;
      const waiting = uf.unit.slice === null && story.pr?.state !== "merged";
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
    for (const uf of story.units) add(unitInboxItem(story, uf, facts, config));
  }
  for (const g of INBOX_GROUPS) groups[g].sort((a, b) => epoch(a.since) - epoch(b.since) || a.id.localeCompare(b.id));
  const pending = INBOX_GROUPS.filter((g) => g !== "running" && g !== "recently_done").reduce((n, g) => n + groups[g].length, 0);
  return { at: iso(facts.now), groups, pending };
}

