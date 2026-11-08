/**
 * Inbox read model: what needs a person, grouped by action, built from Facts only.
 * Each item carries the question/reason, its age and the exact command that resolves it.
 *
 * Groups, in order: Your turn (work only a person does: attended steps, manual starts, merging the
 * story PR), Answer, Approve (gates), Unblock, Check (informational: something changed outside
 * norn), Unclaimed, Running, Notes (agents' notes for a person: information, not an action),
 * Recently done.
 */
import { ATTENDED_WAIT, isClosedStatus, parseDuration, receiptNumber, recordRef, type ResolvedConfig, type UnitState, type Workflow } from "@norn/schema";
import { baseRunStateHint, cmd, NO_VERSION_HINT, nextCommand, skillsDriftHint, startAgentCommand, unstickCommand, versionMismatch } from "../commands.ts";
import { criterionLine, noteTitle, personCriteria, type StoryNote } from "../criteria.ts";
import type { Facts, FileError, NumberedReceipt, StoryFacts, UnitFacts } from "../facts.ts";
import type { InboxGroup, InboxItem } from "../ports.ts";
import { checkRunningSince, effectiveMode, firstLine, heartbeatUp, skillsDiffer, issueProblem, mergedIntoBase, prBaseBranch, sessionStartedNoTurn, stepLabel, storyFinished, storyUnit, unitWorktree } from "../policy.ts";
import { optionsLine } from "../prompt.ts";
import { isParked } from "../verbs.ts";
import { epoch, formatAge, iso } from "../time.ts";
import { baseUpdateStep, edgeOf, edgesOf, isStale, stepOf } from "../workflow.ts";

