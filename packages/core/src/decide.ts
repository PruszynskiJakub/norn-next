/**
 * decide (H3): `(facts, repo workflows, config) → Decision[]`, pure and deterministic.
 * At most one action per unit per tick; every decision records the rule that fired (O5).
 * Ids come from `deriveUlid(facts.tick_id, i)` and times from `facts.now`, so `norn why`
 * replays to identical output.
 *
 * Order per story: claim (T3–T6; a due renewal is a side action, R1.1) → corrupt (S2) → remote
 * lifecycle (GR6–GR8) → mailbox (T9),
 * then per unit: receipts (C2: receipts always win over runner facts) → workflow drift (S7)
 * → recovery commit → step semantics by type (§6, §10, W2). Ready steps are served in
 * queue order (K1): oldest story by intake, then slice number.
 */
import {
  type AgentStep,
  type ClaimBlob,
  deriveUlid,
  type GitStep,
  parseDuration,
  type Receipt,
  type ReceiptOf,
  type ResolvedConfig,
  type SliceFrontmatter,
  sliceBranch,
  sliceDirName,
  slugify,
  specDir,
  type StoryFrontmatter,
  storyBranch,
  storyKey,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { Action, AgentLaunch, BoundaryCommit, Decision, NewReceipt, RunGitAction, SessionInput, UpdateStoryMirrorAction, WorktreeSpec } from "./actions.ts";
import { type ApplyResult, applyReceipts, initialState, routeOf } from "./apply.ts";
import { AUTO_PROMPT, NUDGE_TEXT, sliceWorktreePath, storyWorktreePath } from "./commands.ts";
import type { Facts, NumberedReceipt, RunFacts, SliceFileFacts, StoryFacts, UnitFacts, UnitRef } from "./facts.ts";
import { sha256 } from "./hash.ts";
import { bodyChangedItem, unitInboxItem } from "./inbox.ts";
import { effectiveMode, firstLine, mergedIntoBase, prBaseBranch, sessionStartedNoTurn, storyFinished, storyUnit, unitWorktree } from "./policy.ts";
import { promptKeys } from "./prompt.ts";
import type { InboxItem, RemoteIssue, RunnerCapabilities, SessionRef } from "./ports.ts";
import { epoch, iso } from "./time.ts";
import { checkWorkflowLevel, edgeOf, isStale, stepOf, type UnitLevel, type WorkflowIssue } from "./workflow.ts";

/** A repo workflow as loaded by the caller: parsed + validated (W5) with the exact file text. */
export interface LoadedWorkflow {
  name: string;
  /** null when the file failed schema validation */
  workflow: Workflow | null;
  /** exact file text, pinned verbatim at unit start (S7) */
  source: string;
  /** validateWorkflowDefinition issues (incl. skills); non-empty = refused (W5) */
  issues: WorkflowIssue[];
}
export type RepoWorkflows = Readonly<Record<string, LoadedWorkflow>>;

const WF_LABEL = "norn:wf:";

/** R1.1: a side action rides along with its unit's one action this tick — only a claim renewal. */
export function isSideAction(a: { kind: string; op?: unknown }): boolean {
  return a.kind === "claim" && a.op === "renew";
}

/** The decision that is the unit's one action this tick (O5), else its side action, else null. */
export function unitDecision<D extends { unit: string; action: { kind: string; op?: unknown } }>(decisions: readonly D[], unit: string, unitOf: (d: D) => string = (d) => d.unit): D | null {
  const mine = decisions.filter((d) => unitOf(d) === unit);
  return mine.find((d) => !isSideAction(d.action)) ?? mine[0] ?? null;
}

class Ctx {
  readonly decisions: Decision[] = [];
  private readonly taken = new Set<string>();
  private ids = 0;
  readonly nowIso: string;
  readonly heartbeat: string;
  agentsFree: number;
  /** stories with an integrate this tick (K6) */
  readonly integrating = new Set<string>();
  checksFree: number;
  private readonly slotsUsed: Set<number>;

  constructor(
    readonly facts: Facts,
    readonly workflows: RepoWorkflows,
    readonly config: ResolvedConfig,
  ) {
    this.nowIso = iso(facts.now);
    this.heartbeat = facts.machine.heartbeat_id ?? facts.tick_id;
    const leases = facts.machine.leases;
    this.agentsFree = config.max_agents - leases.filter((l) => l.kind === "agent").length;
    this.checksFree = config.max_checks - leases.filter((l) => l.kind === "check").length;
    this.slotsUsed = new Set(leases.filter((l) => l.kind === "slot" && l.slot !== undefined).map((l) => l.slot as number));
  }

  id(): string {
    return deriveUlid(this.facts.tick_id, this.ids++);
  }
  has(unit: string): boolean {
    return this.taken.has(unit);
  }
  emit(action: Action): void {
    // O5 (F5): an intake is about one story — key it by that story so `norn why <story>` finds it;
    // other repo-level actions (lease reclaim) stay `*`
    const unit = action.unit?.key ?? (action.kind === "intake_story" ? action.key : "*");
    // R1.1: a claim renewal rides along; it does not take the unit's one action
    if (action.unit && !isSideAction(action)) {
      if (this.taken.has(unit)) throw new Error(`decide: second action for ${unit} (${action.rule})`);
      this.taken.add(unit);
    }
    this.decisions.push({ unit, rule: action.rule, action });
  }
  noop(unit: UnitRef, rule: string, reason: string): void {
    this.emit({ kind: "noop", unit, rule, reason });
  }
  /** Next free port slot (K4), or null when the range is exhausted. */
  slot(): number | null {
    for (let s = this.config.slots.min; s <= this.config.slots.max; s++)
      if (!this.slotsUsed.has(s)) {
        this.slotsUsed.add(s);
        return s;
      }
    return null;
  }
  slotEnv(slot: number | null): Record<string, string> {
    if (slot === null) return {};
    const { port_base, ports_per_slot, env } = this.config.slots;
    const base = port_base + slot * ports_per_slot;
    const out: Record<string, string> = { NORN_SLOT: String(slot), PORT_BASE: String(base) };
    for (const [k, v] of Object.entries(env ?? {})) out[k] = v.replaceAll("{slot}", String(slot)).replaceAll("{port_base}", String(base));
    return out;
  }
}

export function decide(facts: Facts, workflows: RepoWorkflows, config: ResolvedConfig): Decision[] {
  const ctx = new Ctx(facts, workflows, config);
  const deadFiles = facts.machine.dead_lease_files ?? [];
  if (deadFiles.length) ctx.emit({ kind: "reclaim_leases", unit: null, rule: "leases.reclaim", files: [...deadFiles] });
  for (const story of queueOrder(facts.stories)) decideStory(ctx, story);
  intake(ctx);
  return ctx.decisions;
}

/** K1: oldest story by intake first (unknown intake last), then key. */
function queueOrder(stories: readonly StoryFacts[]): StoryFacts[] {
  const at = (s: StoryFacts) => (s.frontmatter ? epoch(s.frontmatter.intake_at) : Number.POSITIVE_INFINITY);
  return [...stories].sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
}

// ================================================================= repo level

function intake(ctx: Ctx): void {
  const { facts, config } = ctx;
  if (!facts.remote.issues) return;
  const known = new Set(facts.stories.map((s) => s.key));
  for (const issue of facts.remote.issues) {
    const provider = issue.provider;
    const key = storyKey(provider, issue.number);
    if (known.has(key) || issue.state !== "open") continue;
    const slug = slugify(issue.title);
    const branch = storyBranch(key, slug);
    const path = storyWorktreePath(facts.repo.root, key, slug);
    const labelled = issue.labels.find((l) => l.startsWith(WF_LABEL))?.slice(WF_LABEL.length);
    const workflow = labelled && ctx.workflows[labelled] ? labelled : config.default_workflow;
    const frontmatter: StoryFrontmatter = {
      id: key,
      slug,
      provider,
      number: issue.number,
      url: issue.url,
      title: issue.title,
      assignee: issue.assignees[0] ?? null,
      labels: [...issue.labels].sort(),
      workflow,
      status: "new",
      intake_at: ctx.nowIso,
      body_hash: sha256(issue.body),
    };
    const slot = ctx.slot();
    ctx.emit({
      kind: "intake_story",
      unit: null,
      rule: "remote.intake",
      issue,
      key,
      slug,
      worktree: { path, branch, from: facts.repo.default_branch, env: ctx.slotEnv(slot), slot },
      story_file: `${specDir(key, slug)}/story.md`,
      frontmatter,
      body: issue.body,
      commit: commitFor(ctx, key, null, `norn: intake ${key} ${issue.title}`, null, { path, branch, slice: null, push: false }),
    });
  }
}

// ================================================================= story level

const storyRef = (s: StoryFacts): UnitRef => storyUnit(s)?.unit ?? { story: s.key, slice: null, dir: "_story", key: s.key };

function decideStory(ctx: Ctx, story: StoryFacts): void {
  const ref = storyRef(story);
  const su = storyUnit(story);
  const claim = story.claim;
  const { facts } = ctx;

  // ---- claims (T1–T6, T10): act only on stories this heartbeat holds
  if (claim.state === "other") return ctx.noop(ref, "claim.other", `held by ${claim.blob.holder} until ${claim.blob.expires_at}`);
  if (claim.state === "corrupt") return ctx.noop(ref, "claim.corrupt", `claim ref ${claim.sha} is unreadable`);
  if (claim.state === "none" || claim.state === "expired") {
    const ours = claim.state === "expired" && claim.blob.heartbeat_id === ctx.heartbeat;
    const fresh = claim.state === "none" && !su?.state && story.frontmatter?.status === "new";
    // R3.2 (H6, A21): the base record wins over any local spec — a story the base records as done
    // (or whose PR merged) is never acquired by a stale local intake or a returning checkout. Only this
    // heartbeat's own expired claim (nobody took it since) is re-acquired for a merged PR whose record
    // is not yet done, so GR6 cleanup and the base record still happen.
    const baseDone = story.base_status === "done" || story.base_status === "dropped";
    if (baseDone || (mergedIntoBase(story, ctx.facts.repo.default_branch) && !ours))
      return ctx.noop(ref, "story.finished", baseDone ? `finished: ${ctx.facts.repo.default_branch} records it ${story.base_status} (R3.2); nothing to acquire` : "finished: PR merged (R3.2); nothing to acquire");
    // GR6: a finished story (workflow done, merged/recorded or dropped) needs no owner — never "unclaimed"
    if (!ours && !fresh && storyFinished(story)) return ctx.noop(ref, "story.finished", `finished (${story.frontmatter?.status === "done" || story.frontmatter?.status === "dropped" ? story.frontmatter.status : "workflow done"}); nothing to take`);
    if (!ours && !fresh) return ctx.noop(ref, "claim.unclaimed", `unclaimed — norn take ${story.key} (T10)`);
    return ctx.emit({
      kind: "claim",
      unit: ref,
      rule: fresh ? "claim.acquire.intake" : "claim.reacquire",
      op: "acquire",
      expected: claim.state === "expired" ? claim.sha : null,
      blob: claimBlob(ctx, story.key, null),
    });
  }
  // T4 + R1.1: renewal is a side action — emitted first (act renews before the story's other
  // actions, R1.2), it leaves the story's units their one action this tick (H4, A15)
  const renewAt = epoch(claim.blob.renewed_at) + parseDuration(ctx.config.claim.renew);
  if (facts.now >= renewAt)
    ctx.emit({ kind: "claim", unit: ref, rule: "claim.renew", op: "renew", expected: claim.sha, blob: claimBlob(ctx, story.key, claim.blob) });

  // ---- story file corrupt: never touch anything of the story (S2)
  if (story.frontmatter_error || !story.frontmatter) {
    const errors = story.frontmatter_error ? [story.frontmatter_error] : [{ file: `${story.spec_dir}/story.md`, errors: [{ path: "", message: "missing" }] }];
    if (!ctx.has(ref.key)) ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "story.corrupt", errors, notify: null });
    return;
  }
  const fm = story.frontmatter;
  const halted = su?.state?.park?.kind === "remote";

  if (!ctx.has(ref.key)) storyLifecycle(ctx, story, fm, su);
  if (!ctx.has(ref.key) && story.mailbox?.length) importMailbox(ctx, story);

  for (const uf of story.units) {
    if (ctx.has(uf.unit.key)) continue;
    decideUnit(ctx, story, uf, halted);
  }
}

