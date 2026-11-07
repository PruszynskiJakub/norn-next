/**
 * decide's tick context (`Ctx`) and the receipt/commit helpers every level shares: receipt
 * numbering, boundary commits, norn receipts applied in memory, and the park path.
 */
import {
  deriveUlid,
  type Receipt,
  type ReceiptOf,
  type ResolvedConfig,
  sliceBranch,
  type UnitState,
  type Workflow,
  SLOTS,
} from "@norn/schema";
import type { Action, BoundaryCommit, Decision, Delivery, NewReceipt } from "../actions.ts";
import { type ApplyResult, applyReceipts } from "../apply.ts";
import type { Facts, NumberedReceipt, SliceFileFacts, StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { unitInboxItem } from "../inbox/items.ts";
import { nornTrailers, type StepEnd, unitWorktree } from "../policy.ts";
import type { InboxItem } from "../ports.ts";
import { iso } from "../time.ts";
import type { RepoWorkflows } from "./index.ts";

/** A side action rides along with its unit's one action this tick — a claim renewal, or a record push. */
export function isSideAction(a: { kind: string; op?: unknown }): boolean {
  return (a.kind === "claim" && a.op === "renew") || isTailAction(a);
}
/** A side action act performs after every other action of the tick: the record push. */
export function isTailAction(a: { kind: string }): boolean {
  return a.kind === "push_record";
}

export class Ctx {
  readonly decisions: Decision[] = [];
  private readonly taken = new Set<string>();
  private ids = 0;
  readonly nowIso: string;
  readonly heartbeat: string;
  agentsFree: number;
  /** stories with an integrate this tick */
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
    this.checksFree = config.max_agents - leases.filter((l) => l.kind === "check").length;
    this.slotsUsed = new Set(leases.filter((l) => l.kind === "slot" && l.slot !== undefined).map((l) => l.slot as number));
  }

  id(): string {
    return deriveUlid(this.facts.tick_id, this.ids++);
  }
  has(unit: string): boolean {
    return this.taken.has(unit);
  }
  emit(action: Action): void {
    // An intake is about one story — key it by that story so `norn run view <story> --why` finds it;
    // other repo-level actions (lease reclaim) stay `*`
    const unit = action.unit?.key ?? (action.kind === "intake_story" ? action.key : "*");
    // A claim renewal rides along; it does not take the unit's one action
    if (action.unit && !isSideAction(action)) {
      if (this.taken.has(unit)) throw new Error(`decide: second action for ${unit} (${action.rule})`);
      this.taken.add(unit);
    }
    this.decisions.push({ unit, rule: action.rule, action });
  }
  noop(unit: UnitRef, rule: string, reason: string): void {
    this.emit({ kind: "noop", unit, rule, reason });
  }
  /** Next free port slot, or null when the range is exhausted. */
  slot(): number | null {
    for (let s = SLOTS.min; s <= SLOTS.max; s++)
      if (!this.slotsUsed.has(s)) {
        this.slotsUsed.add(s);
        return s;
      }
    return null;
  }
  slotEnv(slot: number | null): Record<string, string> {
    if (slot === null) return {};
    return { NORN_SLOT: String(slot), PORT_BASE: String(SLOTS.port_base + slot * SLOTS.ports_per_slot) };
  }
}

/** The last outcome receipt when it is a failed check. */
export const lastCheck = (uf: UnitFacts): NumberedReceipt | null => {
  const lo = uf.last_outcome_receipt;
  return lo?.receipt.kind === "check" && lo.receipt.outcome === "fail" ? lo : null;
};

/** The last outcome receipt when it is a `done` with findings. */
export const lastFindings = (uf: UnitFacts): NumberedReceipt | null => {
  const lo = uf.last_outcome_receipt;
  return lo?.receipt.kind === "done" && lo.receipt.findings?.length ? lo : null;
};

export const nextReceiptNumber = (uf: UnitFacts): number =>
  Math.max(uf.state?.applied_through ?? 0, ...uf.unapplied.map((r) => r.n), lastCheck(uf)?.n ?? 0, lastFindings(uf)?.n ?? 0) + 1;

/** A merge, rebase, cherry-pick or revert (or unmerged paths) in progress in the unit's worktree. */
export const gitBusy = (uf: UnitFacts): boolean => !!uf.worktree?.in_progress && (!!uf.worktree.in_progress.operation || uf.worktree.in_progress.unmerged.length > 0);

/**
 * A rebase waiting in the unit's worktree. HEAD is detached on an older commit, so
 * the working tree's `runs/` is rewound: its state.json and receipts are not the live unit's.
 */
export const rebasing = (uf: UnitFacts): boolean => uf.worktree?.in_progress?.operation === "rebase";

export function unitBranch(story: StoryFacts, uf: UnitFacts | null): string {
  if (!uf || uf.unit.slice === null) return story.branch;
  const file = sliceFileOf(story, uf.unit.slice);
  return uf.worktree?.status?.branch ?? (file ? sliceBranch(story.key, file.nn, file.slug) : `${story.key}/${uf.unit.dir}`);
}

export const sliceFileOf = (story: StoryFacts, key: string): SliceFileFacts | undefined => story.slices.find((s) => s.key === key);