/** The `needs` was removed message of a file error, or null. */
const needsRemoved = (e: FileError): string | null => (e.code === "needs_removed" ? (e.errors[0]?.message ?? null) : null);

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
 * A counted nudge norn could not type (decide's `agent.*.surface`) — manual effective mode, or
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
 * This checkout's heartbeat is down — its last tick is older than 3 × watch interval
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

/** The Unblock item for a heartbeat that is down. */
function heartbeatItem(facts: Facts, config: ResolvedConfig): InboxItem | null {
  const down = heartbeatDown(facts, config);
  if (!down) return null;
  const story = facts.stories.find((s) => s.claim.state === "mine");
  return {
    id: `heartbeat:${down.holder}:${down.since ?? "never"}`,
    group: "unblock",
    story: story?.key ?? "*",
    slice: null,
    step: null,
    title: down.for_ms === null ? `no heartbeat on ${down.holder} yet — run \`${cmd.watch()}\`` : `no heartbeat on ${down.holder} for ${formatAge(down.for_ms)} — run \`${cmd.watch()}\``,
    detail: "auto steps start, and agents are classified, only while a heartbeat runs on the checkout that holds the story",
    command: cmd.watch(),
    since: down.since ?? iso(facts.now),
  };
}

/** The id of the repo-level version item, kept first in Unblock. */
const VERSION_ITEM = "norn-version:";

/** The repo-level item for a binary that does not fit the repo's norn version; front ends show it on top. */
export const isVersionMismatchItem = (it: Pick<InboxItem, "id" | "group">): boolean => it.group === "unblock" && it.id.startsWith(VERSION_ITEM);

/**
 * The running binary against the repo's norn version. A mismatch is a repo-level
 * Unblock item (first in its group); no recorded version is a Check item, so it never notifies.
 * Null when they match or the version was not observed.
 */
function versionItem(facts: Facts): InboxItem | null {
  const v = facts.norn;
  if (!v) return null;
  const base = { story: "*", slice: null, step: null, command: cmd.upgrade(), since: iso(facts.now) };
  if (v.repo === null) return { ...base, id: `${VERSION_ITEM}none`, group: "check", title: NO_VERSION_HINT };
  const mismatch = versionMismatch(v.repo, v.running);
  if (!mismatch) return null;
  // an older binary's way out is outside norn (install the repo's line); `doctor` runs on a mismatch and shows it
  const command = mismatch.match === "newer" ? cmd.upgrade() : cmd.doctor();
  return { ...base, id: `${VERSION_ITEM}${v.repo}:${v.running}`, group: "unblock", title: `${mismatch.error}: ${mismatch.do_instead}`, command };
}

/** The main checkout holds bundled skills that differ from the running norn's — one repo-level Unblock item. */
function repoSkillsDriftItem(facts: Facts): InboxItem | null {
  const v = facts.norn;
  if (!v?.skills_drift?.length) return null;
  return {
    id: `skills_drift:*:${v.running}:${v.skills_drift.join(",")}`,
    group: "unblock",
    story: "*",
    slice: null,
    step: null,
    title: skillsDriftHint.repo(v.running),
    detail: v.skills_drift.join(", "),
    command: cmd.upgrade(),
    since: iso(facts.now),
  };
}

/** Run state still in the base's tree — one repo-level Check item pointing to `norn upgrade`. */
function baseRunStateItem(facts: Facts): InboxItem | null {
  const stories = facts.base_run_state;
  if (!stories?.length) return null;
  return {
    id: `base_run_state:*:${stories.join(",")}`,
    group: "check",
    story: "*",
    slice: null,
    step: null,
    title: baseRunStateHint.text(facts.repo.default_branch, stories),
    detail: stories.join(", "),
    command: cmd.upgrade(),
    since: iso(facts.now),
  };
}

/** The act failure effect of a record push refused as stale (`ActFailure.lease`). */
export const RECORD_PUSH_EFFECT = "record_push";
/** The machine-local failures slot of a story's refused record push, apart from every unit's */
export const recordPushSlot = (story: string): string => `record:${story}`;

/**
 * This checkout holds the story under `remote`, but its record push was refused as stale: another
 * checkout pushed `refs/norn/runs/<story>`. One Check item, whatever the cursor, until a push lands
 * (the tick drops it once the claim is not here or the policy is `local`);
 * `norn story checkout` here fetches the ref (this checkout's run state kept), so the next push goes on top.
 */
function recordPushItem(story: StoryFacts): InboxItem | null {
  const f = story.record_refused;
  if (!f) return null;
  return {
    id: `record-push:${story.key}:${f.lease ?? "none"}`,
    group: "check",
    story: story.key,
    slice: null,
    step: null,
    title: `record push to ${recordRef(story.key)} refused: another checkout pushed it since this one last saw it (${f.lease ? short(f.lease) : "none"}); pushes wait`,
    detail: `${f.reason} · tick ${f.tick_id}`,
    command: cmd.storyCheckout(story.key),
    since: f.at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/**
 * The unit's worktree holds bundled skills that differ from the running norn's. Nothing
 * is held — its runs use those copies — so it is a Check item, one per unit and set of skills.
 */
function skillsDriftItem(story: StoryFacts, uf: UnitFacts, facts: Facts): InboxItem | null {
  if (!skillsDiffer(uf) || !uf.skills_drift || !facts.norn) return null;
  return {
    id: `skills_drift:${uf.unit.key}:${facts.norn.running}:${uf.skills_drift.join(",")}`,
    group: "check",
    story: story.key,
    slice: uf.unit.slice,
    step: uf.state?.step ?? null,
    title: skillsDriftHint.unit(facts.norn.running, uf.skills_drift),
    command: cmd.storyView(story.key),
    since: uf.state?.step_entered_at ?? iso(facts.now),
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/**
 * An action's effect failed for the unit (a nudge or answer not delivered, a launch or resume
 * that failed, a push refused) — an Unblock item until an effect of the same kind succeeds, the
 * cursor moves, or (for deliveries) the agent shows activity again. Also used for prompts.
 */
export function actFailureItem(story: StoryFacts, uf: UnitFacts): InboxItem | null {
  const f = uf.act_failure;
  const st = uf.state;
  // A refused commit is owed even by a finished unit (its `$done` state is not on record yet)
  if (!f || !st || (st.status === "done" && f.effect !== "commit") || st.status === "corrupt" || f.step !== st.step || f.attempt !== st.attempt) return null;
  // An answer that did not reach its prompt is told on the Answer item itself (answerItem)
  if (f.effect === "answer" && st.status === "parked" && st.park?.kind === "ask") return null;
  // a refused push or commit stays until the effect succeeds or the cursor moves
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
    command: cmd.runView(key, { why: true, tick: f.tick_id }),
    since: f.at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/**
 * Answer item. An implicit ask shows the question block and the first command line, with the
 * options; the full screen only in `full`. When the typed answer did not reach the pane, the
 * command is how to reach the pane instead.
 */
function answerItem(uf: UnitFacts, st: UnitState, park: NonNullable<UnitState["park"]>, item: (group: InboxGroup, title: string, command: string, since: string, extra?: Partial<InboxItem>) => InboxItem): InboxItem {
  const key = uf.unit.key;
  const details: string[] = [];
  const f = uf.act_failure;
  const failed = f?.effect === "answer" && f.step === st.step && f.attempt === st.attempt && epoch(f.at) >= epoch(park.since) ? f : null;
  if (failed) details.push(`not delivered: ${failed.reason}`);
  const pending = firstLine(park.command);
  if (pending) details.push(`pending command: ${pending}`);
  if (park.options?.length) details.push(`options: ${optionsLine(park.options)} — answer with the number`);
  const reach = failed ? (st.run?.session?.reach ?? null) : null;
  if (failed && !reach && failed.session) details.push(`reach the agent in ${failed.session.runner} session ${failed.session.pane_id ?? failed.session.session_id}`);
  return item("answer", park.reason, reach ?? (nextCommand(key, st) as string), park.since, {
    ...(park.receipt_id ? { id: park.receipt_id } : {}),
    ...(details.length ? { detail: details.join(" · ") } : {}),
    ...(park.screen ? { full: park.screen } : {}),
  });
}

/** The run's session started, the prompt was re-sent, and still no turn 60 s later. */
function launchPromptMissed(uf: UnitFacts, st: UnitState): { since: string; pane: string | null } | null {
  const run = st.run;
  const rf = uf.run;
  if (!run?.prompt_resent_at || !rf || rf.run_id !== run.run_id) return null;
  if (!sessionStartedNoTurn(rf)) return null;
  if (st.last_outcome?.outcome !== "silent" || epoch(st.last_outcome.at) < epoch(run.prompt_resent_at)) return null;
  return { since: run.prompt_resent_at, pane: run.session?.pane_id ?? run.session?.session_id ?? null };
}

/**
 * The command a person runs to start the unit's step agent in its worktree. It `cd`s only into a
 * worktree observed on disk — the check decide makes before it starts a run there — never
 * into a recorded path that is gone.
 */
export function startCommandFor(uf: UnitFacts, story: StoryFacts, config: ResolvedConfig): string {
  const step = uf.workflow && uf.state ? stepOf(uf.workflow, uf.state.step) : null;
  const name = (step?.type === "agent" && step.agent) || config.agent;
  const agent = config.agents[name];
  const worktree = unitWorktree(story, uf);
  return startAgentCommand(worktree, name, agent?.args);
}

/**
 * How a person starts the unit's step agent — `norn story start <unit>` when this machine's runner
 * opens terminals for a person (the hand-typed command then in the detail), else that command itself.
 */
function personStart(uf: UnitFacts, story: StoryFacts, facts: Facts, config: ResolvedConfig): { command: string; detail?: string } {
  const start = startCommandFor(uf, story, config);
  if (!facts.machine.runner_capabilities?.open) return { command: start };
  return { command: cmd.storyStart(uf.unit.key), detail: `by hand: ${start}` };
}

/**
 * A story taken in on this checkout that no tick has started yet (intake by `norn sync`
 * creates the worktree; the tick starts the workflow). Running while the heartbeat is up — the next
 * tick starts it — else Your turn with the command that ticks.
 */
function notStartedItem(story: StoryFacts, facts: Facts, config: ResolvedConfig): InboxItem | null {
  if (story.claim.state !== "mine" || isStarted(story) || storyFinished(story) || !story.frontmatter) return null;
  const up = heartbeatUp(facts, config);
  const base = { id: `not-started:${story.key}`, story: story.key, slice: null, step: null, since: story.frontmatter.intake_at, url: story.frontmatter.url };
  if (up) return { ...base, group: "running", title: "taken in — the next tick starts it", command: cmd.storyView(story.key) };
  return { ...base, group: "your_turn", title: `taken in, not started — ${story.frontmatter.title}`, detail: "a tick starts the story; the inbox then shows how to start its first step", command: cmd.watch() };
}

const short = (sha: string) => sha.slice(0, 7);
const prCli = (story: StoryFacts) => (story.frontmatter?.provider ?? story.key.slice(0, 2)) === "gl" ? "glab mr" : "gh pr";

/**
 * Absolute path of a receipt file as observed (repo-relative to the unit's worktree, or absolute).
 * Only a worktree on disk holds the unit's runs/: a slice without its own reads them from the story's.
 */
function absFile(file: string, story: StoryFacts, uf: UnitFacts): string {
  if (file.startsWith("/")) return file;
  const wt = (uf.worktree?.exists ? uf.worktree.path : null) ?? (story.worktree?.exists ? story.worktree.path : null) ?? "";
  return wt ? `${wt.replace(/\/+$/, "")}/${file}` : file;
}

/**
 * What a gate judges — the report that led there (e.g. qa `partial`). `detail` names it by
 * receipt number; `full` (inbox `--details`, JSON) gives the receipt and its evidence folder as
 * absolute paths a person can open: the receipt lives in the machine dir, not the checkout
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
  return { detail: `step ${r.step}#${r.attempt} reported ${"outcome" in r ? r.outcome : r.kind} (receipt ${receiptNumber(nr.n)})`, full: lines.join("\n") };
}

const oneLine = (t: string) => t.replace(/\s*\n\s*/g, " ").trim();

/**
 * What a person checks at a gate, so they need not open a file — the `person` and
 * `unverified` criteria of the report that led there (with `reason` and `how`), and the open notes:
 * on a story-level gate the story's (approving acknowledges them), on a slice gate the slice's own
 * (shown only). `detail` is one line; `full` (inbox `--details`) lists each on its own line.
 */
function gateChecks(story: StoryFacts, uf: UnitFacts): { detail: string | null; full: string | null } {
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
 * When the story's open notes leave the inbox — at the nearest story-level gate ahead of the
 * story unit's step (its own step when it waits at one), else when the story is done.
 */
function notesClearedBy(story: StoryFacts): string {
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
 * One Notes item per open note of the story — a non-blocking question a reporting agent left
 * for a person; information, not an action. It leaves the inbox when a person gives `approve` at a
 * story-level gate; `cleared_by` says which one.
 */
function noteItems(story: StoryFacts): InboxItem[] {
  const status = story.frontmatter?.status;
  if (isClosedStatus(status)) return [];
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
    command: cmd.runView(n.unit, { receipt: n.receipt_id }),
    since: n.at,
    cleared_by,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  }));
}

/** The PR fetched this tick, else the last one this checkout saw (`pr_seen`); null/undefined = none known. */
const knownPr = (story: StoryFacts): StoryFacts["pr"] => (story.pr !== undefined ? story.pr : story.pr_seen?.pr);

/**
 * The story unit finished its workflow and its PR is open — merging it is the person's
 * last action, so it is an item (Your turn) with the PR URL, not "Recently done".
 */
function mergeItem(story: StoryFacts, st: UnitState, base: string): InboxItem | null {
  const pr = knownPr(story);
  // A branch already contained in origin/<base> (merged by ancestry, e.g. a merge commit
  // pushed by hand) needs no merge, even while the PR still reads `open`.
  if (!pr || pr.state !== "open" || story.merged_by_ancestry || story.frontmatter?.status === "done") return null;
  const draft = pr.is_draft;
  const cli = prCli(story);
  const details = [pr.url];
  if (draft) details.push(`draft: mark it ready first (${cli} ready ${pr.number})`);
  // How far the base moved since; a conflicting base sends the story back through update first
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
    command: conflicting ? cmd.storyUpdateBranch(story.key) : `${cli} merge ${pr.number}`,
    since: st.updated_at,
    url: pr.url,
  };
}

/** Steps that already bring the base in — `git: update` steps and the steps their `conflict` routes to (resolve). */
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
 * The story waits for a person and the base moved under it, with no gate `stale` route
 * to send it back by itself — a Check item with `norn story update-branch`. Only where
 * an update is the next thing to do — parked at a gate, or stuck outside the steps that sync the
 * base; never for an ask (a permission prompt in any step) nor in update/resolve.
 */
function staleItem(story: StoryFacts, base: string): InboxItem | null {
  const b = story.base;
  const uf = storyUnit(story);
  const st = uf?.state;
  const wf = uf?.workflow ?? null;
  if (!b || !st || !wf || !isStale(wf, b)) return null;
  const step = stepOf(wf, st.step);
  const atGate = isParked(st, "gate") && step?.type === "gate";
  const stuck = st.status === "stuck" && !baseSyncSteps(wf).has(st.step);
  if (!atGate && !stuck) return null;
  // A gate with a `stale` route is classified by the tick, not shown
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
    command: baseUpdateStep(wf) ? cmd.storyUpdateBranch(story.key) : `git log --oneline ${b.head}..${b.sha}`,
    since: st.park?.since ?? st.updated_at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/** The story's work is on its base — merged (PR or ancestry), or spec.md records it done (the durable record when no PR was fetched). */
const landed = (story: StoryFacts, base: string): boolean => mergedIntoBase(story, base) || story.frontmatter?.status === "done";

/**
 * An issue change on a finished round (label removed, unassigned, unseen) parks nothing;
 * it is a Check item while the round stays finished, read from `issue_seen` between syncs. A closed
 * issue there closes the story instead.
 */
function finishedRoundRemoteItem(story: StoryFacts, config: ResolvedConfig, base: string): InboxItem | null {
  const st = storyUnit(story)?.state;
  if (st?.status !== "done" || landed(story, base)) return null;
  // between syncs the issue is not fetched: the one the last sync saw keeps the item put
  const issue = story.issue !== undefined ? story.issue : story.issue_seen?.issue;
  const reason = issueProblem({ ...story, issue }, config.label);
  if (!reason) return null;
  return {
    id: `remote:${story.key}:${reason}`,
    group: "check",
    story: story.key,
    slice: null,
    step: st.step,
    title: `${story.key}: ${reason} — the round stays finished`,
    detail: "a finished round is not parked for the issue",
    command: cmd.storyView(story.key, { web: true }),
    since: st.updated_at,
    ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
  };
}

/** The story PR targets another branch than the story's base — merging it would skip the base. */
function retargetItem(story: StoryFacts, base: string): InboxItem | null {
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
    detail: "a merge there does not finish the story; retarget the PR to the base branch",
    command: `${prCli(story)} edit ${pr.number} ${prCli(story) === "glab mr" ? "--target-branch" : "--base"} ${base}`,
    since: st?.updated_at ?? story.frontmatter?.intake_at ?? "1970-01-01T00:00:00.000Z",
    url: pr.url,
  };
}

/** Hook events after which an attended agent waits for its person. */
const WAITING_HOOKS = new Set(["turn_end", "waiting_input", "permission_prompt"]);

/**
 * When the attended agent of the unit's current run started waiting for its person (ms epoch),
 * or null while it works, is gone, or the step is not attended. The wait starts at the first of the
 * run's trailing waiting hooks, so Claude's `idle_prompt` (~60 s after `Stop`) does not restart it.
 * The wait comes from hooks only: a pane carries no time of change to start it from.
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
  return since;
}

/** Where the unit's current run lives (a worktree on disk, as decide requires), for front ends that look for its pane. */
function reachOf(story: StoryFacts, uf: UnitFacts): InboxItem["reach"] | undefined {
  const run = uf.state?.run;
  if (!run) return undefined;
  const live = uf.run?.run_id === run.run_id ? uf.run : null;
  return {
    worktree: unitWorktree(story, uf),
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
    // What failed, so a duplicate receipt number names the other (stray) file too
    const why = [...new Set(uf.errors.flatMap((e) => e.errors.map((x) => x.message)))].join("; ");
    return { ...base, id: `corrupt:${key}:${files}`, group: "unblock", step: st?.step ?? null, title: `corrupt: ${files} failed validation${why ? `: ${why}` : ""}`, command: cmd.runView(key, { why: true }), since: iso(facts.now) };
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
  // A story held here from its record alone has no branch, so nothing runs in
  // it — a run its record names belongs to the previous holder's session, and nothing can start
  if (story.record_only && (st.status === "running" || st.status === "ready"))
    return item("check", `${st.step} #${st.attempt}: held here from its record; ${story.key} has no branch, so nothing runs`, cmd.storyView(key), st.updated_at, {
      id: `record-only:${key}:${st.step}#${st.attempt}`,
    });
  switch (st.status) {
    case "parked":
      if (park?.kind === "ask") return answerItem(uf, st, park, item);
      if (park?.kind === "gate") {
        const judged = judgedDetail(story, uf);
        const reject = `or reject: ${cmd.storyReject(key)}`;
        const { detail, full } = gateChecks(story, uf);
        const fullText = [judged?.full, full].filter(Boolean).join("\n\n");
        return item("approve", park.reason, cmd.storyApprove(key), park.since, { detail: [judged?.detail, detail, reject].filter(Boolean).join(" · "), ...(fullText ? { full: fullText } : {}) });
      }
      if (park?.kind === "attended") {
        const start = personStart(uf, story, facts, config);
        return item("your_turn", `${st.step}: attended step — work with the agent`, start.command, park.since, start.detail ? { detail: start.detail } : {});
      }
      return item("unblock", park?.reason ?? "parked", unstickCommand(key, st), park?.since ?? st.updated_at);
    case "stuck":
      return item("unblock", park?.reason ?? "stuck", unstickCommand(key, st), park?.since ?? st.updated_at, park?.receipt_id ? { id: park.receipt_id } : {});
    case "running": {
      // The agent never took its launch prompt — a person looks at the pane
      const unsent = launchPromptMissed(uf, st);
      if (unsent) return item("unblock", `launch prompt not received by ${key} ${st.step}${unsent.pane ? ` — look at pane ${unsent.pane}` : ""}`, st.run?.session?.reach ?? cmd.runList(key), unsent.since, { id: `launch:${key}:${st.run?.run_id ?? st.step}`, detail: "the agent session started but never began a turn; the prompt was re-sent once" });
      const nudge = undeliveredNudge(story, uf, facts);
      if (nudge && !heartbeatDown(facts, config)) return item("your_turn", `agent ended its turn without reporting — reopen the agent and run ${cmd.brief()}`, startCommandFor(uf, story, config), nudge.at, { id: `${nudge.outcome}:${key}:${st.step}#${st.attempt}:${st.nudges_used}` });
      // An attended agent waiting for its person past `attended_wait`; one item (and notification) per wait
      const waiting = attendedWaitSince(uf);
      if (waiting !== null && st.run && facts.now - waiting >= parseDuration(ATTENDED_WAIT)) {
        // Reach the session that waits — never start a second agent for the step
        const worktree = reach?.worktree ?? null;
        const command = st.run.session?.reach ?? (worktree ? `cd ${worktree}` : cmd.runList(key));
        return item("your_turn", `${st.step}: the agent is waiting for you`, command, iso(waiting), {
          id: `attended:${key}:${st.run.run_id}:${iso(waiting)}`,
          detail: "attended step: answer in the agent's pane; it reports when you agree",
        });
      }
    }
      return item("running", `${st.step} #${st.attempt}${st.run ? ` (${st.run.how})` : ""}`, cmd.runList(key), st.run?.started_at ?? st.step_entered_at);
    case "ready": {
      const step = uf.workflow ? stepOf(uf.workflow, st.step) : null;
      if (step?.type === "agent") {
        const { mode, downgraded } = effectiveMode(story.mode, !!step.attended, facts.machine.runner);
        if (mode === "manual") {
          const start = personStart(uf, story, facts, config);
          const detail = [downgraded ? "auto requested, no runner; running manual" : null, start.detail].filter(Boolean).join(" · ");
          return item("your_turn", `${st.step} is ready (manual): start an agent in the worktree`, start.command, st.step_entered_at, detail ? { detail } : {});
        }
      }
      // An auto step waits for the heartbeat, not for a person — no manual start hint
      if (step?.type === "agent" && heartbeatDown(facts, config)) return item("running", `${st.step} #${st.attempt} (waiting for the heartbeat — ${cmd.watch()})`, cmd.watch(), st.step_entered_at);
      const checkSince = checkRunningSince(step, uf);
      if (checkSince) return item("running", `${st.step} #${st.attempt} (check running)`, cmd.runList(key), checkSince);
      return item("running", `${st.step} #${st.attempt} (queued)`, cmd.runList(key), st.step_entered_at);
    }
    case "done": {
      if (uf.unit.slice === null) {
        // A round receipt rejected because its workflow file changed — the edit again
        if (park?.kind === "workflow")
          return item("your_turn", `${story.key}: ${park.reason}`, park.command ?? cmd.storyEdit(story.key, { workflow: "<name>" }), park.since, { id: `round_rejected:${key}:${park.receipt_id ?? park.since}` });
        const merge = mergeItem(story, st, facts.repo.default_branch);
        if (merge) return merge;
        // A finished round with no PR — the next round or closing the issue is the
        // person's; generic, never a recommendation read off the last step's outcome
        if (!landed(story, facts.repo.default_branch) && !knownPr(story))
          return item("your_turn", `${story.key}: ${st.workflow} round done, no PR`, cmd.storyEdit(story.key, { workflow: "<name>" }), st.updated_at, {
            id: `round_done:${key}:${uf.record ?? st.workflow}`,
            detail: "or close the issue",
          });
      }
      if (facts.now - epoch(st.updated_at) > RECENT_MS) return null;
      return item("recently_done", "done", cmd.runList(key), st.updated_at);
    }
  }
}

const isStarted = (s: StoryFacts) => s.units.some((u) => u.state !== null);

/** The remote body changed after refine finished. */
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
    command: cmd.storyView(story.key),
    since: fm.intake_at,
    url: fm.url,
  };
}

/** Receipts that send a finished story unit back into its workflow — the head will change, the ready gate is passed again. */
export const RE_ENTRY_KINDS = ["update", "workflow"] as const;

/**
 * The story branch head when the person gave `approve` at the `ready` gate — the `head_sha` of
 * the newest `approve` receipt at that gate (the `ready` step, or any gate whose `approve` goes to
 * `$done`). Only an approval newer than the unit's last re-entry (`norn story update-branch`, `norn story edit
 * --at`) counts; a re-entry voids it until a new approve at the gate. `receipts` are the story
 * unit's, at least of the kinds `approve` and RE_ENTRY_KINDS; order does not matter.
 */
function readyHeadSha(wf: Workflow, receipts: readonly NumberedReceipt[]): string | undefined {
  return readyApproval(wf, receipts)?.sha;
}

/** The head the ready approval let through and when it was given (`readyHeadSha`). */
export function readyApproval(wf: Workflow, receipts: readonly NumberedReceipt[]): { sha: string; at: string } | undefined {
  const isReady = (step: string) => step === "ready" || (stepOf(wf, step)?.type === "gate" && edgeOf(wf, step, "approve")?.to === "$done");
  const sorted = [...receipts].sort((a, b) => b.n - a.n);
  for (const { receipt: r } of sorted) {
    if ((RE_ENTRY_KINDS as readonly string[]).includes(r.kind)) return undefined;
    if (r.kind === "approve" && isReady(r.step)) return r.head_sha ? { sha: r.head_sha, at: r.at } : undefined;
  }
  return undefined;
}

/** The PR head moved after the `ready.approve` — what would merge is not what was reviewed. */
function headChangedItem(story: StoryFacts): InboxItem | null {
  const pr = knownPr(story);
  const ready = story.ready_head_sha;
  // Norn's own commits after the approval (its `$done` state commit) leave the head the person let through as it was
  if (!pr || pr.state !== "open" || !ready || !pr.head_sha || pr.head_sha === ready || pr.head_sha === story.ready_head_norn) return null;
  // a PR remembered from before the approval says nothing about what came after it
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

/** Commits norn did not make, one informational item per branch (newest commit in the id). */
function foreignCommitItems(story: StoryFacts): InboxItem[] {
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
 * A record this checkout set aside when another checkout took the story
 * over without a release — never pushed, never merged into the new holder's. One Check item each, until
 * `norn tidy` deletes the copy after `trace.retain`.
 */
function supersededItems(facts: Facts): InboxItem[] {
  return (facts.superseded ?? []).map((c) => {
    const url = facts.stories.find((s) => s.key === c.story)?.frontmatter?.url;
    return {
      // one id per copy, its ulid (two copies of one story may share a last receipt)
      id: `superseded:${c.story}:${c.name.slice(c.story.length + 1)}`,
      group: "check" as const,
      story: c.story,
      slice: null,
      step: null,
      title: `your record of ${c.story} was superseded when ${c.holder ?? "another checkout"} took it over${c.last_receipt ? ` (last local receipt ${c.last_receipt})` : ""}`,
      detail: `kept in ${c.dir} until norn tidy deletes it after trace.retain; nothing in it is pushed or merged`,
      command: `ls -R ${c.dir}`,
      since: c.at,
      ...(url ? { url } : {}),
    };
  });
}

/**
 * A merged story whose `status: done` record the base kept refusing (a protected branch, a spec
 * that will not patch): norn stopped retrying, so only a person can land it. Not filtered on the
 * claim, the story is already cleaned up; gone once observe sees the base read done.
 */
function owedRecordItems(facts: Facts): InboxItem[] {
  const base = facts.repo.default_branch;
  return (facts.owed_records ?? []).map((r) => {
    const url = facts.stories.find((s) => s.key === r.story)?.frontmatter?.url;
    return {
      id: `record_owed:${r.story}`,
      group: "unblock" as const,
      story: r.story,
      slice: null,
      step: null,
      title: `${r.story} merged, but ${base} refused its status: done record ${r.refusals} times`,
      // the push reason carries its own by-hand hint; the detail gives it once
      detail: `${r.reason.replace(/: set status: .*$/, "")}. norn stopped retrying; set status: done in ${r.spec_dir}/spec.md on ${base} (by a PR if the branch is protected); the item clears once norn sees it there`,
      command: cmd.sync(),
      since: r.stopped_at,
      ...(url ? { url } : {}),
    };
  });
}

/**
 * A mailbox receipt this holder's tick rejected, one Check item each, so a stale
 * answer never vanishes silently. Gone once a later answer or approval of the story is accepted (observe
 * leaves it out) or the story finishes; there is no dismiss command.
 */
function rejectedItems(story: StoryFacts): InboxItem[] {
  if (storyFinished(story)) return [];
  return (story.rejected_mailbox ?? []).map((r) => {
    // the step the unit is at now (the story is held here), else where it was when the receipt was rejected
    const now = story.units.find((u) => u.unit.key === r.unit)?.state?.step ?? r.at_step;
    return {
      id: `rejected:${r.receipt_id}`,
      group: "check" as const,
      story: story.key,
      slice: r.unit === story.key ? null : r.unit,
      step: null,
      title: `${r.kind} from ${r.who ?? "another machine"} for ${r.unit} was rejected: ${now ? `${r.unit} is at ${now} now` : r.reason}`,
      detail: `stamped for ${stepLabel(r.step, r.attempt)}; ${r.reason}`,
      command: cmd.runList(r.unit),
      since: r.rejected_at,
      ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
    };
  });
}

/** Build the whole inbox. Stories held by another heartbeat are not shown (their superseded records are). */
export function buildInbox(facts: Facts, config: ResolvedConfig): Inbox {
  const groups = Object.fromEntries(INBOX_GROUPS.map((g) => [g, [] as InboxEntry[]])) as Record<InboxGroup, InboxEntry[]>;
  // Every item of a started story carries its round and the round's workflow
  const rounds = new Map<string, { n: number; workflow: string }>();
  for (const story of facts.stories) {
    const st = storyUnit(story)?.state;
    if (st) rounds.set(story.key, { n: st.round ?? 1, workflow: st.workflow });
  }
  const add = (it: InboxItem | null) => {
    const round = it ? rounds.get(it.story) : undefined;
    if (it) groups[it.group].push({ ...it, ...(round ? { round } : {}), age: formatAge(facts.now - epoch(it.since)) });
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
        command: cmd.storyCheckout(story.key),
        since,
        ...(story.frontmatter ? { url: story.frontmatter.url } : {}),
      });
      continue;
    }
    if (story.frontmatter_error) {
      const needs = needsRemoved(story.frontmatter_error);
      add({
        id: `corrupt:${story.key}:spec.md`,
        group: "unblock",
        story: story.key,
        slice: null,
        step: null,
        title: needs ?? `corrupt: ${story.frontmatter_error.file} failed validation`,
        command: needs ? cmd.upgrade() : cmd.runView(story.key, { why: true }),
        since: iso(facts.now),
      });
      continue;
    }
    // A slice file that still has criteria `needs` is not corrupt: `norn upgrade` fixes it
    for (const s of story.slices) {
      const needs = s.error && needsRemoved(s.error);
      if (needs) add({ id: `needs:${s.key}`, group: "unblock", story: story.key, slice: s.key, step: null, title: needs, command: cmd.upgrade(), since: iso(facts.now) });
    }
    add(notStartedItem(story, facts, config));
    add(bodyChangedItem(story));
    add(headChangedItem(story));
    add(staleItem(story, facts.repo.default_branch));
    add(retargetItem(story, facts.repo.default_branch));
    add(finishedRoundRemoteItem(story, config, facts.repo.default_branch));
    for (const it of foreignCommitItems(story)) add(it);
    add(recordPushItem(story));
    for (const it of rejectedItems(story)) add(it);
    for (const it of noteItems(story)) add(it);
    for (const uf of story.units) {
      add(unitInboxItem(story, uf, facts, config));
      add(skillsDriftItem(story, uf, facts));
      add(actFailureItem(story, uf));
    }
  }
  add(heartbeatItem(facts, config));
  add(versionItem(facts));
  add(repoSkillsDriftItem(facts));
  add(baseRunStateItem(facts));
  for (const it of supersededItems(facts)) add(it);
  for (const it of owedRecordItems(facts)) add(it);
  // The version item comes first, whatever its age
  const pinned = (it: InboxEntry) => (it.id.startsWith(VERSION_ITEM) ? 0 : 1);
  for (const g of INBOX_GROUPS) groups[g].sort((a, b) => pinned(a) - pinned(b) || epoch(a.since) - epoch(b.since) || a.id.localeCompare(b.id));
  const pending = INBOX_GROUPS.filter((g) => g !== "running" && g !== "notes" && g !== "recently_done").reduce((n, g) => n + groups[g].length, 0);
  return { at: iso(facts.now), groups, pending };
}