function claimBlob(ctx: Ctx, story: string, prev: ClaimBlob | null): ClaimBlob {
  const expires = iso(ctx.facts.now + parseDuration(ctx.config.claim.lease));
  return {
    version: 1,
    story,
    holder: ctx.facts.machine.holder,
    heartbeat_id: ctx.heartbeat,
    acquired_at: prev?.acquired_at ?? ctx.nowIso,
    renewed_at: ctx.nowIso,
    expires_at: expires,
    last_tick_id: ctx.facts.tick_id,
  };
}

/** GR6 merged → cleanup; GR7 closed/unassigned/unlabelled → park "remote: …"; GR8 mirror + body change. */
function storyLifecycle(ctx: Ctx, story: StoryFacts, fm: StoryFrontmatter, su: UnitFacts | null): void {
  const ref = storyRef(story);
  // P2 (F34): merged when the PR says so, or when its head is already on the fetched base;
  // BS11: a PR merged into another branch than the base is not merged (parked below, GR7)
  if (mergedIntoBase(story, ctx.facts.repo.default_branch)) {
    if (fm.status === "done") return;
    const slices = story.slices.filter((s) => s.frontmatter);
    const sliceWts = story.units.filter((u) => u.unit.slice !== null && u.worktree?.exists).map((u) => (u.worktree as { path: string }).path);
    const sliceBranches = slices.map((s) => sliceBranch(story.key, s.nn, s.slug));
    return ctx.emit({
      kind: "cleanup_merged_story",
      unit: ref,
      rule: "remote.pr_merged",
      worktrees: [...(story.worktree?.exists ? [story.worktree.path] : []), ...sliceWts],
      local_branches: [...sliceBranches, story.branch],
      remote_branches: sliceBranches,
      refs: [`refs/norn/claims/${story.key}`, ...(story.mailbox ?? []).map((m) => m.ref)],
      story_status: "done",
    });
  }
  const st = su?.state;
  const reason = remoteProblem(story, ctx.config.remote.label, ctx.facts.repo.default_branch);
  // GR7: a remote problem parks the story unit through the one park path (stuck, kind remote)
  if (reason && st && st.park?.kind !== "remote" && st.status !== "corrupt") return park(ctx, story, su as UnitFacts, st, "remote", reason, "remote.park");
  const refinedHash = story.issue ? sha256(story.issue.body) : fm.body_hash;
  if (!fm.refined_body_hash && refinedHash && refineFinished(su)) {
    // GR8: record the remote body as of refine finishing, so a later body change surfaces in the inbox
    const fields: UpdateStoryMirrorAction["fields"] = { refined_body_hash: refinedHash };
    if (refinedHash !== fm.body_hash) fields.body_hash = refinedHash;
    return ctx.emit({
      kind: "update_story_mirror",
      unit: ref,
      rule: "remote.mirror.refined",
      fields,
      notify: null,
      commit: commitFor(ctx, story, su, `norn: ${story.key} refine finished (record body hash)`, su?.state?.step ?? null),
    });
  }
  if (story.issue) mirror(ctx, story, fm, su, story.issue);
}

/** GR8: the story unit has left a step whose skill is `refine` (cursor elsewhere, or re-entered later). */
function refineFinished(uf: UnitFacts | null): boolean {
  const st = uf?.state;
  const wf = uf?.workflow;
  if (!st || !wf) return false;
  return Object.entries(wf.steps).some(([name, step]) => step.type === "agent" && step.skill === "refine" && ((st.visits[name] ?? 0) >= 2 || ((st.visits[name] ?? 0) >= 1 && st.step !== name)));
}

function remoteProblem(story: StoryFacts, label: string, base: string): string | null {
  if (story.pr?.state === "closed") return "remote: PR closed unmerged";
  // BS11 (old norn 0.1.1): a merge into the wrong base skipped story review — park, never clean up
  if (story.pr?.state === "merged" && !mergedIntoBase(story, base)) return `remote: PR merged into ${prBaseBranch(story.pr)}, not ${base}`;
  const issue = story.issue;
  if (issue === undefined) return null;
  if (issue === null) return "remote: issue closed, unassigned or unlabelled";
  if (issue.state === "closed") return "remote: issue closed";
  if (!issue.labels.includes(label)) return `remote: label '${label}' removed`;
  if (!issue.assignees.length) return "remote: issue unassigned";
  return null;
}

function mirror(ctx: Ctx, story: StoryFacts, fm: StoryFrontmatter, su: UnitFacts | null, issue: RemoteIssue): void {
  const fields: Partial<Pick<StoryFrontmatter, "title" | "assignee" | "url" | "labels" | "body_hash">> = {};
  if (issue.title !== fm.title) fields.title = issue.title;
  if (issue.url !== fm.url) fields.url = issue.url;
  if (!(fm.assignee && issue.assignees.includes(fm.assignee))) {
    const a = issue.assignees[0] ?? null;
    if (a !== fm.assignee) fields.assignee = a;
  }
  const labels = [...issue.labels].sort();
  if (fm.labels && JSON.stringify([...fm.labels].sort()) !== JSON.stringify(labels)) fields.labels = labels;
  const bodyHash = sha256(issue.body);
  if (bodyHash !== fm.body_hash) fields.body_hash = bodyHash;
  if (!Object.keys(fields).length) return;
  const changed = fields.body_hash ? bodyChangedItem({ ...story, frontmatter: { ...fm, body_hash: bodyHash } }) : null;
  const ref = storyRef(story);
  ctx.emit({
    kind: "update_story_mirror",
    unit: ref,
    rule: changed ? "remote.mirror.body_changed" : "remote.mirror",
    fields,
    notify: changed,
    commit: commitFor(ctx, story, su, `norn: mirror ${story.key} from the remote issue`, su?.state?.step ?? null),
  });
}

