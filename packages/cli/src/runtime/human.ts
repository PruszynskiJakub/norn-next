/**
 * Shared plumbing of the human verbs: unit addressing, reading a unit's cursor
 * locally or from the story's record ref, receipt building, and delivery — locally under the claim
 * (acquired for this heartbeat when free) or through the mailbox when another heartbeat
 * holds it. Views read through @norn/view only.
 */
import { isAbsolute, relative } from "node:path";
import { cmd, type ClaimState, stepLabel, type StoryFacts, storyUnit, type UnitFacts } from "@norn/core";
import { loadProjectView, type ProjectView } from "@norn/view";
import {
  type ClaimBlob,
  type Receipt,
  ulid,
  type UnitState,
  validate,
  type Workflow,
} from "@norn/schema";
import {
  acquireClaim,
  appendReceipt,
  type RemoteClaimRead,
  classifyClaim,
  fetchElsewhere,
  fetchNornRefs,
  lastBoundary,
  type LastBoundary,
  remoteStoryBranch,
  readStoryRecord,
  heartbeatId,
  listMailbox,
  newClaimBlob,
  postMailbox,
  readClaim,
  recordedHeartbeatId,
  machineHolder,
} from "@norn/store";
import type { Context } from "../context.ts";
import { opt, type ParsedArgs } from "../command.ts";
import { claimHeld, failure, refuse, usageError } from "../output.ts";
import { parseUnitKey } from "./args.ts";
import { gitRemote, type Observed, observe } from "./observe/index.ts";
import { bundledSkillSet } from "./skills-drift.ts";

/** The read model for this checkout and machine (no writes, no network). */
export async function projectView(ctx: Context, opts: { inboxOnly?: boolean } = {}): Promise<ProjectView> {
  // A config file with a problem refuses under "Config error" (exit config), never a view
  // drawn on fallback values
  void ctx.config;
  // The runner's capabilities decide how Your turn says to start an agent; ports that fail
  // to build for another reason still leave the view
  const runner = await ctx.ports().then((p) => p.runner, () => null);
  return loadProjectView({
    repoRoot: ctx.root,
    home: ctx.home,
    now: ctx.clock.now(),
    env: ctx.env,
    holder: machineHolder(ctx.env),
    heartbeatId: recordedHeartbeatId(ctx.root),
    version: ctx.version,
    bundledSkills: bundledSkillSet(ctx.env),
    ...(runner ? { runnerCapabilities: runner.capabilities } : {}),
    ...(opts.inboxOnly ? { inboxOnly: true } : {}),
  });
}

/** A unit as the verb sees it: its cursor and pinned workflow, local or from the remote branch. */
export interface Target {
  key: string;
  story: string;
  /** null = story unit */
  slice: string | null;
  state: UnitState | null;
  workflow: Workflow | null;
  /** absolute runs/<unit>/ in this checkout; null when read from the remote branch only */
  runsDir: string | null;
  /** where the cursor was read from */
  source: "local" | "remote";
  /**
   * A `local` story another machine holds — the only cursor known here is the step its last
   * boundary commit led to (`Norn-Next`); `state` is null. Only a mailbox verb that builds a step-only
   * receipt (`stepOnly`) acts on it; the holder checks the receipt. Absent = none.
   */
  boundary?: LastBoundary & { next: string };
  /**
   * How the verb builds its step-only receipt (`stepOnlyReceipt`) — given to `resolveTarget`
   * by a mailbox verb; its presence is what lets a `local` story held elsewhere resolve to its last
   * boundary. Absent = the verb needs the cursor.
   */
  stepOnly?: StepOnlyBuild;
  obs: Observed | null;
  story_facts: StoryFacts | null;
}

/** A mailbox verb's step-only receipt for a unit, from the step its last boundary led to. */
export type StepOnlyBuild = (t: Target, step: string) => Receipt;

