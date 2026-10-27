/**
 * Shared plumbing of the human verbs (§15, O2): unit addressing (ID1), reading a unit's cursor
 * locally or from the pushed branch, receipt building, and delivery — locally under the claim
 * (T8: acquired for this heartbeat when free) or through the mailbox when another heartbeat
 * holds it (T9). Views read through @norn/view only (X1).
 */
import { isAbsolute, relative } from "node:path";
import type { StoryFacts, UnitFacts } from "@norn/core";
import { loadProjectView, type ProjectView } from "@norn/view";
import {
  type ClaimBlob,
  isStoryKey,
  parseDuration,
  parseSpecDirName,
  type Receipt,
  SPECS_DIR,
  STORY_UNIT_DIR,
  sliceKey,
  storyOf,
  ulid,
  type UnitState,
  validate,
  type Workflow,
} from "@norn/schema";
import {
  acquireClaim,
  appendReceipt,
  type ClaimRead,
  fetchNornRefs,
  heartbeatId,
  listMailbox,
  git as rawGit,
  parseWorkflowText,
  postMailbox,
  readClaim,
  recordedHeartbeatId,
} from "@norn/store";
import type { Context } from "../context.ts";
import { claimHeld, failure, refuse, usageError } from "../output.ts";
import { machineHolder, type Observed, observe } from "./observe.ts";

// ------------------------------------------------------------------ addressing (ID1)

/** Normalize a unit key: `gh-123`, `gh-123/03` (also `gh-123/3`). Usage error otherwise. */
export function parseUnitKey(raw: string): { key: string; story: string; slice: string | null } {
  const s = raw.trim();
  if (isStoryKey(s)) return { key: s, story: s, slice: null };
  const m = /^((?:gh|gl)-[1-9][0-9]*)\/([0-9]{1,3})$/.exec(s);
  if (m) {
    const key = sliceKey(m[1] as string, m[2] as string);
    return { key, story: storyOf(key), slice: key };
  }
  throw usageError(`not a story or slice key: '${raw}' (use e.g. gh-123 or gh-123/03)`, "norn status");
}

// ------------------------------------------------------------------ views (X1)

/** The read model for this checkout and machine (no writes, no network). */
export async function projectView(ctx: Context): Promise<ProjectView> {
  // MO5: the runner's capabilities decide how Your turn says to start an agent; a config that
  // cannot build ports still gets its view (the errors are in it)
  const runner = await ctx.ports().then((p) => p.runner, () => null);
  return loadProjectView({
    repoRoot: ctx.root,
    home: ctx.home,
    now: ctx.clock.now(),
    env: ctx.env,
    holder: machineHolder(ctx.env),
    heartbeatId: recordedHeartbeatId(ctx.root),
    ...(runner ? { runnerCapabilities: runner.capabilities } : {}),
  });
}

// ------------------------------------------------------------------ targets

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
  obs: Observed | null;
  story_facts: StoryFacts | null;
}

export async function gitRemote(ctx: Context): Promise<string | null> {
  const name = ctx.config.remote.git_remote;
  const r = await rawGit(ctx.root, ["remote"]);
  return r.code === 0 && r.stdout.split("\n").some((l) => l.trim() === name) ? name : null;
}

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

async function show(root: string, spec: string): Promise<string | null> {
  const r = await rawGit(root, ["show", spec]);
  return r.code === 0 ? r.stdout : null;
}

/**
 * The unit's cursor from the pushed branches (T7: the holder pushes at step boundaries):
 * a slice reads its slice branch first, then the story branch; the story unit its story branch.
 */