/** The trailers of a commit norn makes for a unit this tick (`nornTrailers`). */
export const trailersFor = (ctx: Ctx, story: string, slice: string | null, step: string | null, ended?: StepEnd): Record<string, string> =>
  nornTrailers(ctx.facts.tick_id, story, slice, step, ended);

/** A worktree act creates this tick (intake, slice start): the commit goes there, not to an observed one. */
interface NewWorktree {
  path: string;
  branch: string;
  slice: string | null;
  /** An intake is not pushed until the claim is held */
  push: boolean;
}

/**
 * The boundary commit for a unit at `step` — in the unit's worktree (no worktree, no commit),
 * or in the worktree `fresh` that act creates first. `uf` null is the story unit without facts yet
 * (a story nobody started); `story` is only a key for a story intake creates.
 */
export function commitFor(ctx: Ctx, story: StoryFacts | string, uf: null, message: string, step: string | null, o: { fresh: NewWorktree }): BoundaryCommit;
export function commitFor(ctx: Ctx, story: StoryFacts, uf: UnitFacts | null, message: string, step: string | null, o?: { ended?: StepEnd | undefined }): BoundaryCommit | null;
/** `o.fresh`: the worktree act creates first; `o.ended`: how the step ended (`endedWith`), its Norn-Outcome and Norn-Next. */
export function commitFor(ctx: Ctx, story: StoryFacts | string, uf: UnitFacts | null, message: string, step: string | null, o: { fresh?: NewWorktree; ended?: StepEnd | undefined } = {}): BoundaryCommit | null {
  const key = typeof story === "string" ? story : story.key;
  const fresh = o.fresh;
  if (fresh) return { cwd: fresh.path, branch: fresh.branch, message, trailers: trailersFor(ctx, key, fresh.slice, step), push: fresh.push };
  if (typeof story === "string") return null;
  const cwd = unitWorktree(story, uf);
  if (!cwd) return null;
  const slice = uf?.unit.slice ?? null;
  // A story unit's boundary is committed even when nothing changed (the non-holder's last boundary)
  return { cwd, branch: unitBranch(story, uf), message, trailers: trailersFor(ctx, key, slice, step, o.ended), push: true, ...(o.ended && slice === null ? { allow_empty: true as const } : {}) };
}

/**
 * The outcome that ended the step `res` left — a step's outcome whose edge took the
 * cursor to another step — for the boundary commit's Norn-Outcome. None when no step ended: no advance,
 * a person moving the cursor (`moved`: workflow switch, unstick, update), an edge back into the same step,
 * or `$stuck`, which parks the step for an unstick to resume.
 */
export const endedWith = (res: Pick<ApplyResult, "advance">): StepEnd | undefined => {
  const a = res.advance;
  return a && !a.moved && a.from !== a.to && a.to !== "$stuck" ? { outcome: a.outcome, next: a.to } : undefined;
};

export function unitItem(ctx: Ctx, story: StoryFacts, uf: UnitFacts, state: UnitState): InboxItem | null {
  return unitInboxItem(story, { ...uf, state }, ctx.facts, ctx.config);
}

export function applyCtx(ctx: Ctx, wf: Workflow) {
  return { workflow: wf, now: ctx.nowIso, tick_id: ctx.facts.tick_id };
}

/** The receipt header fields `nornReceipt` fills in; `run_id`, `by` and `who` may be overridden. */
type ReceiptHeader = "kind" | "receipt_id" | "run_id" | "step" | "attempt" | "at" | "by" | "who" | "tick_id";

/**
 * A receipt norn writes this tick at the unit's cursor: its id derived from the tick
 * (`ctx.id()`, so `norn run view --why` replays it), at `facts.now`, by norn on this machine, no run unless
 * `fields` names one. `fields` may also set `by`/`who` (an answer recorded for the agent).
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
 * Apply `receipt`, numbered `n`, in memory after `prior` (unapplied receipts) — the
 * state the act commits once the receipt is written. `nr` is the receipt as the action carries it.
 */
export function synth(ctx: Ctx, st: UnitState, wf: Workflow, n: number, receipt: Receipt, prior: readonly NumberedReceipt[] = []): { nr: NewReceipt; res: ApplyResult } {
  return { nr: { n, receipt }, res: applyReceipts(st, [...prior, { n, file: "", receipt }], applyCtx(ctx, wf)) };
}

/** An `apply_receipts` action for `res`: the receipts written this tick, the state, the boundary commit. */
export function emitApplied(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  rule: string,
  res: ApplyResult,
  receipts: NewReceipt[],
  commit: { message: string; step: string; ended?: StepEnd | undefined },
  o: Partial<Delivery> & { state?: UnitState; yields_to_report?: true } = {},
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
    commit: commitFor(ctx, story, uf, commit.message, commit.step, { ended: commit.ended }),
    ...(o.yields_to_report ? { yields_to_report: true as const } : {}),
  });
}

export function park(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, kind: "workflow" | "stuck" | "remote", reason: string, rule: string): void {
  const state: UnitState = { ...st, status: "stuck", park: { kind, reason, since: ctx.nowIso }, updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id };
  ctx.emit({
    kind: "park",
    unit: uf.unit,
    rule,
    notify: unitItem(ctx, story, uf, state),
    receipts: [],
    state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} stuck (${reason})`, st.step),
  });
}