function localTarget(obs: Observed, story: StoryFacts, uf: UnitFacts): Target {
  return {
    key: uf.unit.key,
    story: story.key,
    slice: uf.unit.slice,
    state: uf.state,
    workflow: uf.workflow,
    runsDir: obs.units[uf.unit.key]?.runsDir ?? null,
    source: "local",
    obs,
    story_facts: story,
  };
}

/**
 * The unit's cursor as a non-holder knows it: the one record ref and story branch this
 * verb needs are fetched (a failed fetch refuses). Under `local` the story unit's cursor is the step its
 * last boundary commit led to (`Norn-Next`), with no attempt — only for a verb that can send a step-only
 * receipt (`stepOnly`). Otherwise (`remote`, a slice, no such boundary) it is read from the record ref's
 * git objects (validated); null when the ref holds no such unit. Run state is never on a branch.
 */
async function remoteTarget(ctx: Context, key: string, stepOnly: StepOnlyBuild | undefined): Promise<Target | null> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  if (!remote) return null;
  const { story, slice } = parseUnitKey(key);
  // a verb never acts on a record it could not refresh (it fetches the one story it needs)
  await fetchElsewhere(ctx.root, remote, [story]).catch((e: Error) => {
    throw failure(`cannot fetch the record of ${story}: ${e.message}`, "check the network and retry", "record_unreachable");
  });
  const base = { key, story, slice, runsDir: null, source: "remote" as const, obs: null, story_facts: null, ...(stepOnly ? { stepOnly } : {}) };
  if (stepOnly && ctx.config.record.policy === "local") {
    const branch = slice ? null : await remoteStoryBranch(ctx.root, remote, story);
    const b = branch ? await lastBoundary(ctx.root, `refs/remotes/${remote}/${branch}`, story, null) : null;
    if (b?.next) return { ...base, state: null, workflow: null, boundary: { ended: b.ended, next: b.next } };
  }
  const record = await readStoryRecord(ctx.root, story);
  const u = record?.units.find((x) => x.key === key);
  if (!u) return null;
  return { ...base, state: u.state, workflow: u.workflow };
}

/** The unit's facts as this checkout observes them, without touching the network; null when it is not here. */
export async function localUnit(ctx: Context, key: string): Promise<UnitFacts | null> {
  const { story, slice } = parseUnitKey(key);
  const sf = (await observeLocal(ctx)).facts.stories.find((s) => s.key === story);
  return (slice ? sf?.units.find((u) => u.unit.key === slice) : sf && storyUnit(sf)) ?? null;
}

/** Observe this checkout without touching the network. */
function observeLocal(ctx: Context): Promise<Observed> {
  return observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
}

/**
 * Resolve the unit a verb acts on. A story key may stand for one of its slices when `pick`
 * matches the story unit's state nowhere but exactly one slice (e.g. `answer gh-7` while only
 * slice 02 asks). Falls back to the story's record ref when the story is not in this checkout, or — for a
 * mailbox verb that can send a step-only receipt (`o.stepOnly`) — to its last boundary.
 */
export async function resolveTarget(ctx: Context, raw: string, pick?: (st: UnitState) => boolean, o: { stepOnly?: StepOnlyBuild } = {}): Promise<Target> {
  const t = await findTarget(ctx, raw, pick, o.stepOnly);
  return o.stepOnly ? { ...t, stepOnly: o.stepOnly } : t;
}

async function findTarget(ctx: Context, raw: string, pick: ((st: UnitState) => boolean) | undefined, stepOnly: StepOnlyBuild | undefined): Promise<Target> {
  const { key, story, slice } = parseUnitKey(raw);
  const obs = await observeLocal(ctx);
  const sf = obs.facts.stories.find((s) => s.key === story);
  if (sf) {
    if (slice) {
      const uf = sf.units.find((u) => u.unit.key === slice);
      if (uf) return localTarget(obs, sf, uf);
      throw refuse(`no slice ${slice} in story ${story}`, cmd.storyView(story), "unknown_unit");
    }
    const su = storyUnit(sf);
    if (pick && su && !(su.state && pick(su.state))) {
      const matches = sf.units.filter((u) => u.unit.slice !== null && u.state && pick(u.state));
      if (matches.length === 1) return localTarget(obs, sf, matches[0] as UnitFacts);
    }
    if (su) return localTarget(obs, sf, su);
  }
  const remote = await remoteTarget(ctx, key, stepOnly);
  if (remote) return remote;
  throw refuse(`unknown unit ${key}: not in this checkout or on the remote`, cmd.status(), "unknown_unit");
}