export async function remoteTarget(ctx: Context, key: string): Promise<Target | null> {
  const remote = await gitRemote(ctx);
  if (!remote) return null;
  const root = ctx.root;
  await rawGit(root, ["fetch", "--quiet", "--no-tags", remote]);
  const { story, slice } = parseUnitKey(key);
  const refs = (await rawGit(root, ["for-each-ref", "--format=%(refname)", `refs/remotes/${remote}/`])).stdout.split("\n").filter(Boolean);
  const prefix = `refs/remotes/${remote}/`;
  const storyRef = refs.find((r) => r.startsWith(prefix) && parseSpecDirName(r.slice(prefix.length))?.story === story);
  if (!storyRef) return null;
  const spec = `${SPECS_DIR}/${storyRef.slice(prefix.length)}`;
  const candidates: Array<{ ref: string; dir: string }> = [];
  if (slice) {
    const nn = slice.split("/")[1] as string;
    const sliceRef = refs.find((r) => r.startsWith(`${prefix}${story}/${nn}-`));
    if (sliceRef) candidates.push({ ref: sliceRef, dir: sliceRef.slice(`${prefix}${story}/`.length) });
    const listed = (await rawGit(root, ["ls-tree", "--name-only", `${storyRef}:${spec}/runs/`])).stdout.split("\n");
    const dir = listed.find((d) => d.startsWith(`${nn}-`));
    if (dir) candidates.push({ ref: storyRef, dir });
  } else candidates.push({ ref: storyRef, dir: STORY_UNIT_DIR });
  for (const c of candidates) {
    const raw = await show(root, `${c.ref}:${spec}/runs/${c.dir}/state.json`);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const st = validate("state", parsed);
    if (!st.ok) continue;
    const wfText = await show(root, `${c.ref}:${spec}/runs/${c.dir}/workflow.yaml`);
    const wf = wfText === null ? null : parseWorkflowText(wfText, `${spec}/runs/${c.dir}/workflow.yaml`);
    return { key, story, slice, state: st.value, workflow: wf?.ok ? wf.value : null, runsDir: null, source: "remote", obs: null, story_facts: null };
  }
  return null;
}

/** Observe this checkout without touching the network. */
export function observeLocal(ctx: Context): Promise<Observed> {
  return observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
}

/**
 * Resolve the unit a verb acts on. A story key may stand for one of its slices when `pick`
 * matches the story unit's state nowhere but exactly one slice (e.g. `answer gh-7` while only
 * slice 02 asks). Falls back to the pushed branch when the story is not in this checkout.
 */
export async function resolveTarget(ctx: Context, raw: string, pick?: (st: UnitState) => boolean): Promise<Target> {
  const { key, story, slice } = parseUnitKey(raw);
  const obs = await observeLocal(ctx);
  const sf = obs.facts.stories.find((s) => s.key === story);
  if (sf) {
    if (slice) {
      const uf = sf.units.find((u) => u.unit.key === slice);
      if (uf) return localTarget(obs, sf, uf);
      throw refuse(`no slice ${slice} in story ${story}`, `norn status ${story}`, "unknown_unit");
    }
    const storyUnit = sf.units.find((u) => u.unit.slice === null);
    if (pick && storyUnit && !(storyUnit.state && pick(storyUnit.state))) {
      const matches = sf.units.filter((u) => u.unit.slice !== null && u.state && pick(u.state));
      if (matches.length === 1) return localTarget(obs, sf, matches[0] as UnitFacts);
    }
    if (storyUnit) return localTarget(obs, sf, storyUnit);
  }
  const remote = await remoteTarget(ctx, key);
  if (remote) return remote;
  throw refuse(`unknown unit ${key}: not in this checkout or on the remote`, "norn status", "unknown_unit");
}

/** Refuse unless the unit has started (state.json exists and is readable). */
export function started(t: Target): UnitState {
  if (t.story_facts) {
    const uf = t.story_facts.units.find((u) => u.unit.key === t.key);
    if (uf?.errors.length) throw refuse(`${t.key} is corrupt (S2): ${uf.errors.map((e) => e.file).join(", ")}`, `norn why ${t.key}`, "corrupt_unit", uf.errors);
  }
  if (!t.state) throw refuse(`${t.key} has not started yet`, "norn tick", "not_started");
  if (t.state.status === "corrupt") throw refuse(`${t.key} is corrupt (S2)`, `norn why ${t.key}`, "corrupt_unit");
  return t.state;
}

// ------------------------------------------------------------------ receipts

type HumanKind = "answer" | "approve" | "reject" | "unstick" | "mode" | "workflow" | "update";