/** T9: copy one mailbox receipt into the unit whose cursor it matches, or reject it. */
function importMailbox(ctx: Ctx, story: StoryFacts): void {
  const item = (story.mailbox ?? [])[0];
  if (!item) return;
  const ref = storyRef(story);
  const reject = (reason: string) => ctx.emit({ kind: "reject_receipt", unit: ref, rule: "mailbox.reject", source: { ref: item.ref, sha: item.sha }, reason, state: null });
  if (!item.receipt) return reject(item.error ? `invalid receipt: ${item.error.errors.map((e) => e.message).join("; ")}` : "unreadable receipt");
  const r = item.receipt;
  const atCursor = (u: UnitFacts) => !!u.state && u.state.step === r.step && u.state.attempt === r.attempt && !u.errors.length;
  let target: UnitFacts | undefined;
  if (r.slice !== undefined) {
    // routed by unit when the receipt names one (story unit = null)
    const unit = story.units.find((u) => u.unit.slice === r.slice);
    if (!unit) return reject(`no unit ${r.slice ?? story.key} in story ${story.key}`);
    if (!atCursor(unit)) return reject(`stale: ${unit.unit.key} is not at ${r.step}#${r.attempt}`);
    target = unit;
  } else {
    const matches = story.units.filter(atCursor);
    target = matches.find((u) => u.state?.status === "parked" || u.state?.status === "stuck") ?? matches[0];
  }
  if (!target || ctx.has(target.unit.key)) return target ? undefined : reject(`no unit at ${r.step}#${r.attempt}`);
  ctx.emit({
    kind: "import_mailbox",
    unit: target.unit,
    rule: "mailbox.import",
    refs: [{ ref: item.ref, sha: item.sha }],
    receipts: [{ n: nextReceiptNumber(target), receipt: r }],
    state: null,
    commit: commitFor(ctx, story, target, `norn: ${target.unit.key} ${r.kind} from mailbox`, r.step),
  });
}

// ================================================================= unit level

const nextReceiptNumber = (uf: UnitFacts): number =>
  Math.max(uf.state?.applied_through ?? 0, ...uf.unapplied.map((r) => r.n), uf.last_check?.n ?? 0, uf.last_findings?.n ?? 0) + 1;

/** H1: a merge, rebase, cherry-pick or revert (or unmerged paths) in progress in the unit's worktree. */
const gitBusy = (uf: UnitFacts): boolean => !!uf.worktree?.in_progress && (!!uf.worktree.in_progress.operation || uf.worktree.in_progress.unmerged.length > 0);

function unitBranch(story: StoryFacts, uf: UnitFacts | null): string {
  if (!uf || uf.unit.slice === null) return story.branch;
  const file = sliceFileOf(story, uf.unit.slice);
  return uf.worktree?.status?.branch ?? (file ? sliceBranch(story.key, file.nn, file.slug) : `${story.key}/${uf.unit.dir}`);
}

const sliceFileOf = (story: StoryFacts, key: string): SliceFileFacts | undefined => story.slices.find((s) => s.key === key);

/**
 * S4: the trailers of every commit norn makes for a unit — Norn-Story, Norn-Slice for a slice,
 * Norn-Step when the unit has a cursor (none before the story unit starts), Norn-Tick.
 */
function trailersFor(ctx: Ctx, story: string, slice: string | null, step: string | null): Record<string, string> {
  const trailers: Record<string, string> = { "Norn-Story": story };
  if (slice) trailers["Norn-Slice"] = slice;
  if (step !== null) trailers["Norn-Step"] = step;
  trailers["Norn-Tick"] = ctx.facts.tick_id;
  return trailers;
}

/** A worktree act creates this tick (intake, slice start): the commit goes there, not to an observed one. */
interface NewWorktree {
  path: string;
  branch: string;
  slice: string | null;
  /** S8/T7: an intake is not pushed until the claim is held */
  push: boolean;
}

/**
 * S4, S8: the boundary commit for a unit at `step` — in the unit's worktree (no worktree, no commit),
 * or in the worktree `fresh` that act creates first. `uf` null is the story unit without facts yet
 * (a story nobody started); `story` is only a key for a story intake creates.
 */
function commitFor(ctx: Ctx, story: StoryFacts | string, uf: null, message: string, step: string | null, fresh: NewWorktree): BoundaryCommit;
function commitFor(ctx: Ctx, story: StoryFacts, uf: UnitFacts | null, message: string, step: string | null): BoundaryCommit | null;
function commitFor(ctx: Ctx, story: StoryFacts | string, uf: UnitFacts | null, message: string, step: string | null, fresh?: NewWorktree): BoundaryCommit | null {
  const key = typeof story === "string" ? story : story.key;
  if (fresh) return { cwd: fresh.path, branch: fresh.branch, message, trailers: trailersFor(ctx, key, fresh.slice, step), push: fresh.push };
  if (typeof story === "string") return null;
  const cwd = unitWorktree(story, uf);
  if (!cwd) return null;
  return { cwd, branch: unitBranch(story, uf), message, trailers: trailersFor(ctx, key, uf?.unit.slice ?? null, step), push: true };
}

function unitItem(ctx: Ctx, story: StoryFacts, uf: UnitFacts, state: UnitState): InboxItem | null {
  return unitInboxItem(story, { ...uf, state }, ctx.facts, ctx.config);
}

function applyCtx(ctx: Ctx, wf: Workflow) {
  return { workflow: wf, now: ctx.nowIso, limits: ctx.config.limits, tick_id: ctx.facts.tick_id };
}

/** The receipt header fields `nornReceipt` fills in; `run_id`, `by` and `who` may be overridden. */
type ReceiptHeader = "kind" | "receipt_id" | "run_id" | "step" | "attempt" | "at" | "by" | "who" | "tick_id";

/**
 * A receipt norn writes this tick at the unit's cursor (P6): its id derived from the tick
 * (`ctx.id()`, so `norn why` replays it), at `facts.now`, by norn on this machine, no run unless
 * `fields` names one. `fields` may also set `by`/`who` (R6.1: an answer recorded for the agent).
 */
function nornReceipt<K extends Receipt["kind"]>(
  ctx: Ctx,
  st: UnitState,
  kind: K,
  fields: Omit<ReceiptOf<K>, ReceiptHeader> & Partial<Pick<Receipt, "run_id" | "by" | "who">>,
): ReceiptOf<K> {
  return {
    kind,
    receipt_id: ctx.id(),
    run_id: null,
    step: st.step,
    attempt: st.attempt,
    at: ctx.nowIso,
    by: "norn",
    who: ctx.facts.machine.holder,
    tick_id: ctx.facts.tick_id,
    ...fields,
  } as ReceiptOf<K>;
}

/**
 * S6: apply `receipt`, numbered `n`, in memory after `prior` (unapplied receipts, R5.2) — the
 * state the act commits once the receipt is written. `nr` is the receipt as the action carries it.
 */
function synth(ctx: Ctx, st: UnitState, wf: Workflow, n: number, receipt: Receipt, prior: readonly NumberedReceipt[] = []): { nr: NewReceipt; res: ApplyResult } {
  return { nr: { n, receipt }, res: applyReceipts(st, [...prior, { n, file: "", receipt }], applyCtx(ctx, wf)) };
}

/** An `apply_receipts` action for `res` (C2, S5): the receipts written this tick, the state, the boundary commit. */
function emitApplied(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  rule: string,
  res: ApplyResult,
  receipts: NewReceipt[],
  commit: { message: string; step: string },
  o: { input?: SessionInput | null; launch?: AgentLaunch | null; kill?: SessionRef | null; state?: UnitState } = {},
): void {
  ctx.emit({
    kind: "apply_receipts",
    unit: uf.unit,
    rule,
    applied: res.applied,
    rejected: res.rejected,
    advance: res.advance,
    input: o.input ?? null,
    launch: o.launch ?? null,
    kill: o.kill ?? null,
    receipts,
    state: o.state ?? res.state,
    commit: commitFor(ctx, story, uf, commit.message, commit.step),
  });
}

function decideUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, halted: boolean): void {
  const ref = uf.unit;
  if (uf.errors.length) {
    if (uf.state?.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched (S2)");
    const notify = unitItem(ctx, story, uf, uf.state as UnitState);
    return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.corrupt", errors: uf.errors, notify });
  }
  const st = uf.state;
  if (!st) {
    if (ref.slice !== null) return ctx.noop(ref, "slice.not_started", "started by the story's slices step (W2)");
    return startStoryUnit(ctx, story, uf);
  }
  if (st.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched (S2)");
  const wf = uf.workflow;
  if (!wf) return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.workflow_missing", errors: [{ file: `runs/${ref.dir}/workflow.yaml`, errors: [{ path: "", message: "pinned workflow missing" }] }], notify: null });

  // R5.1: a run whose launch is unknown is looked for before anything else is decided for the unit
  if (uf.run?.launch_unknown) return launchUnknown(ctx, story, uf, st, wf);
  // C2: receipts first — they always win over runner facts
  if (uf.unapplied.length) return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");

  // S7: pinned workflow edited outside `norn workflow`, or cursor step gone
  if (st.status !== "stuck" || st.park?.kind !== "workflow") {
    const drift = uf.workflow_hash && uf.workflow_hash !== st.workflow_hash ? "pinned workflow.yaml changed outside norn workflow (S7)" : null;
    const gone = st.step !== "$done" && !stepOf(wf, st.step) ? `step '${st.step}' no longer exists in workflow ${wf.name} (S7)` : null;
    const reason = drift ?? gone;
    if (reason) return park(ctx, story, uf, st, "workflow", reason, "workflow.drift");
  }
  // BS5.1 (H1, dogfood D3): while a git operation is in progress in the worktree (an agent's merge)
  // the owed commit cannot happen — act would only defer it — so it never takes the unit's action:
  // liveness, implicit asks and deadlines are still decided below; the commit follows the merge
  if (uf.uncommitted && !gitBusy(uf)) {
    const commit = commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} (recovered commit)`, st.step);
    if (commit) return ctx.emit({ kind: "commit_push", unit: ref, rule: "recover.commit", commit });
  }

  switch (st.status) {
    case "done":
      if (ref.slice !== null && sliceFileOf(story, ref.slice)?.frontmatter?.status !== "integrated") {
        const wt = uf.worktree?.exists ? uf.worktree.path : null;
        const file = sliceFileOf(story, ref.slice);
        return ctx.emit({
          kind: "mark_done",
          unit: ref,
          rule: "slice.done.cleanup",
          cleanup: { worktree: wt, branch_local: file ? sliceBranch(story.key, file.nn, file.slug) : null, release_slot: true },
          slice_status: "integrated",
          receipts: [],
          state: null,
          commit: null,
        });
      }
      return ctx.noop(ref, ref.slice ? "slice.done" : "story.wait_merge", ref.slice ? "integrated" : "workflow done; waiting for the PR merge (GR6)");
    case "stuck":
      if (slicesCanResume(story, uf, st, wf)) return resumeSlices(ctx, story, uf, st, wf);
      return ctx.noop(ref, "unit.stuck", `stuck: ${st.park?.reason ?? "?"} — norn unstick ${ref.key}`);
    case "parked": {
      // R6.1 (H3, A14): an implicit ask a later fact shows the agent has moved past resolves itself
      const moved = implicitAskResolved(st, uf);
      if (moved) return resolveImplicitAsk(ctx, story, uf, st, wf, moved);
      // BS6–BS8: a story waiting at a gate with a `stale` route goes back to update when the base moved under it
      if (ref.slice === null && st.park?.kind === "gate" && story.base && edgeOf(wf, st.step, "stale") && isStale(wf, story.base)) {
        const b = story.base;
        const detail = `${b.behind} behind, conflicts: ${b.conflicts.length ? b.conflicts.join(", ") : "none"}`;
        return classifyNorn(ctx, story, uf, st, wf, "stale", "gate.stale", detail, { receiptRule: "base moved", base: baseOf(b) });
      }
      // T6: parked keeps the claim; C3: a restart never answers
      return ctx.noop(ref, `unit.parked.${st.park?.kind ?? "?"}`, st.park?.reason ?? "parked");
    }
  }

  const step = stepOf(wf, st.step);
  if (!step) return ctx.noop(ref, "unit.no_step", st.step);
  if (halted && st.status === "ready") return ctx.noop(ref, "story.halted", "story parked on a remote change (GR7)");
  switch (step.type) {
    case "agent":
      return st.status === "running" ? classifyRun(ctx, story, uf, st, wf, step) : startRun(ctx, story, uf, st, wf, step);
    case "check":
      return runCheck(ctx, story, uf, st, step.run, parseDuration(step.timeout));
    case "git":
      return runGit(ctx, story, uf, st, wf, step);
    case "gate":
      return ctx.noop(ref, "gate.wait", "waiting for approve / reject");
    case "slices":
      return slicesStep(ctx, story, uf, st, wf);
  }
}

function applyAction(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, receipts: readonly NumberedReceipt[], rule: string): void {
  const res = applyReceipts(st, receipts, applyCtx(ctx, wf));
  let state = res.state;
  let input: SessionInput | null = null;
  let launch: AgentLaunch | null = null;
  const extra: NewReceipt[] = [];
  const run = res.state.run;
  if (res.deliver && run?.session) {
    // B2: type the answer into the same session while it lives and takes input. A headless session
    // has no pane (and its process ends with the turn): continue the same agent session with
    // `--resume <agent_session_id>` and the answer as the prompt. Without a resumable id, a fresh
    // session for the step starts from the handoff.
    const rf = uf.run?.run_id === run.run_id ? uf.run : null;
    const gone = rf?.process_alive === false || rf?.pane?.alive === false;
    // R7.2: a session on another machine is neither typed into nor resumed here (its agent session
    // lives there); R4.1: typing needs a runner that can `send`
    const foreign = foreignRun(ctx, run);
    const caps = runnerCaps(ctx);
    if (!foreign && caps.send && run.session.runner !== "headless" && !gone) {
      input = { run_id: run.run_id, session: sessionRef(run), text: res.deliver };
      // R6.2: an implicit pane prompt takes keystrokes (option number / arrows + enter), not a pasted prompt
      if (st.park?.kind === "ask" && st.park.implicit === "pane") input.keys = promptKeys(st.park, res.deliver).keys;
    }
    else {
      const step = stepOf(wf, res.state.step);
      const resumeId = foreign ? undefined : resumeIdOf(run, rf);
      const cwd = unitWorktree(story, uf);
      if (step?.type === "agent" && resumeId && cwd && ctx.facts.machine.runner) {
        // R5.3: the resumed run is the answered one; any other active run of the step blocks it
        const active = activeRun(ctx, uf, run.run_id);
        if (active) return ctx.noop(uf.unit, "answer.resume.wait_active", `run ${active} of ${res.state.step} still shows hook activity (R5.3)`);
        const resumed = resumeLaunch(ctx, story, uf, res.state, wf, step, run, { resumeId, cwd, prompt: res.deliver, n: nextReceiptNumber(uf) });
        if (!resumed) return ctx.noop(uf.unit, "answer.resume.queued", `answer waits: max_agents ${ctx.config.max_agents} in use (K1)`);
        extra.push(resumed.receipt);
        ({ state, launch } = resumed);
      } else state = { ...res.state, status: "ready", run: null };
    }
  }
  // S7/O2: `workflow --to` / `unstick` re-enter a step: the old run's session must not keep working
  const moved = res.applied.some((n) => {
    const k = receipts.find((r) => r.n === n)?.receipt.kind;
    return k === "workflow" || k === "unstick";
  });
  const kill = moved && st.run?.session && state.run?.run_id !== st.run.run_id ? sessionRef(st.run) : null;
  const what = res.advance ? `${res.advance.from}.${res.advance.outcome} → ${res.advance.to}${res.advance.reset ? ` (reset ${res.advance.reset.join(", ")})` : ""}` : (res.log.at(-1) ?? "receipts");
  const applied = !res.applied.length ? "receipts.reject" : launch ? `${rule}.resume` : rule;
  emitApplied(ctx, story, uf, applied, res, extra, { message: `norn: ${uf.unit.key} ${what}`, step: st.step }, { input, launch, kill, state });
}

function sessionRef(run: NonNullable<UnitState["run"]>): SessionRef {
  const s = run.session as NonNullable<typeof run.session>;
  const ref: SessionRef = { runner: s.runner, session_id: s.session_id };
  if (s.pane_id) ref.pane_id = s.pane_id;
  if (run.process) ref.process = run.process;
  return ref;
}

function park(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, kind: "workflow" | "stuck" | "remote", reason: string, rule: string): void {
  const state: UnitState = { ...st, status: "stuck", park: { kind, reason, since: ctx.nowIso }, updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id };
  ctx.emit({
    kind: "park",
    unit: uf.unit,
    rule,
    park: state.park as NonNullable<UnitState["park"]>,
    notify: unitItem(ctx, story, uf, state),
    receipts: [],
    state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} stuck (${reason})`, st.step),
  });
}

// ---------------------------------------------------------------- start

function startStoryUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts): void {
  const fm = story.frontmatter as StoryFrontmatter;
  const loaded = usableWorkflow(ctx, fm.workflow, "story");
  if ("problem" in loaded) {
    return ctx.emit({
      kind: "notify",
      unit: uf.unit,
      rule: "start.workflow_invalid",
      item: { id: `workflow:${story.key}:${fm.workflow}:${sha256(loaded.problem)}`, group: "unblock", story: story.key, slice: null, step: null, title: loaded.problem, command: `norn workflow ${story.key} <name>`, since: ctx.nowIso, url: fm.url },
    });
  }
  const worktree = unitWorktree(story, uf);
  if (!worktree) return ctx.noop(uf.unit, "start.no_worktree", "story worktree missing (GR2)");
  const state = initialState({ unit: uf.unit, workflow: loaded.workflow, workflowName: fm.workflow, workflowHash: sha256(loaded.source), now: ctx.nowIso, mode: story.mode, tick_id: ctx.facts.tick_id });
  ctx.emit({
    kind: "start_unit",
    unit: uf.unit,
    rule: "story.start",
    workflow: fm.workflow,
    workflow_source: loaded.source,
    worktree: null,
    slice_status: null,
    receipts: [],
    state,
    commit: commitFor(ctx, story, uf, `norn: start ${story.key} (${fm.workflow})`, state.step),
  });
}

function usableWorkflow(ctx: Ctx, name: string, level: UnitLevel): { workflow: Workflow; source: string } | { problem: string } {
  const lw = ctx.workflows[name];
  if (!lw) return { problem: `workflow '${name}' not found` };
  const issues = [...lw.issues, ...(lw.workflow ? checkWorkflowLevel(lw.workflow, level) : [])];
  if (!lw.workflow || issues.length) return { problem: `workflow '${name}' is invalid: ${issues.map((i) => i.message).join("; ") || "schema"}` };
  return { workflow: lw.workflow, source: lw.source };
}

// ---------------------------------------------------------------- agent steps

function launchFor(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, step: AgentStep, run_id: string, cwd: string): AgentLaunch {
  const agent = step.agent ?? ctx.config.default_agent;
  const env: Record<string, string> = { NORN_STORY: story.key, NORN_RUN: run_id };
  if (uf.unit.slice) env.NORN_SLICE = uf.unit.slice;
  Object.assign(env, ctx.slotEnv(uf.worktree?.slot ?? null));
  const launch: AgentLaunch = { run_id, agent, cwd, prompt: AUTO_PROMPT, env, title: `${uf.unit.key} ${st.step}` };
  const model = step.model ?? ctx.config.agents[agent]?.model;
  if (model) launch.model = model;
  return launch;
}

function startedReceipt(ctx: Ctx, st: UnitState, step: AgentStep, run_id: string, worktree: string, retry: boolean): ReceiptOf<"started"> {
  const agent = step.agent ?? ctx.config.default_agent;
  const r = nornReceipt(ctx, st, "started", {
    run_id,
    how: "auto",
    agent,
    worktree,
    // R7.1: where and by whom the run was launched (liveness is judged on that machine only, R7.2)
    machine: ctx.facts.machine.holder,
    heartbeat_id: ctx.heartbeat,
  });
  const model = step.model ?? ctx.config.agents[agent]?.model;
  if (model) r.model = model;
  if (retry) r.retry = true;
  return r;
}