/** Refuse unless the unit has started (state.json exists and is readable). */
export function started(t: Target): UnitState {
  if (t.story_facts) {
    const uf = t.story_facts.units.find((u) => u.unit.key === t.key);
    if (uf?.errors.length) throw refuse(`${t.key} is corrupt: ${uf.errors.map((e) => e.file).join(", ")}`, cmd.runView(t.key, { why: true }), "corrupt_unit", uf.errors);
  }
  if (!t.state) throw refuse(`${t.key} has not started yet`, cmd.tick(), "not_started");
  if (t.state.status === "corrupt") throw refuse(`${t.key} is corrupt`, cmd.runView(t.key, { why: true }), "corrupt_unit");
  return t.state;
}

/** `--delegated` with its `--reason`: what the receipt carries, or nothing for the person's own decision. */
export interface Delegation {
  delegated: boolean;
  reason: string | undefined;
}

/** The option definitions every delegatable verb takes. */
export const DELEGATED_OPTION = { delegated: { type: "boolean" } } as const;
export const DELEGATED_HELP = { "--delegated": "a supervisor decides on your behalf: recorded apart from your own decisions, needs --reason" };

/**
 * Read `--delegated` and `--reason`. A delegated decision always
 * carries a non-empty reason, and is refused inside a unit worktree: a step agent never supervises.
 */
export function delegation(ctx: Context, args: ParsedArgs, verb: string): Delegation {
  const reason = opt.str(args, "reason")?.trim() || undefined;
  const delegated = opt.bool(args, "delegated");
  if (delegated && !reason) throw usageError(`${verb} --delegated: the reason is required`, `pass --reason "the evidence": norn ${verb} … --delegated --reason "…"`, "reason_required");
  if (delegated && ctx.unit) throw refuse(`${verb} --delegated runs in the main checkout, never in a unit worktree`, `run it from ${ctx.root}`, "delegated_in_unit");
  return { delegated, reason };
}

/** The receipt fields of a delegation: `delegated: true` and the reason as `comment`. */
export const delegatedFields = (d: Delegation): { delegated?: true; comment?: string } => ({ ...(d.delegated ? { delegated: true as const } : {}), ...(d.reason ? { comment: d.reason } : {}) });

type HumanKind = "answer" | "approve" | "reject" | "unstick" | "stuck" | "mode" | "workflow" | "update" | "round";

/**
 * How an unapplied receipt of a kind conflicts with a new one of the same `purpose` — `step-attempt`:
 * one per step attempt (the tick would apply the first and reject the second silently); `any-step`: one
 * per unit at any step (update); `last-wins`: never, every receipt applies and the last one wins (mode,
 * a workflow switch or cursor move).
 */
type Conflict = "step-attempt" | "any-step" | "last-wins";

