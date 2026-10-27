/**
 * decide's tick context (`Ctx`) and the receipt/commit helpers every level shares: receipt
 * numbering, boundary commits (S4, S8), norn receipts (P6) applied in memory (S6), and the park path.
 */
import {
  deriveUlid,
  type Receipt,
  type ReceiptOf,
  type ResolvedConfig,
  sliceBranch,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { Action, AgentLaunch, BoundaryCommit, Decision, NewReceipt, SessionInput } from "../actions.ts";
import { type ApplyResult, applyReceipts } from "../apply.ts";
import type { Facts, NumberedReceipt, SliceFileFacts, StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { unitInboxItem } from "../inbox.ts";
import { nornTrailers, unitWorktree } from "../policy.ts";
import type { InboxItem, SessionRef } from "../ports.ts";
import { iso } from "../time.ts";
import type { RepoWorkflows } from "./index.ts";

/** R1.1: a side action rides along with its unit's one action this tick — only a claim renewal. */
export function isSideAction(a: { kind: string; op?: unknown }): boolean {
  return a.kind === "claim" && a.op === "renew";
}

export class Ctx {
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

export const nextReceiptNumber = (uf: UnitFacts): number =>
  Math.max(uf.state?.applied_through ?? 0, ...uf.unapplied.map((r) => r.n), uf.last_check?.n ?? 0, uf.last_findings?.n ?? 0) + 1;

/** H1: a merge, rebase, cherry-pick or revert (or unmerged paths) in progress in the unit's worktree. */
export const gitBusy = (uf: UnitFacts): boolean => !!uf.worktree?.in_progress && (!!uf.worktree.in_progress.operation || uf.worktree.in_progress.unmerged.length > 0);

export function unitBranch(story: StoryFacts, uf: UnitFacts | null): string {
  if (!uf || uf.unit.slice === null) return story.branch;
  const file = sliceFileOf(story, uf.unit.slice);
  return uf.worktree?.status?.branch ?? (file ? sliceBranch(story.key, file.nn, file.slug) : `${story.key}/${uf.unit.dir}`);
}

export const sliceFileOf = (story: StoryFacts, key: string): SliceFileFacts | undefined => story.slices.find((s) => s.key === key);

/** S4: the trailers of a commit norn makes for a unit this tick (`nornTrailers`). */
export const trailersFor = (ctx: Ctx, story: string, slice: string | null, step: string | null): Record<string, string> => nornTrailers(ctx.facts.tick_id, story, slice, step);

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
export function commitFor(ctx: Ctx, story: StoryFacts | string, uf: null, message: string, step: string | null, fresh: NewWorktree): BoundaryCommit;
export function commitFor(ctx: Ctx, story: StoryFacts, uf: UnitFacts | null, message: string, step: string | null): BoundaryCommit | null;
export function commitFor(ctx: Ctx, story: StoryFacts | string, uf: UnitFacts | null, message: string, step: string | null, fresh?: NewWorktree): BoundaryCommit | null {
  const key = typeof story === "string" ? story : story.key;
  if (fresh) return { cwd: fresh.path, branch: fresh.branch, message, trailers: trailersFor(ctx, key, fresh.slice, step), push: fresh.push };
  if (typeof story === "string") return null;
  const cwd = unitWorktree(story, uf);
  if (!cwd) return null;
  return { cwd, branch: unitBranch(story, uf), message, trailers: trailersFor(ctx, key, uf?.unit.slice ?? null, step), push: true };
}

export function unitItem(ctx: Ctx, story: StoryFacts, uf: UnitFacts, state: UnitState): InboxItem | null {
  return unitInboxItem(story, { ...uf, state }, ctx.facts, ctx.config);
}

export function applyCtx(ctx: Ctx, wf: Workflow) {
  return { workflow: wf, now: ctx.nowIso, limits: ctx.config.limits, tick_id: ctx.facts.tick_id };
}

/** The receipt header fields `nornReceipt` fills in; `run_id`, `by` and `who` may be overridden. */
type ReceiptHeader = "kind" | "receipt_id" | "run_id" | "step" | "attempt" | "at" | "by" | "who" | "tick_id";

/**
 * A receipt norn writes this tick at the unit's cursor (P6): its id derived from the tick
 * (`ctx.id()`, so `norn why` replays it), at `facts.now`, by norn on this machine, no run unless
 * `fields` names one. `fields` may also set `by`/`who` (R6.1: an answer recorded for the agent).
 */
export function nornReceipt<K extends Receipt["kind"]>(
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
export function synth(ctx: Ctx, st: UnitState, wf: Workflow, n: number, receipt: Receipt, prior: readonly NumberedReceipt[] = []): { nr: NewReceipt; res: ApplyResult } {
  return { nr: { n, receipt }, res: applyReceipts(st, [...prior, { n, file: "", receipt }], applyCtx(ctx, wf)) };
}

/** An `apply_receipts` action for `res` (C2, S5): the receipts written this tick, the state, the boundary commit. */
export function emitApplied(
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

export function park(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, kind: "workflow" | "stuck" | "remote", reason: string, rule: string): void {
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