function startRun(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: AgentStep): void {
  const ref = uf.unit;
  const { mode, downgraded } = effectiveMode(story.mode, !!step.attended, ctx.facts.machine.runner);
  if (mode === "manual")
    return ctx.noop(ref, downgraded ? "agent.ready.manual.no_runner" : "agent.ready.manual", downgraded ? "auto requested, no runner; running manual (MO2)" : "ready: a person starts an agent and runs norn brief");
  const cwd = unitWorktree(story, uf);
  if (!cwd) return ctx.noop(ref, "agent.no_worktree", "unit worktree missing");
  // R5.3 (A14b): never a second agent beside a run of this step that is still active
  const active = activeRun(ctx, uf, null);
  if (active) return ctx.noop(ref, "agent.start.wait_active", `run ${active} of ${st.step}#${st.attempt} still shows hook activity; no new run beside it (R5.3)`);
  if (ctx.agentsFree <= 0) return ctx.noop(ref, "agent.queued", `queued: max_agents ${ctx.config.max_agents} in use (K1)`);
  ctx.agentsFree--;
  const run_id = ctx.id();
  const receipt = startedReceipt(ctx, st, step, run_id, cwd, st.retries_used > 0);
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  ctx.emit({
    kind: "start_run",
    unit: ref,
    rule: st.retries_used > 0 ? "agent.start.retry" : "agent.start",
    step: st.step,
    launch: launchFor(ctx, story, uf, st, step, run_id, cwd),
    receipts: [nr],
    state: res.state,
    // R2.1 (N6): the started receipts reach the record in the launch tick, not by a recover.commit
    commit: commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} started (run ${run_id})`, st.step),
  });
}

/** R7.2 (M4, N5): a run launched on another machine — its pid, pane and session mean nothing here. */
function foreignRun(ctx: Ctx, run: NonNullable<UnitState["run"]>): boolean {
  return !!run.machine && run.machine !== ctx.facts.machine.holder;
}

/** R4.1: this machine's runner capabilities; unknown = send only (the behaviour before R4). */
function runnerCaps(ctx: Ctx): RunnerCapabilities {
  return ctx.facts.machine.runner_capabilities ?? { send: true, resume: false };
}

/**
 * R5.3 (A14b): a run of the cursor step/attempt, other than `except`, with hook activity within the
 * stalled window — no new run (start, retry, answer or nudge resume) starts beside it. Runs seen
 * ending (`session_end`, classified `died`) or observed dead this tick do not count.
 */
function activeRun(ctx: Ctx, uf: UnitFacts, except: string | null): string | null {
  const window = parseDuration(ctx.config.limits.stalled);
  const dead = uf.run && (uf.run.process_alive === false || uf.run.pane?.alive === false) ? uf.run.run_id : null;
  for (const r of uf.step_runs ?? []) {
    if (r.run_id === except || r.run_id === dead || r.ended || r.last_hook_at === null) continue;
    if (ctx.facts.now - r.last_hook_at <= window) return r.run_id;
  }
  return null;
}

/** Agent-tool session id to `--resume` a run with (B2): recorded in state, else the newest hook's. */
function resumeIdOf(run: NonNullable<UnitState["run"]>, rf: UnitFacts["run"]): string | undefined {
  return run.agent_session_id ?? (rf?.run_id === run.run_id ? rf.hooks.findLast((h) => h.agent_session_id)?.agent_session_id : undefined);
}

/**
 * B2/R4.2: continue `run`'s agent session with `--resume <resumeId>` and `prompt` (an answer or the
 * nudge text): a `started` receipt numbered `n` for the same run, and the launch. Answer and nudge
 * resume share it, so they share one lease rule (K1): the run's own agent lease is still held by
 * the run being resumed, so it does not count against max_agents; any other resume takes a free
 * agent slot. Null when none is free — the caller queues.
 */
function resumeLaunch(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  st: UnitState,
  wf: Workflow,
  step: AgentStep,
  run: NonNullable<UnitState["run"]>,
  o: { resumeId: string; cwd: string; prompt: string; n: number },
): { receipt: NewReceipt; state: UnitState; launch: AgentLaunch } | null {
  const ownLease = uf.lease?.kind === "agent" && uf.lease.run_id === run.run_id;
  if (!ownLease) {
    if (ctx.agentsFree <= 0) return null;
    ctx.agentsFree--;
  }
  const started: ReceiptOf<"started"> = { ...startedReceipt(ctx, st, step, run.run_id, o.cwd, false), agent_session_id: o.resumeId, ...(run.agent ? { agent: run.agent } : {}) };
  const { nr, res } = synth(ctx, st, wf, o.n, started);
  const launch: AgentLaunch = { ...launchFor(ctx, story, uf, st, step, run.run_id, o.cwd), prompt: o.prompt, resume: o.resumeId };
  if (run.agent) launch.agent = run.agent;
  return { receipt: nr, state: res.state, launch };
}

/** §10 classification of a live agent run from facts (C1, C2, MO4). */
function classifyRun(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: AgentStep): void {
  const ref = uf.unit;
  const run = st.run;
  const rf = uf.run;
  if (!run) return ctx.noop(ref, "agent.running.no_run", "running without a run record");
  if (!rf || rf.run_id !== run.run_id) return ctx.noop(ref, "agent.running.unobserved", `no facts for run ${run.run_id}`);
  const now = ctx.facts.now;
  const touched = Math.max(epoch(run.started_at), epoch(st.updated_at));
  const lastHook = rf.hooks.at(-1);
  const hookAt = lastHook ? epoch(lastHook.at) : 0;
  const stalledMs = parseDuration(ctx.config.limits.stalled);

  // R7.2: process and pane liveness only for runs started on this machine
  const foreign = foreignRun(ctx, run);
  if (foreign && run.heartbeat_id !== ctx.heartbeat) {
    // the story was taken from the heartbeat that launched it: judged by its hooks and the claim alone
    const takenAt = story.claim.state === "mine" ? epoch(story.claim.blob.acquired_at) : 0;
    if (now - Math.max(touched, hookAt, takenAt) > stalledMs) return routeOutcome(ctx, story, uf, st, wf, step, { outcome: "died", rule: "agent.died.foreign", detail: "foreign run, holder changed" }, []);
    return ctx.noop(ref, "agent.running.foreign", `run ${run.run_id} started on ${run.machine}; no hook activity yet for ${ctx.config.limits.stalled} after the take (R7.2)`);
  }
  const died = !foreign && (rf.process_alive === false || rf.pane?.alive === false);
  let outcome: string | null = null;
  let rule = "";
  let detail: string | undefined;
  if (died) [outcome, rule, detail] = ["died", "agent.died", diedDetail(rf, now - epoch(run.started_at))];
  else if (!step.attended) {
    const waiting = (rf.pane?.state === "waiting_input" && (rf.pane.since ?? touched + 1) > touched) || (lastHook && (lastHook.event === "waiting_input" || lastHook.event === "permission_prompt") && hookAt > touched);
    const deadline = parseDuration(step.deadline ?? ctx.config.limits.deadline);
    const turnEnded =
      (lastHook && (lastHook.event === "turn_end" || lastHook.event === "session_end") && hookAt > touched) ||
      ((rf.pane?.state === "idle" || rf.pane?.state === "done") && (rf.pane.since ?? 0) > touched);
    if (waiting) return implicitAsk(ctx, story, uf, st, wf, rf, lastHook);
    // R9.1 (M6, A11): the agent session started but never took its launch prompt
    const launch = launchPromptCheck(ctx, story, uf, st, rf);
    if (launch === "acted") return;
    if (launch) [outcome, rule, detail] = launch;
    // the deadline runs from the run's start, not the last state write; after a timeout nudge the
    // agent gets the stalled window before the next one (otherwise every tick would nudge again)
    const started = epoch(run.started_at);
    const lastTimeout = st.last_outcome?.outcome === "timeout" && st.last_outcome.step === st.step && epoch(st.last_outcome.at) >= started ? epoch(st.last_outcome.at) : null;
    const overdue = now - started > deadline && (lastTimeout === null || now - lastTimeout > stalledMs);
    if (outcome) {
      // R9.1 classified it
    } else if (overdue) [outcome, rule, detail] = ["timeout", "agent.timeout", `deadline ${step.deadline ?? ctx.config.limits.deadline} passed`];
    else if (turnEnded) [outcome, rule, detail] = ["silent", "agent.silent", "turn ended without a receipt"];
    else if (now - Math.max(rf.last_activity_at ?? 0, touched) > stalledMs) [outcome, rule, detail] = ["stalled", "agent.stalled", `no activity for ${ctx.config.limits.stalled}`];
  }
  if (!outcome) return ctx.noop(ref, step.attended ? "agent.attended.running" : "agent.running", `run ${run.run_id} in progress`);
  routeOutcome(ctx, story, uf, st, wf, step, { outcome, rule, ...(detail ? { detail } : {}) }, []);
}

/** B3: a run that died before it got going (no hook yet, or within a minute) shows what it printed. */
const EARLY_DEATH_MS = 60_000;
function diedDetail(rf: RunFacts, sinceStart: number): string {
  const early = rf.hooks.length === 0 || sinceStart <= EARLY_DEATH_MS;
  return rf.output && early ? `process gone, no receipt; it printed: ${rf.output}` : "process gone, no receipt";
}

interface Classified {
  outcome: string;
  /** decide rule id, recorded in the classify receipt */
  rule: string;
  detail?: string;
}

/**
 * Write a classify receipt for the unit's run and take its route (C1): nudge (R4.2: `send`, else
 * `resume`, else a counted retry), retry in a fresh session, park or `$stuck`. `prior` are unapplied
 * receipts applied first (R5.2: the `started` receipt of a run whose launch is unknown).
 */
function routeOutcome(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st0: UnitState, wf: Workflow, step: AgentStep, c: Classified, prior: readonly NumberedReceipt[]): void {
  const ref = uf.unit;
  const { outcome, rule, detail } = c;
  const st = prior.length ? applyReceipts(st0, prior, applyCtx(ctx, wf)).state : st0;
  const run = st.run as NonNullable<UnitState["run"]>;
  const rf = uf.run?.run_id === run.run_id ? uf.run : null;
  const n = nextReceiptNumber(uf);
  const receipt = nornReceipt(ctx, st, "classify", { run_id: run.run_id, outcome, rule, route: "park" });
  if (detail) receipt.detail = detail;
  const applyWith = (r: ReceiptOf<"classify">) => synth(ctx, st0, wf, n, r, prior).res;
  let res = applyWith(receipt);
  const foreign = foreignRun(ctx, run);
  // R7.2: a session on another machine is never typed into or killed from here
  const session = run.session && !foreign ? sessionRef(run) : null;
  const { mode } = effectiveMode(story.mode, !!step.attended, ctx.facts.machine.runner);
  const cwd = unitWorktree(story, uf);
  const caps = runnerCaps(ctx);
  const local = !!session && session.runner === ctx.facts.machine.runner;
  const resumeId = resumeIdOf(run, rf);
  if (res.route === "nudge" && mode === "auto" && local && !caps.send && !(caps.resume && resumeId && cwd)) {
    // R4.2: this runner can neither type into the session nor resume it — a fresh session instead,
    // counted as a retry, not a nudge
    receipt.route = "retry";
    res = applyWith(receipt);
  }
  // §10, W4: the route is where applying the receipt sent the unit (an exhausted counter → $stuck)
  receipt.route = routeOf(res) ?? "park";
  if (res.route === "nudge") receipt.counter = { name: "nudges", value: res.state.nudges_used, max: step.nudges ?? ctx.config.limits.nudges };
  if (res.route === "retry") receipt.counter = { name: "retries", value: res.state.retries_used, max: step.retries ?? ctx.config.limits.retries };
  const commit = commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} ${outcome} → ${receipt.route}`, st.step);
  const snapshot = outcome === "silent" ? { transcript: rf?.transcript ?? null, cwd: cwd ?? "" } : null;
  const receipts: NewReceipt[] = [{ n, receipt }];

  if (res.route === "nudge") {
    // C1 in manual effective mode (or when no session on this machine takes input): norn types
    // into nobody's session. The silent/timeout/stalled outcome is still counted — so the
    // C1 route to `$stuck` after max still holds — but instead of an undelivered nudge the unit
    // shows an inbox item (unitInboxItem: "agent ended its turn without reporting — reopen the
    // agent and run norn brief"), notified once per counted nudge (O3).
    if (mode === "auto" && local && session) {
      // R4.2: type into the live session when the runner can …
      if (caps.send) return ctx.emit({ kind: "nudge", unit: ref, rule: `${rule}.nudge`, input: { run_id: run.run_id, session, text: NUDGE_TEXT }, launch: null, kill: null, snapshot, receipts, state: res.state, commit });
      // … else resume the agent session with the nudge text (the B2 answer path), the old process killed first
      const resumed = resumeLaunch(ctx, story, uf, res.state, wf, step, run, { resumeId: resumeId as string, cwd: cwd as string, prompt: NUDGE_TEXT, n: n + 1 });
      if (!resumed) return ctx.noop(ref, "agent.nudge.queued", `nudge waits: max_agents ${ctx.config.max_agents} in use (K1)`);
      receipts.push(resumed.receipt);
      return ctx.emit({ kind: "nudge", unit: ref, rule: `${rule}.nudge.resume`, input: null, launch: resumed.launch, kill: session, snapshot, receipts, state: resumed.state, commit });
    }
    return ctx.emit({ kind: "classify", unit: ref, rule: `${rule}.surface`, outcome, kill: null, snapshot, receipts, state: res.state, commit });
  }
  if (res.route === "retry") {
    let state = res.state;
    let launch: AgentLaunch | null = null;
    // R5.3: no fresh session while another run of the step shows hook activity (the next tick retries)
    if (mode === "auto" && cwd && ctx.agentsFree > 0 && !activeRun(ctx, uf, run.run_id)) {
      ctx.agentsFree--;
      const run_id = ctx.id();
      const started = startedReceipt(ctx, state, step, run_id, cwd, true);
      receipts.push({ n: n + 1, receipt: started });
      state = synth(ctx, state, wf, n + 1, started).res.state;
      launch = launchFor(ctx, story, uf, state, step, run_id, cwd);
    }
    const retryRule = outcome === "died" ? `${rule}.retry` : `${rule}.retry.no_nudge`;
    return ctx.emit({ kind: "retry_fresh", unit: ref, rule: retryRule, kill: session, launch, receipts, state, commit });
  }
  const stuck = res.state.status === "stuck";
  ctx.emit({
    kind: "classify",
    unit: ref,
    rule: `${rule}.${res.route ?? (stuck ? "stuck" : "route")}`,
    outcome,
    kill: stuck && outcome !== "silent" && outcome !== "died" ? session : null,
    snapshot,
    receipts,
    state: res.state,
    commit,
  });
}

/**
 * R5.1/R5.2 (H2, A10): the run's `started` receipt is not applied — a crash between the receipt and
 * `state.json`. Observe looked for the run (hook facts with its run_id, runner sessions in the unit
 * worktree, processes with its NORN_RUN). Found → adopt: apply the receipt with what was found, and
 * the run continues as a normal running step. Nothing found and no hook activity for 2 watch
 * intervals → `died` (C1, counted). Before that, nothing else is decided for the unit.
 */