/** Per human receipt kind: the verb that records it, its command as printed, what it decides and how it conflicts. */
const HUMAN_KINDS: Record<HumanKind, { verb: string; command: (unit: string) => string; purpose: string; conflict: Conflict }> = {
  answer: { verb: "story answer", command: (u) => cmd.storyAnswer(u), purpose: "answer", conflict: "step-attempt" },
  approve: { verb: "story approve", command: (u) => cmd.storyApprove(u), purpose: "gate", conflict: "step-attempt" },
  reject: { verb: "story reject", command: (u) => cmd.storyReject(u), purpose: "gate", conflict: "step-attempt" },
  unstick: { verb: "run rerun", command: (u) => cmd.runRerun(u), purpose: "unstick", conflict: "step-attempt" },
  stuck: { verb: "run cancel", command: (u) => cmd.runCancel(u), purpose: "stuck", conflict: "step-attempt" },
  round: { verb: "story edit", command: (u) => cmd.storyEdit(u, { workflow: "<name>" }), purpose: "round", conflict: "step-attempt" },
  update: { verb: "story update-branch", command: (u) => cmd.storyUpdateBranch(parseUnitKey(u).story), purpose: "update", conflict: "any-step" },
  mode: { verb: "story edit", command: (u) => cmd.storyEdit(u, { mode: "auto" }), purpose: "mode", conflict: "last-wins" },
  workflow: { verb: "story edit", command: (u) => cmd.storyEdit(u, { workflow: "<name>" }), purpose: "workflow", conflict: "last-wins" },
};

/** The table row of a receipt kind; only human kinds are ever looked up. */
const humanKind = (kind: Receipt["kind"]) => HUMAN_KINDS[kind as HumanKind];

/** A human receipt at the unit's cursor: step + attempt + slice (+ the story's round) so the tick routes it. */
export function humanReceipt<K extends HumanKind>(ctx: Context, t: Pick<Target, "slice">, st: UnitState, kind: K, body: Record<string, unknown>): Extract<Receipt, { kind: K }> {
  return validReceipt(kind, {
    kind,
    receipt_id: ulid(ctx.clock.now()),
    run_id: st.run?.run_id ?? null,
    step: st.step,
    attempt: st.attempt,
    at: ctx.clock.iso(),
    by: "human",
    who: machineHolder(ctx.env),
    slice: t.slice,
    // The story's round, so a mailbox receipt is not applied to a later round at the same cursor
    ...(t.slice === null ? { round: st.round ?? 1 } : {}),
    ...body,
  });
}

/** The receipts a mailbox carries that may be stamped with a step only. */
export type StepOnlyKind = "answer" | "approve" | "reject" | "unstick";

/**
 * A mailbox receipt a `local` non-holder makes from the step the story's last boundary
 * led to: that step, and no attempt, run or round — the holder matches it by step alone.
 */
export function stepOnlyReceipt<K extends StepOnlyKind>(ctx: Context, t: Pick<Target, "slice">, step: string, kind: K, body: Record<string, unknown>): Extract<Receipt, { kind: K }> {
  return validReceipt(kind, { kind, receipt_id: ulid(ctx.clock.now()), run_id: null, step, at: ctx.clock.iso(), by: "human", who: machineHolder(ctx.env), slice: t.slice, ...body });
}