/** A human receipt at the unit's cursor (S6): step + attempt + slice so the tick routes it (T9). */
export function humanReceipt<K extends HumanKind>(ctx: Context, t: Target, st: UnitState, kind: K, body: Record<string, unknown>): Extract<Receipt, { kind: K }> {
  const r = {
    kind,
    receipt_id: ulid(ctx.clock.now()),
    run_id: st.run?.run_id ?? null,
    step: st.step,
    attempt: st.attempt,
    at: ctx.clock.iso(),
    by: "human",
    who: machineHolder(ctx.env),
    slice: t.slice,
    ...body,
  };
  const v = validate("receipt", r);
  if (!v.ok) throw usageError(`invalid ${kind}: ${v.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, `norn ${kind === "reject" ? "approve" : kind} --help`);
  return v.value as Extract<Receipt, { kind: K }>;
}

// ------------------------------------------------------------------ claim and delivery (T8, T9)

export type Route = { via: "local"; claim: "mine" | "acquired" } | { via: "mailbox"; holder: ClaimBlob };

/**
 * Who may write the receipt: this heartbeat when it holds the claim, or after acquiring a free
 * claim (T8); otherwise the mailbox (T9) — or a refusal when `mailbox` is false (mode, workflow).
 */
export async function claimRoute(ctx: Context, t: Target, opts: { mailbox: boolean; verb: string; claim?: ClaimRead }): Promise<Route> {
  const root = ctx.root;
  const remote = await gitRemote(ctx);
  const now = ctx.clock.now();
  let cur = opts.claim ?? (await currentClaim(ctx, t.story));
  if (cur.state === "corrupt") throw refuse(`claim ref of ${t.story} is corrupt`, `norn take ${t.story} --force`, "claim_corrupt", cur.error);
  const hb = heartbeatId(root, now);
  const live = cur.state === "present" && Date.parse(cur.blob.expires_at) > now;
  if (cur.state === "present" && live && cur.blob.heartbeat_id === hb) {
    if (!t.runsDir) throw refuse(`${t.key} is held here but its runs/ are not in this checkout`, "norn tick", "story_not_local");
    return { via: "local", claim: "mine" };
  }
  if (!live) {
    if (!t.runsDir) throw refuse(`${t.story} is unclaimed and not in this checkout`, `norn take ${t.story}`, "story_not_local");
    const blob: ClaimBlob = {
      version: 1,
      story: t.story,
      holder: machineHolder(ctx.env),
      heartbeat_id: hb,
      acquired_at: ctx.clock.iso(),
      renewed_at: ctx.clock.iso(),
      expires_at: new Date(now + parseDuration(ctx.config.claim.lease)).toISOString(),
      last_tick_id: null,
    };
    const r = await acquireClaim(root, remote, blob, { now });
    if (r.ok) return { via: "local", claim: "acquired" };
    if (r.reason !== "held") throw failure(`cannot acquire the claim of ${t.story}: ${r.message}`, `norn ${opts.verb} again`, "claim_failed");
    cur = { state: "present", sha: r.sha, blob: r.holder };
  }
  const holder = (cur as Extract<ClaimRead, { state: "present" }>).blob;
  if (!opts.mailbox) throw claimHeld(holder, `ask ${holder.holder} to run it, or norn take ${t.story} --force`, `; ${opts.verb} cannot go through the mailbox (T9)`);
  return { via: "mailbox", holder };
}

/** The story's claim as the remote has it (T3). */
async function currentClaim(ctx: Context, story: string): Promise<ClaimRead> {
  try {
    return await readClaim(ctx.root, await gitRemote(ctx), story);
  } catch (e) {
    throw failure(`cannot read the claim of ${story}: ${(e as Error).message}`, "check the network and retry", "claim_unreadable");
  }
}

/**
 * Refuse a verb that needs the claim (mode, workflow) while another heartbeat holds it: this
 * checkout's copy may be stale (T9), so no answer is computed from it — not even a no-op.
 */
export async function refuseIfHeldElsewhere(ctx: Context, story: string, verb: string): Promise<ClaimRead> {
  const claim = await currentClaim(ctx, story);
  const holder = heldElsewhere(ctx, claim);
  if (holder) throw claimHeld(holder, `ask ${holder.holder} to run it, or norn take ${story} --force`, `; ${verb} cannot go through the mailbox (T9)`);
  return claim;
}

/** A live claim of another heartbeat (T9: the verb goes through the mailbox), else null. */
function heldElsewhere(ctx: Context, cur: ClaimRead): ClaimBlob | null {
  const now = ctx.clock.now();
  if (cur.state !== "present" || Date.parse(cur.blob.expires_at) <= now) return null;
  return cur.blob.heartbeat_id === heartbeatId(ctx.root, now) ? null : cur.blob;
}

/** What a human receipt decides; two receipts with the same purpose at one step attempt conflict. */
const purpose = (r: Receipt): string => (r.kind === "reject" ? "approve" : r.kind);
const sameDecision = (a: Receipt, b: Receipt) =>
  purpose(a) === purpose(b) && a.step === b.step && a.attempt === b.attempt && (a.slice ?? null) === (b.slice ?? null);

/**
 * Refuse a second answer / gate decision / unstick for the step attempt one is already recorded
 * for and not yet applied (S6): the tick would apply the first and reject the second silently.
 * Looks at the unit's unapplied receipts and the story's mailbox (T9).
 */
async function refuseDuplicate(ctx: Context, t: Target, receipt: Receipt, holder: ClaimBlob | null): Promise<void> {
  const unit = receipt.slice ?? t.story;
  const pending: Array<{ receipt: Receipt; where: string }> = [];
  const uf = t.story_facts?.units.find((u) => u.unit.key === unit);
  for (const r of uf?.unapplied ?? []) pending.push({ receipt: r.receipt, where: r.file });
  const remote = await gitRemote(ctx);
  if (remote) await fetchNornRefs(ctx.root, remote).catch(() => undefined);
  for (const m of await listMailbox(ctx.root, t.story).catch(() => [])) if (m.receipt) pending.push({ receipt: m.receipt, where: m.ref });
  const dup = pending.find((p) => sameDecision(p.receipt, receipt));
  if (!dup) return;
  const next = holder ? `wait for ${holder.holder}'s next tick to import it (T9)` : "norn tick";
  throw refuse(
    `${dup.receipt.kind} already recorded for ${receipt.step}#${receipt.attempt} (${dup.where}) and not applied yet`,
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
  /** mailbox ref (T9) */
  ref?: string;
  holder?: string;
}

export async function deliver(ctx: Context, t: Target, route: Route, receipt: Receipt): Promise<Delivered> {
  if (route.via === "local") {
    const r = appendReceipt(t.runsDir as string, receipt);
    // repo-relative: the runs/ may live in a story or slice worktree, not under ctx.root
    const checkout = t.obs?.units[t.key]?.root ?? ctx.root;
    const rel = relative(checkout, r.file);
    const file = rel.startsWith("..") || isAbsolute(rel) ? r.file : rel;
    return { via: "local", claim: route.claim, n: r.n, file };
  }
  const remote = await gitRemote(ctx);
  const posted = await postMailbox(ctx.root, remote, t.story, receipt);
  if (!posted.ok) throw failure(`mailbox push failed: ${posted.message}`, `norn ${receipt.kind === "reject" ? "approve" : receipt.kind} again`, "mailbox_failed");
  return { via: "mailbox", ref: posted.ref, holder: route.holder.holder };
}

/**
 * Validate → route → (for the mailbox, re-read the cursor from the pushed branch and re-validate)
 * → build and deliver. `check` refuses when the state does not allow the verb; `build` makes the
 * receipt from the (possibly refreshed) target.
 */
export async function runHumanVerb(
  ctx: Context,
  t: Target,
  opts: {
    verb: string;
    mailbox: boolean;
    check: (t: Target, st: UnitState) => void;
    build: (t: Target, st: UnitState) => Receipt;
    /** an effect that must succeed before the receipt is written (R6.3: typing an answer into a prompt); returns the receipt to write */
    before?: (t: Target, st: UnitState, route: Route, receipt: Receipt) => Promise<Receipt>;
  },
): Promise<{ unit: string; receipt: Receipt; delivered: Delivered; next: string }> {
  // T9: read the claim first — a non-holder's local copy may be stale, so when another heartbeat
  // holds the story the cursor comes from the pushed branch before any precondition is checked
  const claim = await currentClaim(ctx, t.story);
  const holder = heldElsewhere(ctx, claim);
  let target = t;
  if (opts.mailbox && t.source === "local" && holder) target = (await remoteTarget(ctx, t.key)) ?? t;
  opts.check(target, started(target));
  let receipt = opts.build(target, started(target));
  await refuseDuplicate(ctx, t, receipt, holder);
  const route = await claimRoute(ctx, t, { mailbox: opts.mailbox, verb: opts.verb, claim });
  if (route.via === "local" && target !== t) {
    // the claim turned out free after all: write under it, against the local cursor
    target = t;
    opts.check(target, started(target));
    receipt = opts.build(target, started(target));
  }
  if (opts.before) receipt = await opts.before(target, started(target), route, receipt);
  const delivered = await deliver(ctx, target, route, receipt);
  const next = route.via === "local" ? "norn tick" : `${route.holder.holder}'s next tick imports it (T9)`;
  return { unit: target.key, receipt, delivered, next };
}

/** One line naming where a unit is, for refusals. */
export const at = (st: UnitState) => `${st.step}#${st.attempt} (${st.status}${st.park ? `: ${st.park.kind}` : ""})`;