function launchUnknown(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const ref = uf.unit;
  const rf = uf.run as RunFacts;
  const lu = rf.launch_unknown as NonNullable<RunFacts["launch_unknown"]>;
  const startedNr = uf.unapplied.find((r) => r.n === lu.n);
  if (!startedNr || startedNr.receipt.kind !== "started") return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");
  if (rf.session || rf.hooks.length) {
    const n = nextReceiptNumber(uf);
    const prev = startedNr.receipt;
    const adopted: ReceiptOf<"started"> = { ...prev, receipt_id: ctx.id(), at: ctx.nowIso, tick_id: ctx.facts.tick_id };
    if (rf.session) {
      adopted.session = { runner: rf.session.runner, session_id: rf.session.session_id, ...(rf.session.pane_id ? { pane_id: rf.session.pane_id } : {}) };
      if (rf.session.process) adopted.process = rf.session.process;
    }
    if (lu.agent_session_id) adopted.agent_session_id = lu.agent_session_id;
    const { nr, res } = synth(ctx, st, wf, n, adopted, uf.unapplied);
    const found = rf.session ? `session ${rf.session.session_id}` : `${rf.hooks.length} hook fact(s)`;
    return emitApplied(ctx, story, uf, "run.adopt", res, [nr], { message: `norn: ${ref.key} adopted run ${rf.run_id} (${found})`, step: st.step });
  }
  const grace = 2 * parseDuration(ctx.config.watch_interval);
  if (ctx.facts.now - lu.at <= grace) return ctx.noop(ref, "run.launch_unknown.wait", `run ${rf.run_id} has a started receipt but no state; looking for it for 2 watch intervals (R5.1)`);
  const applied = applyReceipts(st, uf.unapplied, applyCtx(ctx, wf));
  const step = stepOf(wf, applied.state.step);
  if (applied.state.run?.run_id !== rf.run_id || step?.type !== "agent") return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");
  routeOutcome(ctx, story, uf, st, wf, step, { outcome: "died", rule: "agent.died.launch_unknown", detail: "launch unknown: no session, process or hook activity found for the run (R5.2)" }, uf.unapplied);
}

/**
 * §10 implicit ask: the agent waits on a prompt (pane `waiting_input`, or a permission hook). L1 (A7):
 * the question is the prompt's question block and the command its first line; the full screen goes
 * to `screen` (inbox --details, why). R6.2: the parsed options and how one is chosen go with it.
 */
function implicitAsk(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, rf: RunFacts, lastHook: RunFacts["hooks"][number] | undefined): void {
  const pane = rf.pane?.state === "waiting_input" ? rf.pane : null;
  const prompt = pane?.prompt;
  const question = prompt?.question || (pane ? "the agent waits for input in its pane" : null) || lastHook?.message || "the agent is waiting for input (permission prompt?)";
  const command = prompt?.command ?? firstLine(lastHook?.command);
  const receipt = nornReceipt(ctx, st, "ask", { run_id: st.run?.run_id ?? null, question, implicit: true });
  if (command) receipt.command = command;
  if (prompt?.options.length) receipt.options = prompt.options;
  if (prompt?.choice) receipt.choice = prompt.choice;
  if (pane?.detail) receipt.screen = pane.detail;
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  const parkInfo = res.state.park ?? { kind: "ask" as const, reason: question, since: ctx.nowIso };
  ctx.emit({
    kind: "park",
    unit: uf.unit,
    rule: "agent.ask.implicit",
    park: parkInfo,
    notify: unitItem(ctx, story, uf, res.state),
    receipts: [nr],
    state: res.state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} waits for input`, st.step),
  });
}

/** Hook events that are the agent waiting, not moving on (R6.1). */
const WAITING_EVENTS = new Set(["waiting_input", "permission_prompt"]);

/**
 * R6.1: why an implicit ask is over, or null: the pane that raised it no longer waits for input, a
 * newer hook event for the run arrived (not another wait), or — handled by the agent verbs — the
 * agent reported. Explicit asks (`norn ask`) are never resolved by facts.
 */
function implicitAskResolved(st: UnitState, uf: UnitFacts): string | null {
  const park = st.park;
  const rf = uf.run;
  if (park?.kind !== "ask" || !park.implicit || !st.run || rf?.run_id !== st.run.run_id) return null;
  const since = epoch(park.since);
  const pane = rf.pane;
  if (park.implicit === "pane" && pane?.alive && pane.state !== "waiting_input" && pane.state !== "unknown") return `the pane no longer waits for input (${pane.state})`;
  const hook = rf.hooks.find((h) => epoch(h.at) > since && !WAITING_EVENTS.has(h.event));
  return hook ? `hook ${hook.native} at ${hook.at}` : null;
}

/** R6.1: write the `answer` receipt (`by: "agent"`) that ends an implicit ask; the run goes on, nothing is typed. */
function resolveImplicitAsk(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, why: string): void {
  const run = st.run as NonNullable<UnitState["run"]>;
  const answer = nornReceipt(ctx, st, "answer", { run_id: run.run_id, by: "agent", who: run.agent ?? ctx.config.default_agent, answer: `the agent moved on: ${why}` });
  if (st.park?.receipt_id) answer.ask_receipt_id = st.park.receipt_id;
  if (uf.unit.slice) answer.slice = uf.unit.slice;
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), answer);
  emitApplied(ctx, story, uf, "agent.ask.implicit.resolved", res, [nr], { message: `norn: ${uf.unit.key} ${st.step} moved on (${why})`, step: st.step });
}

/** R9.1: how long a started session may go without taking its launch prompt, before a re-send and again before `silent`. */
export const LAUNCH_PROMPT_MS = 60_000;

/**
 * R9.1 (M6, A11): the run's newest `session_start` hook has no turn after it. After 60 s the launch
 * prompt is typed again, once per run (a `nudge` that is not counted: it changes only
 * `run.prompt_resent_at`); 60 s after that re-send the run is `silent` ("launch prompt not
 * received"). Only for local sessions of a runner that can type (R4.1); otherwise the usual rules.
 */
function launchPromptCheck(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, rf: RunFacts): "acted" | [string, string, string] | null {
  const run = st.run as NonNullable<UnitState["run"]>;
  const start = sessionStartedNoTurn(rf);
  if (!start) return null;
  if (!run.session || foreignRun(ctx, run) || run.session.runner !== ctx.facts.machine.runner || !runnerCaps(ctx).send) return null;
  const startedAt = epoch(start.at);
  const now = ctx.facts.now;
  if (!run.prompt_resent_at) {
    if (now - startedAt < LAUNCH_PROMPT_MS) return null;
    const state: UnitState = { ...st, run: { ...run, prompt_resent_at: ctx.nowIso }, last_tick_id: ctx.facts.tick_id };
    ctx.emit({
      kind: "nudge",
      unit: uf.unit,
      rule: "agent.launch_prompt.resend",
      input: { run_id: run.run_id, session: sessionRef(run), text: AUTO_PROMPT },
      launch: null,
      kill: null,
      snapshot: null,
      receipts: [],
      state,
      commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} launch prompt re-sent (run ${run.run_id})`, st.step),
    });
    return "acted";
  }
  const resent = epoch(run.prompt_resent_at);
  // measured from the re-send, or from the last classification (its nudge), so it fires once per 60 s
  if (resent < startedAt || now - Math.max(resent, epoch(st.updated_at)) < LAUNCH_PROMPT_MS) return null;
  return ["silent", "agent.silent.launch_prompt", "launch prompt not received"];
}

// ---------------------------------------------------------------- check / git

function runCheck(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, command: string, timeout_ms: number): void {
  const ref = uf.unit;
  if (uf.lease?.kind === "check") return ctx.noop(ref, "check.running", `check run ${uf.lease.run_id ?? "?"} in progress`);
  const cwd = unitWorktree(story, uf);
  if (!cwd) return ctx.noop(ref, "check.no_worktree", "unit worktree missing");
  if (ctx.checksFree <= 0) return ctx.noop(ref, "check.queued", `queued: max_checks ${ctx.config.max_checks} in use (K1)`);
  ctx.checksFree--;
  const run_id = ctx.id();
  const env: Record<string, string> = { NORN_STORY: story.key, NORN_RUN: run_id, ...ctx.slotEnv(uf.worktree?.slot ?? null) };
  if (ref.slice) env.NORN_SLICE = ref.slice;
  ctx.emit({
    kind: "run_check",
    unit: ref,
    rule: "check.run",
    step: st.step,
    run_id,
    command,
    cwd,
    timeout_ms,
    env,
    log_path: `${story.spec_dir}/runs/${ref.dir}/logs/${run_id}.log`,
    receipts: [],
    state: null,
    commit: null,
  });
}

