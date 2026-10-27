/**
 * Inbox read model (O1): what needs a person, grouped by action, built from Facts only.
 * Each item carries the question/reason, its age and the exact command that resolves it.
 *
 * Groups (O1 order): Your turn (work only a person does: attended steps, manual starts, merging
 * the story PR — GR6, F25), Answer, Approve (gates), Unblock, Check (informational: something
 * changed outside norn — the PR head moved after the ready approval, commits norn did not make;
 * F35, Q6), Unclaimed, Running, Notes (agents' notes for a person, NT2: information, not an
 * action), Recently done.
 */
import { type InboxChange, parseDuration, type ResolvedConfig, type UnitState, type Workflow } from "@norn/schema";
import type { Decision } from "./actions.ts";
import { nextCommand, startAgentCommand } from "./commands.ts";
import { criterionLine, noteTitle, personCriteria, type StoryNote } from "./criteria.ts";
import type { Facts, NumberedReceipt, StoryFacts, UnitFacts } from "./facts.ts";
import type { InboxGroup, InboxItem } from "./ports.ts";
import { sha256 } from "./hash.ts";
import { effectiveMode, firstLine, heartbeatUp, prBaseBranch, sessionStartedNoTurn, storyFinished, storyUnit, unitWorktree } from "./policy.ts";
import { optionsLine } from "./prompt.ts";
import { epoch, formatAge, iso } from "./time.ts";
import { baseUpdateStep, edgeOf, edgesOf, isStale, stepOf } from "./workflow.ts";

export const INBOX_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check", "unclaimed", "running", "notes", "recently_done"];

export const INBOX_TITLES: Record<InboxGroup, string> = {
  your_turn: "Your turn",
  answer: "Answer",
  approve: "Approve",
  unblock: "Unblock",
  check: "Check",
  unclaimed: "Unclaimed",
  running: "Running",
  notes: "Notes",
  recently_done: "Recently done",
};

/** What each group holds, in a few words — shown next to its title (inbox, cockpit). */
export const INBOX_ABOUT: Record<InboxGroup, string> = {
  your_turn: "work only you can do",
  answer: "agents waiting for your answer",
  approve: "gates waiting for your decision",
  unblock: "stuck or broken, needs you to unstick it",
  check: "changed outside norn, worth a look",
  unclaimed: "stories no checkout holds",
  running: "agents and checks at work",
  notes: "agents' notes for you, no action needed",
  recently_done: "finished in the last 24h",
};

export interface InboxEntry extends InboxItem {
  /** compact age, e.g. `12m` */
  age: string;
}

export interface Inbox {
  at: string;
  groups: Record<InboxGroup, InboxEntry[]>;
  /** items needing a person (everything except running, notes and recently done) */
  pending: number;
}

/** How long a finished unit stays under "Recently done". */
export const RECENT_MS = 24 * 3_600_000;

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

/**
 * R5.5 (N3, A8): this checkout's heartbeat is down — its last tick is older than 3 × watch interval
 * (or no tick ever ran) while a story it holds has a unit in auto mode. Null when it is up, when
 * nothing here needs it, or when the heartbeat was not observed.
 */
export function heartbeatDown(facts: Facts, config: ResolvedConfig): { holder: string; since: string | null; for_ms: number | null } | null {
  const hb = facts.heartbeat;
  if (!hb || heartbeatUp(facts, config)) return null;
  const auto = (s: StoryFacts) => effectiveMode(s.mode, false, facts.machine.runner).mode === "auto";
  const live = (u: UnitFacts) => !!u.state && u.state.status !== "done" && u.state.status !== "corrupt";
  const needs = facts.stories.some((s) => s.claim.state === "mine" && auto(s) && !storyFinished(s) && s.units.some(live));
  if (!needs) return null;
  return { holder: facts.machine.holder, since: hb.last_tick_at === null ? null : iso(hb.last_tick_at), for_ms: hb.last_tick_at === null ? null : facts.now - hb.last_tick_at };
}