/** Validate a person's receipt: a shape the schema refuses is a usage error. */
function validReceipt<K extends HumanKind>(kind: K, r: Record<string, unknown>): Extract<Receipt, { kind: K }> {
  const v = validate("receipt", r);
  if (!v.ok) throw usageError(`invalid ${kind}: ${v.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, `norn ${HUMAN_KINDS[kind].verb} --help`);
  return v.value as Extract<Receipt, { kind: K }>;
}

export type Route = { via: "local"; claim: "mine" | "acquired" } | { via: "mailbox"; holder: ClaimBlob };

/**
 * The story's claim as the remote has it now, classified for this checkout's heartbeat
 * by store `classifyClaim` — the rule observe uses, so a verb and the tick judge a claim alike.
 * Judged by the recorded heartbeat_id: reading a claim never creates one (a new one matches no claim).
 * `remote` saves a caller that already knows the git remote looking it up again; `unreadable`
 * builds the error thrown when the claim ref cannot be read (network).
 */
export async function claimFor(
  ctx: Context,
  story: string,
  opts: { remote?: string | null; unreadable?: (e: Error) => Error } = {},
): Promise<ClaimState> {
  const unreadable = opts.unreadable ?? ((e: Error) => failure(`cannot read the claim of ${story}: ${e.message}`, "check the network and retry", "claim_unreadable"));
  let read: RemoteClaimRead;
  try {
    read = await readClaim(ctx.root, opts.remote !== undefined ? opts.remote : await gitRemote(ctx.git, ctx.root, ctx.config.git_remote), story);
  } catch (e) {
    throw unreadable(e as Error);
  }
  if (read.state === "unreachable") throw unreadable(new Error(read.message));
  return classifyClaim(read, { heartbeat_id: recordedHeartbeatId(ctx.root) }, ctx.clock.now());
}

/**
 * Who may write the receipt: this heartbeat when it holds the claim, or after acquiring a free
 * claim; otherwise the mailbox — or a refusal when `mailbox` is false (mode, workflow).
 */
async function claimRoute(ctx: Context, t: Target, opts: { mailbox: boolean; verb: string; claim?: ClaimState }): Promise<Route> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  const c = opts.claim ?? (await claimFor(ctx, t.story));
  if (c.state === "corrupt") throw refuse(`claim ref of ${t.story} is corrupt`, cmd.storyCheckout(t.story, { force: true }), "claim_corrupt", c.error);
  if (c.state === "mine") {
    if (!t.runsDir) throw refuse(`${t.key} is held here but its runs/ are not in this checkout`, cmd.tick(), "story_not_local");
    return { via: "local", claim: "mine" };
  }
  let holder: ClaimBlob;
  if (c.state === "other") holder = c.blob;
  else {
    if (!t.runsDir) throw refuse(`${t.story} is unclaimed and not in this checkout`, cmd.storyCheckout(t.story), "story_not_local");
    const now = ctx.clock.now();
    const blob = newClaimBlob({ story: t.story, holder: machineHolder(ctx.env), heartbeat_id: heartbeatId(ctx.root, now), now, at: ctx.clock.iso(), lease: ctx.config.claim.lease });
    const r = await acquireClaim(ctx.root, remote, blob, { now });
    if (r.ok) return { via: "local", claim: "acquired" };
    if (r.reason !== "held") throw failure(`cannot acquire the claim of ${t.story}: ${r.message}`, `norn ${opts.verb} again`, "claim_failed");
    holder = r.holder;
  }
  if (!opts.mailbox) throw claimHeld(holder, `ask ${holder.holder} to run it, or ${cmd.storyCheckout(t.story, { force: true })}`, `; ${opts.verb} cannot go through the mailbox`);
  return { via: "mailbox", holder };
}

/**
 * Refuse a verb that needs the claim (story edit --auto|--manual, story start) while another heartbeat holds it: this
 * checkout's copy may be stale, so no answer is computed from it — not even a no-op.
 */
export async function refuseIfHeldElsewhere(ctx: Context, story: string, verb: string): Promise<ClaimState> {
  const claim = await claimFor(ctx, story);
  const holder = heldElsewhere(claim);
  if (holder) throw claimHeld(holder, `ask ${holder.holder} to run it, or ${cmd.storyCheckout(story, { force: true })}`, `; ${verb} cannot go through the mailbox`);
  return claim;
}

/**
 * A verb only the claim holder runs (update) — refused unless this heartbeat holds the claim
 * and the unit's runs/ are in this checkout; it never acquires a free claim nor uses the mailbox.
 */
function refuseUnlessHolder(claim: ClaimState, t: Target, verb: string, rule: string): Route {
  if (claim.state === "mine" && t.runsDir) return { via: "local", claim: "mine" };
  const live = claim.state === "mine" || claim.state === "other";
  const who = live ? `held by ${claim.blob.holder}` : "not held by this checkout";
  throw refuse(`${t.story}'s claim is ${who}; ${rule}`, live ? `ask ${claim.blob.holder} to run norn ${verb} ${t.story}, or ${cmd.storyCheckout(t.story, { force: true })}` : cmd.storyCheckout(t.story), "not_holder");
}

/** A live claim of another heartbeat (the verb goes through the mailbox), else null. */
const heldElsewhere = (c: ClaimState): ClaimBlob | null => (c.state === "other" ? c.blob : null);

/** Whether an unapplied receipt `a` conflicts with the new `b`, by `b`'s conflict scope (`HUMAN_KINDS`). */
function conflicts(a: Receipt, b: Receipt): boolean {
  const row = humanKind(b.kind);
  if (row.conflict === "last-wins" || humanKind(a.kind)?.purpose !== row.purpose || (a.slice ?? null) !== (b.slice ?? null)) return false;
  return row.conflict === "any-step" || (a.step === b.step && a.attempt === b.attempt);
}

/**
 * Refuse a receipt that conflicts with one already recorded and not yet applied (`HUMAN_KINDS`).
 * Looks at the unit's unapplied receipts and, for a verb that may use it, the story's mailbox.
 */
async function refuseDuplicate(ctx: Context, t: Target, receipt: Receipt, holder: ClaimBlob | null, mailbox: boolean): Promise<void> {
  const scope = humanKind(receipt.kind).conflict;
  if (scope === "last-wins") return;
  const unit = receipt.slice ?? t.story;
  const pending: Array<{ receipt: Receipt; where: string }> = [];
  const uf = t.story_facts?.units.find((u) => u.unit.key === unit);
  for (const r of uf?.unapplied ?? []) pending.push({ receipt: r.receipt, where: r.file });
  // a verb that never goes through the mailbox has no receipt of its purpose there
  if (mailbox) {
    const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
    if (remote) await fetchNornRefs(ctx.root, remote).catch(() => undefined);
    for (const m of await listMailbox(ctx.root, t.story).catch(() => [])) if (m.receipt) pending.push({ receipt: m.receipt, where: m.ref });
  }
  const dup = pending.find((p) => conflicts(p.receipt, receipt));
  if (!dup) return;
  if (scope === "any-step") throw refuse(`an ${receipt.kind} of ${t.story} is already recorded (${dup.where}) and not applied yet`, cmd.tick(), "already_recorded");
  const next = holder ? `wait for ${holder.holder}'s next tick to import it` : cmd.tick();
  throw refuse(
    `${dup.receipt.kind} already recorded for ${stepLabel(receipt.step, receipt.attempt)} (${dup.where}) and not applied yet`,
    next,
    "already_recorded",
    { receipt_id: dup.receipt.receipt_id },
  );
}

export interface Delivered {
  via: "local" | "mailbox";
  claim?: "mine" | "acquired";
  /** local: receipt number and repo-relative file */
  n?: number;
  file?: string;
  /** mailbox ref */
  ref?: string;
  holder?: string;
}

async function deliver(ctx: Context, t: Target, route: Route, receipt: Receipt): Promise<Delivered> {
  if (route.via === "local") {
    const r = appendReceipt(t.runsDir as string, receipt);
    // repo-relative: the runs/ may live in a story or slice worktree, not under ctx.root
    const checkout = t.obs?.units[t.key]?.root ?? ctx.root;
    const rel = relative(checkout, r.file);
    const file = rel.startsWith("..") || isAbsolute(rel) ? r.file : rel;
    return { via: "local", claim: route.claim, n: r.n, file };
  }
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  const posted = await postMailbox(ctx.root, remote, t.story, receipt);
  if (!posted.ok) throw failure(`mailbox push failed: ${posted.message}`, `${humanKind(receipt.kind).command(t.key)} again`, "mailbox_failed");
  return { via: "mailbox", ref: posted.ref, holder: route.holder.holder };
}

export interface HumanVerbOptions {
  verb: string;
  /**
   * true: another heartbeat's claim sends the receipt through its mailbox, and the claim is
   * read before anything else. false: refused when another heartbeat holds the claim; the claim is
   * read after `check` unless the caller passes the one it read first (`claim`: mode).
   */
  mailbox: boolean;
  /** the story's claim the caller already read (claimFor) */
  claim?: ClaimState;
  /**
   * Only the claim holder runs the verb (update); the refusal states this rule. Checked after
   * `check`; the claim is never acquired here and never goes through the mailbox.
   */
  requireHolder?: string;
  check: (t: Target, st: UnitState) => void;
  /** true: nothing to record (mode already set); the verb returns null without touching the claim */
  noop?: (t: Target, st: UnitState) => boolean;
  build: (t: Target, st: UnitState) => Receipt;
  /** an effect that must succeed before the receipt is written (typing an answer into a prompt); returns the receipt to write */
  before?: (t: Target, st: UnitState, route: Route, receipt: Receipt) => Promise<Receipt>;
}

export interface HumanVerbResult {
  unit: string;
  receipt: Receipt;
  delivered: Delivered;
  next: string;
}

/**
 * Validate → route → (for the mailbox, re-read the cursor from the pushed branch and re-validate)
 * → build and deliver. `check` refuses when the state does not allow the verb; `build` makes the
 * receipt from the (possibly refreshed) target. Null only when `noop` says there is nothing to record.
 */
export async function runHumanVerb(ctx: Context, t: Target, opts: HumanVerbOptions & { noop?: undefined }): Promise<HumanVerbResult>;
export async function runHumanVerb(ctx: Context, t: Target, opts: HumanVerbOptions): Promise<HumanVerbResult | null>;
export async function runHumanVerb(ctx: Context, t: Target, opts: HumanVerbOptions): Promise<HumanVerbResult | null> {
  // Read the claim first — a non-holder's local copy may be stale, so when another heartbeat
  // holds the story the cursor comes from its record ref before any precondition is checked
  let claim = opts.claim ?? (opts.mailbox ? await claimFor(ctx, t.story) : null);
  let target = t;
  // A step-only receipt goes only through the mailbox
  const stepOnly = opts.mailbox ? t.stepOnly : undefined;
  if (opts.mailbox && t.source === "local" && claim && heldElsewhere(claim)) target = (await remoteTarget(ctx, t.key, stepOnly)) ?? t;
  let receipt: Receipt;
  if (target.boundary) {
    // Only the step is known here; the holder checks the receipt against its cursor
    if (!stepOnly) throw refuse(`${t.key}'s run state is on the machine that holds it`, cmd.storyView(t.story), "story_not_local");
    receipt = stepOnly(target, target.boundary.next);
  } else {
    opts.check(target, started(target));
    if (opts.noop?.(target, started(target))) return null;
    receipt = opts.build(target, started(target));
  }
  let held: Route | null = null;
  if (opts.requireHolder) {
    claim ??= await claimFor(ctx, t.story);
    held = refuseUnlessHolder(claim, t, opts.verb, opts.requireHolder);
  }
  await refuseDuplicate(ctx, t, receipt, claim && heldElsewhere(claim), opts.mailbox);
  const route = held ?? (await claimRoute(ctx, t, { mailbox: opts.mailbox, verb: opts.verb, ...(claim ? { claim } : {}) }));
  if (route.via === "local" && target !== t) {
    // the claim turned out free after all: write under it, against the local cursor
    target = t;
    opts.check(target, started(target));
    receipt = opts.build(target, started(target));
  }
  if (opts.before && !target.boundary) receipt = await opts.before(target, started(target), route, receipt);
  const delivered = await deliver(ctx, target, route, receipt);
  const next =
    route.via === "local"
      ? cmd.tick()
      : target.boundary
        ? `sent to ${route.holder.holder}; the holder checks it against the step it is at (last boundary: ${target.boundary.ended} -> ${target.boundary.next})`
        : `${route.holder.holder}'s next tick imports it`;
  return { unit: target.key, receipt, delivered, next };
}

/** One line naming where a unit is, for refusals. */
export const at = (st: UnitState) => `${st.step}#${st.attempt} (${st.status}${st.park ? `: ${st.park.kind}` : ""})`;