function runGit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: GitStep): void {
  const ref = uf.unit;
  const cwd = unitWorktree(story, uf);
  if (step.action === "open-pr" && story.pr && story.pr.state === "open")
    return classifyNorn(ctx, story, uf, st, wf, "done", "git.open-pr.exists", `PR #${story.pr.number} already open`);
  if (!cwd) return ctx.noop(ref, "git.no_worktree", "unit worktree missing");
  if (step.action === "integrate" || step.action === "update") {
    // K6: integration is serialized per story — a base update (BS3) takes the same lock
    if (ctx.integrating.has(story.key)) return ctx.noop(ref, `git.${step.action}.queued`, "another integration of this story runs this tick (K6)");
    ctx.integrating.add(story.key);
  }
  const fm = story.frontmatter as StoryFrontmatter;
  let update: RunGitAction["update"] = null;
  if (step.action === "update") {
    // BS1/BS3: the base is measured by observe; no base ref (never fetched, no base branch) → wait
    const b = story.base;
    if (!b) return ctx.noop(ref, "git.update.no_base", `base ${ctx.facts.repo.default_branch} not observed for ${story.branch}`);
    const base = ctx.facts.repo.default_branch;
    update = {
      ref: b.ref,
      sha: b.sha,
      branch: base,
      message: `Update ${story.key} from ${base} (${b.sha.slice(0, 7)})`,
      trailers: trailersFor(ctx, story.key, uf.unit.slice, st.step),
    };
  }
  ctx.emit({
    kind: "run_git",
    unit: ref,
    rule: `git.${step.action}`,
    step: st.step,
    run_id: ctx.id(),
    action: step.action,
    cwd,
    branch: unitBranch(story, uf),
    onto: step.action === "integrate" ? story.branch : null,
    pr: step.action === "open-pr" ? { base: ctx.facts.repo.default_branch, title: fm.title, body: `Closes ${fm.url}\n\nDelivered by norn (story ${story.key}).` } : null,
    ...(update ? { update } : {}),
    receipts: [],
    state: null,
    commit: null,
  });
}

/** BS8: the base a classify receipt records. */
const baseOf = (b: NonNullable<StoryFacts["base"]>): NonNullable<ReceiptOf<"classify">["base"]> => ({ ref: b.ref, sha: b.sha, behind: b.behind, conflicts: [...b.conflicts] });

/** A norn-classified outcome for a non-agent step (git/slices/gate), applied in the same tick. */
function classifyNorn(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  st: UnitState,
  wf: Workflow,
  outcome: string,
  rule: string,
  detail: string,
  extra: { receiptRule?: string; base?: NonNullable<ReceiptOf<"classify">["base"]> } = {},
): void {
  const receipt = nornReceipt(ctx, st, "classify", { outcome, rule: extra.receiptRule ?? rule, detail, route: "park", ...(extra.base ? { base: extra.base } : {}) });
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  // §10, W4: the route is where applying the receipt sent the unit
  receipt.route = routeOf(res) ?? "park";
  ctx.emit({
    kind: "classify",
    unit: uf.unit,
    rule,
    outcome,
    kill: null,
    snapshot: null,
    receipts: [nr],
    state: res.state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} ${outcome} → ${receipt.route}`, st.step),
  });
}

// ---------------------------------------------------------------- slices (W2)

/**
 * §10: the story is stuck because its slices step classified `stuck` (that receipt parked it), and
 * a slice can move again now — a person unstuck it, or the slice files changed.
 */
function slicesCanResume(story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): boolean {
  if (uf.unit.slice !== null || stepOf(wf, st.step)?.type !== "slices") return false;
  const parkedBySlices = st.park?.kind === "stuck" && st.park.receipt_id !== undefined
    && st.last_outcome?.step === st.step && st.last_outcome.outcome === "stuck" && st.last_outcome.receipt_id === st.park.receipt_id;
  return parkedBySlices && !sliceProgress(story).broken.length && slicesStuck(story) === null;
}

/** §10, O2: norn unsticks the story back into its slices step, as `norn unstick <story>` would. */
function resumeSlices(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const unstick = nornReceipt(ctx, st, "unstick", { comment: "a slice can move again" });
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), unstick);
  emitApplied(ctx, story, uf, "slices.resume", res, [nr], { message: `norn: ${uf.unit.key} ${st.step} resumed (a slice can move again)`, step: st.step });
}

/** The story's slice files (dropped ones aside) and how far each has come. */
function sliceProgress(story: StoryFacts) {
  const unitOf = (key: string) => story.units.find((u) => u.unit.slice === key);
  const files = story.slices.filter((s) => s.frontmatter?.status !== "dropped");
  const broken = files.filter((s) => !s.frontmatter);
  const integrated = (s: SliceFileFacts) => s.frontmatter?.status === "integrated" || unitOf(s.key)?.state?.status === "done";
  const done = new Set(files.filter(integrated).map((s) => s.key));
  // a broken file (null frontmatter) is never pending: decide notes `slices.file_invalid` first (S2)
  const pending = files.filter((s): s is SliceFileFacts & { frontmatter: SliceFrontmatter } => !!s.frontmatter && !done.has(s.key) && !unitOf(s.key)?.state);
  const startable = pending.filter((s) => s.frontmatter.depends_on.every((d) => done.has(d)));
  return { unitOf, files, broken, done, pending, startable };
}

/** §10: why no slice can move without a person (no slice files, every active slice stuck, none can start); null when one can. */
function slicesStuck(story: StoryFacts): { rule: string; detail: string } | null {
  const { unitOf, files, done, pending, startable } = sliceProgress(story);
  if (!files.length) return { rule: "slices.none", detail: "no slice files" };
  if (done.size === files.length || startable.length) return null;
  const activeUnits = files.filter((s) => !done.has(s.key) && unitOf(s.key)?.state);
  const isStuck = (s: SliceFileFacts) => {
    const status = unitOf(s.key)?.state?.status;
    return status === "stuck" || status === "corrupt";
  };
  // running or parked slices still progress
  const stuckSlices = activeUnits.filter(isStuck);
  if (stuckSlices.length && stuckSlices.length === activeUnits.length) {
    const named = stuckSlices.map((s) => `slice ${s.key} stuck: ${unitOf(s.key)?.state?.park?.reason ?? "?"}`);
    return { rule: "slices.slice_stuck", detail: `${named.join("; ")} — norn unstick ${stuckSlices[0]?.key}` };
  }
  if (!activeUnits.length) {
    const blocked = pending.map((s) => `${s.key} waits for ${s.frontmatter.depends_on.filter((d) => !done.has(d)).join(", ")}`);
    return { rule: "slices.blocked", detail: `no slice can start: ${blocked.join("; ")}` };
  }
  return null;
}

function slicesStep(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const ref = uf.unit;
  const { files, broken, done, startable } = sliceProgress(story);
  if (broken.length) return ctx.noop(ref, "slices.file_invalid", `slice file(s) failed validation: ${broken.map((s) => s.file).join(", ")}`);
  const stuck = slicesStuck(story);
  if (stuck) return classifyNorn(ctx, story, uf, st, wf, "stuck", stuck.rule, stuck.detail);
  if (done.size === files.length) return classifyNorn(ctx, story, uf, st, wf, "done", "slices.done", `${done.size} slice(s) integrated`);

  const starts = [];
  for (const s of startable.sort((a, b) => a.nn.localeCompare(b.nn))) {
    const fm = s.frontmatter;
    const name = fm.workflow ?? ctx.config.default_slice_workflow;
    const loaded = usableWorkflow(ctx, name, "slice");
    if ("problem" in loaded) return park(ctx, story, uf, st, "workflow", `slice ${s.key}: ${loaded.problem}`, "slices.workflow_invalid");
    const sliceRef: UnitRef = { story: story.key, slice: s.key, dir: sliceDirName(s.nn, s.slug), key: s.key };
    const storyWt = story.worktree?.path ?? storyWorktreePath(ctx.facts.repo.root, story.key, story.slug);
    const path = sliceWorktreePath(storyWt, s.nn, s.slug);
    const branch = sliceBranch(story.key, s.nn, s.slug);
    const slot = ctx.slot();
    const worktree: WorktreeSpec = { path, branch, from: story.branch, env: ctx.slotEnv(slot), slot };
    const state = initialState({ unit: sliceRef, workflow: loaded.workflow, workflowName: name, workflowHash: sha256(loaded.source), now: ctx.nowIso, tick_id: ctx.facts.tick_id });
    starts.push({
      kind: "start_unit" as const,
      unit: sliceRef,
      rule: "slice.start",
      workflow: name,
      workflow_source: loaded.source,
      worktree,
      slice_status: "active" as const,
      receipts: [],
      state,
      commit: commitFor(ctx, story, null, `norn: start ${s.key} (${name})`, state.step, { path, branch, slice: s.key, push: true }),
    });
  }
  if (starts.length)
    return ctx.emit({ kind: "start_slices", unit: ref, rule: "slices.start", starts, receipts: [], state: null, commit: null });
  ctx.noop(ref, "slices.wait", `${done.size}/${files.length} slices integrated`);
}