/** R5.5: the Unblock item for a heartbeat that is down. */
export function heartbeatItem(facts: Facts, config: ResolvedConfig): InboxItem | null {
  const down = heartbeatDown(facts, config);
  if (!down) return null;
  const story = facts.stories.find((s) => s.claim.state === "mine");
  return {
    id: `heartbeat:${down.holder}:${down.since ?? "never"}`,
    group: "unblock",
    story: story?.key ?? "*",
    slice: null,
    step: null,
    title: down.for_ms === null ? `no heartbeat on ${down.holder} yet — run \`norn watch\`` : `no heartbeat on ${down.holder} for ${formatAge(down.for_ms)} — run \`norn watch\``,
    detail: "auto steps start, and agents are classified, only while a heartbeat runs on the checkout that holds the story",
    command: "norn watch",
    since: down.since ?? iso(facts.now),
  };
}

/**
 * R4.3: an action's effect failed for the unit (a nudge or answer not delivered, a launch or resume
 * that failed, a push refused) — an Unblock item until an effect of the same kind succeeds, the
 * cursor moves, or (for deliveries) the agent shows activity again. R6.3 reuses it for prompts.
 */
export function actFailureItem(story: StoryFacts, uf: UnitFacts): InboxItem | null {
  const f = uf.act_failure;
  const st = uf.state;
  // H1: a refused commit is owed even by a finished unit (its `$done` state is not on record yet)
  if (!f || !st || (st.status === "done" && f.effect !== "commit") || st.status === "corrupt" || f.step !== st.step || f.attempt !== st.attempt) return null;
  // R6.3: an answer that did not reach its prompt is told on the Answer item itself (answerItem)
  if (f.effect === "answer" && st.status === "parked" && st.park?.kind === "ask") return null;
  // a refused push or commit (H1) stays until the effect succeeds or the cursor moves
  const delivery = f.effect !== "push" && f.effect !== "commit";
  if (delivery && (uf.run?.last_activity_at ?? 0) > epoch(f.at)) return null;
  const key = uf.unit.key;
  return {
    id: `failed:${key}:${f.tick_id}`,
    group: "unblock",
    story: story.key,
    slice: uf.unit.slice,
    step: st.step,
    title: f.reason.includes(key) ? f.reason : `${f.effect} for ${key} failed: ${f.reason}`,
    detail: `tick ${f.tick_id} (${f.rule})${f.session ? ` · session ${f.session.runner} ${f.session.pane_id ?? f.session.session_id}` : ""}`,
    command: `norn why ${key} --tick ${f.tick_id}`,
    since: f.at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/**
 * O1 Answer item. L1 (A7): an implicit ask shows the question block and the first command line,
 * with the options; the full screen only in `full` (`inbox --details`, `why`). R6.3: when the
 * typed answer did not reach the pane, the command is how to reach the pane instead.
 */
function answerItem(uf: UnitFacts, st: UnitState, park: NonNullable<UnitState["park"]>, item: (group: InboxGroup, title: string, command: string, since: string, extra?: Partial<InboxItem>) => InboxItem): InboxItem {
  const key = uf.unit.key;
  const details: string[] = [];
  const f = uf.act_failure;
  const failed = f?.effect === "answer" && f.step === st.step && f.attempt === st.attempt && epoch(f.at) >= epoch(park.since) ? f : null;
  if (failed) details.push(`not delivered: ${failed.reason}`);
  const cmd = firstLine(park.command);
  if (cmd) details.push(`pending command: ${cmd}`);
  if (park.options?.length) details.push(`options: ${optionsLine(park.options)} — answer with the number`);
  const reach = failed ? (st.run?.session?.reach ?? null) : null;
  if (failed && !reach && failed.session) details.push(`reach the agent in ${failed.session.runner} session ${failed.session.pane_id ?? failed.session.session_id}`);
  return item("answer", park.reason, reach ?? (nextCommand(key, st) as string), park.since, {
    ...(park.receipt_id ? { id: park.receipt_id } : {}),
    ...(details.length ? { detail: details.join(" · ") } : {}),
    ...(park.screen ? { full: park.screen } : {}),
  });
}

/** R9.1: the run's session started, the prompt was re-sent, and still no turn 60 s later. */
function launchPromptMissed(uf: UnitFacts, st: UnitState): { since: string; pane: string | null } | null {
  const run = st.run;
  const rf = uf.run;
  if (!run?.prompt_resent_at || !rf || rf.run_id !== run.run_id) return null;
  if (!sessionStartedNoTurn(rf)) return null;
  if (st.last_outcome?.outcome !== "silent" || epoch(st.last_outcome.at) < epoch(run.prompt_resent_at)) return null;
  return { since: run.prompt_resent_at, pane: run.session?.pane_id ?? run.session?.session_id ?? null };
}

/** The command a person runs to start the unit's step agent in its worktree. */
export function startCommandFor(uf: UnitFacts, story: StoryFacts, config: ResolvedConfig): string {
  const step = uf.workflow && uf.state ? stepOf(uf.workflow, uf.state.step) : null;
  const name = (step?.type === "agent" && step.agent) || config.default_agent;
  const agent = config.agents[name];
  const worktree = unitWorktree(story, uf, { mustExist: false });
  return startAgentCommand(worktree, agent?.command ?? agent?.adapter ?? name, agent?.args);
}

/**
 * MO5: how a person starts the unit's step agent — `norn open <unit>` when this machine's runner
 * opens terminals for a person (the hand-typed command then in the detail), else that command itself.
 */
export function personStart(uf: UnitFacts, story: StoryFacts, facts: Facts, config: ResolvedConfig): { command: string; detail?: string } {
  const start = startCommandFor(uf, story, config);
  if (!facts.machine.runner_capabilities?.open) return { command: start };
  return { command: `norn open ${uf.unit.key}`, detail: `by hand: ${start}` };
}

/**
 * GR2, O1: a story taken in on this checkout that no tick has started yet (intake by `norn sync`
 * creates the worktree; the tick starts the workflow). Running while the heartbeat is up — the next
 * tick starts it — else Your turn with the command that ticks.
 */
export function notStartedItem(story: StoryFacts, facts: Facts, config: ResolvedConfig): InboxItem | null {
  if (story.claim.state !== "mine" || isStarted(story) || storyFinished(story) || !story.frontmatter) return null;
  const up = heartbeatUp(facts, config);
  const base = { id: `not-started:${story.key}`, story: story.key, slice: null, step: null, since: story.frontmatter.intake_at, url: story.frontmatter.url };
  if (up) return { ...base, group: "running", title: "taken in — the next tick starts it", command: `norn status ${story.key}` };
  return { ...base, group: "your_turn", title: `taken in, not started — ${story.frontmatter.title}`, detail: "a tick starts the story; the inbox then shows how to start its first step", command: "norn watch" };
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
 * F21: what a gate judges — the report that led there (e.g. qa `partial`). `detail` names it by
 * receipt number; `full` (inbox `--details`, JSON) gives the receipt and its evidence folder as
 * absolute paths a person can open: the receipt lives in the unit's worktree, not the checkout
 * the inbox is read from.
 */
function judgedDetail(story: StoryFacts, uf: UnitFacts): { detail: string; full: string } | null {
  const nr = uf.last_outcome_receipt;
  if (!nr) return null;
  const r = nr.receipt;
  const file = absFile(nr.file, story, uf);
  const lines = [`Report: ${file}`];
  if (r.kind === "done" && r.evidence) {
    const runsDir = file.replace(/\/receipts\/[^/]+$/, "");
    lines.push(`Evidence: ${runsDir}/${r.evidence.replace(/\/+$/, "")}/`);
  }
  return { detail: `step ${r.step}#${r.attempt} reported ${"outcome" in r ? r.outcome : r.kind} (receipt ${String(nr.n).padStart(4, "0")})`, full: lines.join("\n") };
}

const oneLine = (t: string) => t.replace(/\s*\n\s*/g, " ").trim();

/**
 * QV7, NT3: what a person checks at a gate, so they need not open a file — the `person` and
 * `unverified` criteria of the report that led there (with `reason` and `how`), and the open notes:
 * on a story-level gate the story's (approving acknowledges them), on a slice gate the slice's own
 * (shown only; NT5). `detail` is one line; `full` (inbox `--details`) lists each on its own line.
 */
export function gateChecks(story: StoryFacts, uf: UnitFacts): { detail: string | null; full: string | null } {
  const check = personCriteria(uf.last_outcome_receipt?.receipt);
  const storyGate = uf.unit.slice === null;
  const notes = (story.notes ?? []).filter((n) => storyGate || n.unit === uf.unit.key);
  const parts: string[] = [];
  const lines: string[] = [];
  if (check.length) {
    parts.push(`check: ${check.map((c) => oneLine(criterionLine(c))).join("; ")}`);
    lines.push("Criteria for a person to check:", ...check.map((c) => `- ${criterionLine(c)}`));
  }
  if (notes.length) {
    const noteLine = (n: StoryNote) => `${n.unit} ${n.step}${n.criterion ? ` (${n.criterion})` : ""}: ${n.text}`;
    const [short, long] = storyGate
      ? ["open notes (approve acknowledges them)", "Open notes (approve acknowledges them; reject leaves them open):"]
      : [`open notes (${notesClearedBy(story)})`, `Open notes on this slice (${notesClearedBy(story)}; approving this gate leaves them open):`];
    parts.push(`${short}: ${notes.map((n) => oneLine(noteLine(n))).join("; ")}`);
    if (lines.length) lines.push("");
    lines.push(long, ...notes.map((n) => `- ${noteLine(n)} [${n.id}]`));
  }
  return { detail: parts.length ? parts.join(" · ") : null, full: lines.length ? lines.join("\n") : null };
}

/**
 * NT5: when the story's open notes leave the inbox — at the nearest story-level gate ahead of the
 * story unit's step (its own step when it waits at one; NT3), else when the story is done.
 */
export function notesClearedBy(story: StoryFacts): string {
  const uf = storyUnit(story);
  const wf = uf?.workflow;
  const from = uf?.state?.status === "done" ? null : uf?.state?.step;
  if (!wf || !from) return "cleared when the story is done";
  const edges = edgesOf(wf);
  const seen = new Set([from]);
  for (let ring = [from]; ring.length; ) {
    const gate = ring.find((s) => stepOf(wf, s)?.type === "gate");
    if (gate) return `cleared by ${story.key} ${gate} approval`;
    ring = edges.filter((e) => ring.includes(e.from) && !seen.has(e.to) && stepOf(wf, e.to)).map((e) => e.to);
    for (const s of ring) seen.add(s);
  }
  return "cleared when the story is done";
}

/**
 * NT2: one Notes item per open note of the story — a non-blocking question a reporting agent left
 * for a person; information, not an action. It leaves the inbox when a person gives `approve` at a
 * story-level gate (NT3); `cleared_by` says which one (NT5).
 */
export function noteItems(story: StoryFacts): InboxItem[] {
  const status = story.frontmatter?.status;
  if (status === "done" || status === "dropped") return [];
  const notes = story.notes ?? [];
  const cleared_by = notes.length ? notesClearedBy(story) : "";
  return notes.map((n) => ({
    id: n.id,
    group: "notes" as const,
    story: story.key,
    slice: n.unit === story.key ? null : n.unit,
    step: n.step,
    title: oneLine(noteTitle(n)),
    ...(n.text.includes("\n") ? { full: n.text } : {}),
    command: `norn why ${n.unit} --receipt ${n.receipt_id}`,
    since: n.at,
    cleared_by,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  }));
}

/** C1: the PR fetched this tick, else the last one this checkout saw (`pr_seen`); null/undefined = none known. */
export const knownPr = (story: StoryFacts): StoryFacts["pr"] => (story.pr !== undefined ? story.pr : story.pr_seen?.pr);

/**
 * GR6/F25: the story unit finished its workflow and its PR is open — merging it is the person's
 * last action, so it is an item (Your turn) with the PR URL, not "Recently done".
 */
function mergeItem(story: StoryFacts, st: UnitState, base: string): InboxItem | null {
  const pr = knownPr(story);
  // GR6: a branch already contained in origin/<base> (merged by ancestry, e.g. a merge commit
  // pushed by hand) needs no merge, even while the PR still reads `open`.
  if (!pr || pr.state !== "open" || story.merged_by_ancestry || story.frontmatter?.status === "done") return null;
  const draft = pr.is_draft;
  const cli = prCli(story);
  const details = [pr.url];
  if (draft) details.push(`draft: mark it ready first (${cli} ready ${pr.number})`);
  // BS10: how far the base moved since; a conflicting base sends the story back through update first
  const b = story.base;
  if (b && b.behind > 0) details.push(`behind ${base} by ${b.behind}`);
  const conflicting = !!b && b.conflicts.length > 0;
  if (conflicting) details.push(`conflicts with ${base} in ${b.conflicts.join(", ")} — update the story first`);
  return {
    id: `merge:${story.key}:${pr.number}`,
    group: "your_turn",
    story: story.key,
    slice: null,
    step: null,
    title: `Merge PR #${pr.number}${draft ? " (still a draft)" : ""}`,
    detail: details.join(" · "),
    command: conflicting ? `norn update ${story.key}` : `${cli} merge ${pr.number}`,
    since: st.updated_at,
    url: pr.url,
  };
}

/** BS10.1: steps that already bring the base in — `git: update` steps and the steps their `conflict` routes to (resolve). */
function baseSyncSteps(wf: Workflow): Set<string> {
  const out = new Set<string>();
  for (const [name, step] of Object.entries(wf.steps)) {
    if (step.type !== "git" || step.action !== "update") continue;
    out.add(name);
    const to = edgeOf(wf, name, "conflict")?.to;
    if (to) out.add(to);
  }
  return out;
}

/**
 * BS10: the story waits for a person and the base moved under it (BS7), with no gate `stale` route
 * to send it back by itself (BS6) — a Check item with `norn update`. BS10.1 (dogfood D1): only where
 * an update is the next thing to do — parked at a gate, or stuck outside the steps that sync the
 * base; never for an ask (a permission prompt in any step) nor in update/resolve.
 */
export function staleItem(story: StoryFacts, base: string): InboxItem | null {
  const b = story.base;
  const uf = storyUnit(story);
  const st = uf?.state;
  const wf = uf?.workflow ?? null;
  if (!b || !st || !wf || !isStale(wf, b)) return null;
  const step = stepOf(wf, st.step);
  const atGate = st.status === "parked" && st.park?.kind === "gate" && step?.type === "gate";
  const stuck = st.status === "stuck" && !baseSyncSteps(wf).has(st.step);
  if (!atGate && !stuck) return null;
  // BS6: a gate with a `stale` route is classified by the tick, not shown
  if (atGate && step?.type === "gate" && step.outcomes.stale !== undefined) return null;
  const title = b.conflicts.length ? `${story.key} conflicts with ${base} in ${b.conflicts.join(", ")} (${b.behind} behind)` : `${story.key} is ${b.behind} behind ${base}`;
  return {
    id: `stale:${story.key}:${b.sha}`,
    group: "check",
    story: story.key,
    slice: null,
    step: st.step,
    title,
    detail: `${base} at ${short(b.sha)}; the story head ${short(b.head)} has ${b.ahead} commit(s) of its own`,
    command: baseUpdateStep(wf) ? `norn update ${story.key}` : `git log --oneline ${b.head}..${b.sha}`,
    since: st.park?.since ?? st.updated_at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/** BS11: the story PR targets another branch than the story's base — merging it would skip the base. */
export function retargetItem(story: StoryFacts, base: string): InboxItem | null {
  const pr = knownPr(story);
  const target = prBaseBranch(pr);
  if (!pr || pr.state !== "open" || !target || target === base) return null;
  const st = storyUnit(story)?.state;
  return {
    id: `retarget:${story.key}:${pr.number}:${target}`,
    group: "check",
    story: story.key,
    slice: null,
    step: null,
    title: `PR #${pr.number} targets ${target}, not ${base}`,
    detail: "a merge there does not finish the story (BS11); retarget the PR to the base branch",
    command: `${prCli(story)} edit ${pr.number} ${prCli(story) === "glab mr" ? "--target-branch" : "--base"} ${base}`,
    since: st?.updated_at ?? story.frontmatter?.intake_at ?? "1970-01-01T00:00:00.000Z",
    url: pr.url,
  };
}

/** Hook events after which an attended agent waits for its person (HC1). */
const WAITING_HOOKS = new Set(["turn_end", "waiting_input", "permission_prompt"]);
const WAITING_PANE = new Set(["idle", "done", "waiting_input"]);

/**
 * HC1: when the attended agent of the unit's current run started waiting for its person (ms epoch),
 * or null while it works, is gone, or the step is not attended. The wait starts at the first of the
 * run's trailing waiting hooks, so Claude's `idle_prompt` (~60 s after `Stop`) does not restart it;
 * with no hook since the last activity, a pane that went idle afterwards starts it.
 */
export function attendedWaitSince(uf: UnitFacts): number | null {
  const st = uf.state;
  const rf = uf.run;
  if (st?.status !== "running" || !st.run || rf?.run_id !== st.run.run_id) return null;
  const step = uf.workflow ? stepOf(uf.workflow, st.step) : null;
  if (step?.type !== "agent" || !step.attended) return null;
  if (rf.process_alive === false || rf.pane?.alive === false) return null;
  let since: number | null = null;
  for (let i = rf.hooks.length - 1; i >= 0; i--) {
    const h = rf.hooks[i];
    if (!h || !WAITING_HOOKS.has(h.event)) {
      if (h?.event === "session_end") return null;
      break;
    }
    since = epoch(h.at);
  }
  if (since !== null) return since;
  const pane = rf.pane;
  if (pane && WAITING_PANE.has(pane.state) && pane.since !== null && pane.since > (rf.last_hook_at ?? 0)) return pane.since;
  return null;
}

/** HC3: where the unit's current run lives, for front ends that look for its pane (HC6). */
function reachOf(story: StoryFacts, uf: UnitFacts): InboxItem["reach"] | undefined {
  const run = uf.state?.run;
  if (!run) return undefined;
  const live = uf.run?.run_id === run.run_id ? uf.run : null;
  return {
    worktree: unitWorktree(story, uf, { mustExist: false }),
    agent_session_id: run.agent_session_id ?? live?.launch_unknown?.agent_session_id ?? null,
    pane_id: run.session?.pane_id ?? live?.session?.pane_id ?? null,
  };
}

/** Inbox item for one unit's current state, or null when nothing is shown for it. */
export function unitInboxItem(story: StoryFacts, uf: UnitFacts, facts: Facts, config: ResolvedConfig): InboxItem | null {
  const st = uf.state;
  const key = uf.unit.key;
  const reach = reachOf(story, uf);
  const base = { story: story.key, slice: uf.unit.slice, url: story.frontmatter?.url, ...(reach ? { reach } : {}) };
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
      if (park?.kind === "ask") return answerItem(uf, st, park, item);
      if (park?.kind === "gate") {
        const judged = judgedDetail(story, uf);
        const reject = `or reject: norn approve ${key} --reject --reason "…"`;
        const { detail, full } = gateChecks(story, uf);
        const fullText = [judged?.full, full].filter(Boolean).join("\n\n");
        return item("approve", park.reason, `norn approve ${key}`, park.since, { detail: [judged?.detail, detail, reject].filter(Boolean).join(" · "), ...(fullText ? { full: fullText } : {}) });
      }
      if (park?.kind === "attended") {
        const start = personStart(uf, story, facts, config);
        return item("your_turn", `${st.step}: attended step — work with the agent`, start.command, park.since, start.detail ? { detail: start.detail } : {});
      }
      return item("unblock", park?.reason ?? "parked", `norn unstick ${key}`, park?.since ?? st.updated_at);
    case "stuck":
      return item("unblock", park?.reason ?? "stuck", `norn unstick ${key}`, park?.since ?? st.updated_at, park?.receipt_id ? { id: park.receipt_id } : {});
    case "running": {
      // R9.1: the agent never took its launch prompt — a person looks at the pane
      const unsent = launchPromptMissed(uf, st);
      if (unsent) return item("unblock", `launch prompt not received by ${key} ${st.step}${unsent.pane ? ` — look at pane ${unsent.pane}` : ""}`, st.run?.session?.reach ?? `norn trace ${key}`, unsent.since, { id: `launch:${key}:${st.run?.run_id ?? st.step}`, detail: "the agent session started but never began a turn; the prompt was re-sent once (R9.1)" });
      const nudge = undeliveredNudge(story, uf, facts);
      if (nudge && !heartbeatDown(facts, config)) return item("your_turn", "agent ended its turn without reporting — reopen the agent and run norn brief", startCommandFor(uf, story, config), nudge.at, { id: `${nudge.outcome}:${key}:${st.step}#${st.attempt}:${st.nudges_used}` });
      // HC2: an attended agent waiting for its person past `attended_wait`; one item (and notification) per wait
      const waiting = attendedWaitSince(uf);
      if (waiting !== null && st.run && facts.now - waiting >= parseDuration(config.limits.attended_wait)) {
        // HC3: reach the session that waits — never start a second agent for the step
        const worktree = reach?.worktree ?? null;
        const command = st.run.session?.reach ?? (worktree ? `cd ${worktree}` : `norn trace ${key}`);
        return item("your_turn", `${st.step}: the agent is waiting for you`, command, iso(waiting), {
          id: `attended:${key}:${st.run.run_id}:${iso(waiting)}`,
          detail: "attended step: answer in the agent's pane; it reports when you agree (MO4)",
        });
      }
    }
      return item("running", `${st.step} #${st.attempt}${st.run ? ` (${st.run.how})` : ""}`, `norn trace ${key}`, st.run?.started_at ?? st.step_entered_at);
    case "ready": {
      const step = uf.workflow ? stepOf(uf.workflow, st.step) : null;
      if (step?.type === "agent") {
        const { mode, downgraded } = effectiveMode(story.mode, !!step.attended, facts.machine.runner);
        if (mode === "manual") {
          const start = personStart(uf, story, facts, config);
          const detail = [downgraded ? "auto requested, no runner; running manual (MO2)" : null, start.detail].filter(Boolean).join(" · ");
          return item("your_turn", `${st.step} is ready (manual): start an agent in the worktree`, start.command, st.step_entered_at, detail ? { detail } : {});
        }
      }
      // R5.5 (A8): an auto step waits for the heartbeat, not for a person — no manual start hint
      if (step?.type === "agent" && heartbeatDown(facts, config)) return item("running", `${st.step} #${st.attempt} (waiting for the heartbeat — norn watch)`, "norn watch", st.step_entered_at);
      return item("running", `${st.step} #${st.attempt} (queued)`, `norn trace ${key}`, st.step_entered_at);
    }
    case "done": {
      if (uf.unit.slice === null) {
        const merge = mergeItem(story, st, facts.repo.default_branch);
        if (merge) return merge;
      }
      if (facts.now - epoch(st.updated_at) > RECENT_MS) return null;
      // story.md says `done` once norn saw the merge (GR6) — the durable record when no PR was fetched
      const waiting = uf.unit.slice === null && knownPr(story)?.state !== "merged" && !story.merged_by_ancestry && story.frontmatter?.status !== "done";
      return item("recently_done", waiting ? "workflow done — waiting for the PR merge (GR6)" : "done", `norn trace ${key}`, st.updated_at);
    }
  }
}

const isStarted = (s: StoryFacts) => s.units.some((u) => u.state !== null);

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

/** C5: receipts that send a finished story unit back into its workflow — the head will change, the ready gate is passed again (BS9, S7). */
export const RE_ENTRY_KINDS = ["update", "workflow"] as const;

/**
 * F35: the story branch head when the person gave `approve` at the `ready` gate — the `head_sha` of
 * the newest `approve` receipt at that gate (the `ready` step, or any gate whose `approve` goes to
 * `$done`). C5: only an approval newer than the unit's last re-entry (`norn update`, `norn workflow
 * --to`) counts; a re-entry voids it until a new approve at the gate. `receipts` are the story
 * unit's, at least of the kinds `approve` and RE_ENTRY_KINDS; order does not matter.
 */
export function readyHeadSha(wf: Workflow, receipts: readonly NumberedReceipt[]): string | undefined {
  return readyApproval(wf, receipts)?.sha;
}

/** F35 + BS10.2: the head the ready approval let through and when it was given (`readyHeadSha`). */
export function readyApproval(wf: Workflow, receipts: readonly NumberedReceipt[]): { sha: string; at: string } | undefined {
  const isReady = (step: string) => step === "ready" || (stepOf(wf, step)?.type === "gate" && edgeOf(wf, step, "approve")?.to === "$done");
  const sorted = [...receipts].sort((a, b) => b.n - a.n);
  for (const { receipt: r } of sorted) {
    if ((RE_ENTRY_KINDS as readonly string[]).includes(r.kind)) return undefined;
    if (r.kind === "approve" && isReady(r.step)) return r.head_sha ? { sha: r.head_sha, at: r.at } : undefined;
  }
  return undefined;
}

/** F35: the PR head moved after the `ready.approve` — what would merge is not what was reviewed. */
export function headChangedItem(story: StoryFacts): InboxItem | null {
  const pr = knownPr(story);
  const ready = story.ready_head_sha;
  // C5: norn's own commits after the approval (its `$done` state commit) leave the head the person let through as it was
  if (!pr || pr.state !== "open" || !ready || !pr.head_sha || pr.head_sha === ready || pr.head_sha === story.ready_head_norn) return null;
  // BS10.2 (dogfood D6): a PR remembered from before the approval says nothing about what came after it
  if (story.pr === undefined && story.pr_seen && story.ready_approved_at && story.pr_seen.observed_at < epoch(story.ready_approved_at)) return null;
  const st = storyUnit(story)?.state;
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

/**
 * R2.3 (H5, A18): local runs/ work on a checkout that does not hold the claim — it is not in the
 * record and never will be (a non-holder never pushes, R2.2). One Check item per unit; `norn tidy`
 * moves the files to `runs/<unit>/orphaned/` on the local branch.
 */
export function unpushedItems(story: StoryFacts, facts: Facts): InboxItem[] {
  const c = story.claim;
  const held = c.state === "other" || c.state === "expired" ? `the story is now held by ${c.blob.holder}${c.state === "expired" ? " (expired)" : ""}` : "the story is not claimed by this checkout";
  const since = c.state === "other" ? c.blob.renewed_at : (story.frontmatter?.intake_at ?? iso(facts.now));
  return (story.unpushed_runs ?? [])
    .filter((u) => u.files.length)
    .map((u) => {
      const names = u.files.map((f) => f.split("/").at(-1) ?? f);
      const receipts = u.files.filter((f) => f.includes("/receipts/")).map((f) => (f.split("/").at(-1) ?? f).replace(/\.json$/, ""));
      const shown = (receipts.length ? receipts : names).slice(0, 3).join(", ") + ((receipts.length || names.length) > 3 ? ", …" : "");
      return {
        id: `unpushed:${u.unit}:${sha256(u.files.join("\n")).slice(0, 12)}`,
        group: "check" as const,
        story: story.key,
        slice: u.unit === story.key ? null : u.unit,
        step: null,
        title: `local work on ${u.unit} is not in the record (${shown}) — ${held}`,
        detail: u.files.join(" · "),
        command: "norn tidy",
        since,
        ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
      };
    });
}

/** Build the whole inbox (O1). Stories held by another heartbeat are not shown (except R2.3 unpushed work). */
export function buildInbox(facts: Facts, config: ResolvedConfig): Inbox {
  const groups = Object.fromEntries(INBOX_GROUPS.map((g) => [g, [] as InboxEntry[]])) as Record<InboxGroup, InboxEntry[]>;
  const add = (it: InboxItem | null) => {
    if (it) groups[it.group].push({ ...it, age: formatAge(facts.now - epoch(it.since)) });
  };
  for (const story of facts.stories) {
    const claim = story.claim.state;
    for (const it of unpushedItems(story, facts)) add(it);
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
    add(notStartedItem(story, facts, config));
    add(bodyChangedItem(story));
    add(headChangedItem(story));
    add(staleItem(story, facts.repo.default_branch));
    add(retargetItem(story, facts.repo.default_branch));
    for (const it of foreignCommitItems(story)) add(it);
    for (const it of noteItems(story)) add(it);
    for (const uf of story.units) {
      add(unitInboxItem(story, uf, facts, config));
      add(actFailureItem(story, uf));
    }
  }
  add(heartbeatItem(facts, config));
  for (const g of INBOX_GROUPS) groups[g].sort((a, b) => epoch(a.since) - epoch(b.since) || a.id.localeCompare(b.id));
  const pending = INBOX_GROUPS.filter((g) => g !== "running" && g !== "notes" && g !== "recently_done").reduce((n, g) => n + groups[g].length, 0);
  return { at: iso(facts.now), groups, pending };
}


// ---------------------------------------------------------------- history (O1, O4)

/** Groups whose items are tracked in the inbox history: the ones needing a person, and notes (NT2). */
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
