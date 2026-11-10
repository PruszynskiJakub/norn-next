/**
 * act: perform every decided Action, in the order core's actions.ts defines:
 *   1. write `receipts` (numbered by decide; replay-safe by receipt_id),
 *   2. the external effect (launch, send, kill, command, git, remote),
 *   3. `state.json` last (the commit point),
 *   4. regenerate the handoff header and commit + push at the step boundary.
 * `run_check` / `run_git` write their result receipt after the effect (next free number); the
 * next tick applies it. A failing effect stops the action before state is written; the next
 * tick re-decides. Every action is reported as an `ActionResult` for the trace.
 */
import { relative } from "node:path";
import {
  type Action,
  type ActFailure,
  type ActionResult,
  buildInbox,
  RECORD_PUSH_EFFECT,
  recordPushSlot,
  isSideAction,
  isTailAction,
  type Decision,
  type Facts,
  type InboxGroup,
} from "@norn/core";
import { deleteMailbox, owedRecords, readPendingRecords, reclaimLeases, writeActFailures, writeState, writeUnitMarker } from "@norn/store";
import { ActEnv, QueueFull, claimLost } from "./env.ts";
import { applyReceipts, startRun, nudge, retryFresh, classify } from "./session.ts";
import { runCheck } from "./check.ts";
import { runGit } from "./git-step.ts";
import { startUnit, markDone, rejectReceipt, claim, renewAll, intake, mirror, retitlePr, cleanupMerged, closeClosedIssueStory,
  pushRecord, setAsideRecordAct, roundMigrate, roundStart, type RecordRetry, retryRecords } from "./lifecycle.ts";

export interface ActRecord {
  decision: Decision;
  result: ActionResult;
  /** How long act took over the action (a batched renewal: the batch's time) */
  ms: number;
  /** A claim renewal pushed in the tick's one batch (its `ms` is the batch's) */
  batched?: boolean;
}

/** Inbox groups that need a person; their new items are notified once. */
const NOTIFY_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "unclaimed"];

/** Effects that reach an agent session; one succeeding clears a failed one of the unit. */
const DELIVERY = new Set(["nudge", "answer", "resume", "launch"]);

/** The external effect an action performs, as named in an act failure. */
function effectOf(a: Action): string {
  switch (a.kind) {
    case "nudge":
      return a.launch ? "resume" : "nudge";
    case "apply_receipts":
      return a.launch ? "resume" : a.input ? "answer" : "apply";
    case "start_run":
    case "retry_fresh":
      return "launch";
    default:
      return a.kind;
  }
}

export class Actor extends ActEnv {
  async run(decisions: Decision[]): Promise<ActRecord[]> {
    const out: ActRecord[] = [];
    // A story's renewal runs before its other actions; once it loses the CAS, nothing else of
    // that story is done this tick (a checkout without the claim writes and pushes nothing).
    // A record push comes after everything else, so after the tick's branch pushes
    const renewals = decisions.filter((d) => isSideAction(d.action) && !isTailAction(d.action));
    const order = [...renewals, ...decisions.filter((d) => !isSideAction(d.action)), ...decisions.filter((d) => isTailAction(d.action))];
    const lost = new Set<string>();
    const r0 = performance.now();
    const renewed = await this.renewals(renewals);
    const renewMs = performance.now() - r0;
    for (const d of order) {
      const t0 = performance.now();
      const story = d.action.unit?.story;
      let result: ActionResult;
      this.effectErrors = [];
      this.effectsOk = new Set();
      this.failedSession = null;
      let counted = true;
      if (story && lost.has(story)) {
        result = { ok: false, error: "skipped: claim lost", detail: { skipped: true } };
        counted = false;
      } else
        try {
          result = renewed.get(d) ?? (await this.perform(d.action));
          // An action whose effect failed is never ok, even when its state was written
          if (result.ok && this.effectErrors.length) result = { ...result, ok: false, error: this.effectErrors.map((f) => f.reason).join("; ") };
        } catch (e) {
          counted = !(e instanceof QueueFull);
          result = e instanceof QueueFull ? { ok: false, error: e.message, detail: { queued: true } } : { ok: false, error: (e as Error).message };
        }
      if (story && isSideAction(d.action) && !isTailAction(d.action) && !result.ok && claimLost(result)) lost.add(story);
      if (counted) this.recordFailure(d, result);
      out.push(renewed.has(d) ? { decision: d, result, ms: renewMs, batched: true } : { decision: d, result, ms: performance.now() - t0 });
    }
    this.dropRecordPushSlots();
    if (this.failuresChanged) writeActFailures(this.root, this.failures);
    // the trace keeps decide's order
    return decisions.map((d) => out.find((r) => r.decision === d) as ActRecord);
  }

  /** Every renewal due this tick in one CAS batch (one push); a failed batch fails each. */
  private async renewals(ds: Decision[]): Promise<Map<Decision, ActionResult>> {
    if (ds.length === 0) return new Map();
    let results: ActionResult[];
    try {
      results = await renewAll(this, ds.map((d) => d.action as Extract<Action, { kind: "claim" }>));
    } catch (e) {
      results = ds.map(() => ({ ok: false, error: (e as Error).message }));
    }
    return new Map(ds.map((d, i) => [d, results[i] as ActionResult]));
  }

  /**
   * Remember a unit's failed effect (inbox Unblock item, status), or forget it once an effect of
   * the same family succeeds for the unit. Claim and repo-level actions are not unit failures.
   */
  private recordFailure(d: Decision, result: ActionResult): void {
    const a = d.action;
    if (a.kind === "push_record") return this.recordPushFailure(a, d.rule, result);
    // A retitle rides along with the unit's own action and the next sync retries it, so it must
    // neither replace that action's failure nor clear it
    if (a.kind === "retitle_pr") return;
    if (!a.unit || a.kind === "claim" || a.kind === "noop") return;
    const key = a.unit.key;
    const prev = this.failures[key];
    if (!result.ok) {
      const loc = this.obs.units[key];
      const st = this.written.get(key) ?? loc?.state;
      const effect = this.effectErrors[0]?.effect ?? effectOf(a);
      const failure: ActFailure = { effect, rule: d.rule, reason: result.error ?? "failed", at: this.nowIso(), tick_id: this.tick, step: st?.step ?? "?", attempt: st?.attempt ?? 1 };
      if (this.failedSession) failure.session = { runner: this.failedSession.runner, session_id: this.failedSession.session_id, ...(this.failedSession.pane_id ? { pane_id: this.failedSession.pane_id } : {}) };
      this.failures[key] = failure;
      this.failuresChanged = true;
      return;
    }
    if (!prev) return;
    const delivered = DELIVERY.has(prev.effect) && [...this.effectsOk].some((e) => DELIVERY.has(e));
    if (delivered || this.effectsOk.has(prev.effect)) {
      delete this.failures[key];
      this.failuresChanged = true;
    }
  }

  /**
   * A failed record push is owed, not a failure of the unit: the next tick pushes it. One
   * refused as stale (another checkout pushed the ref) would fail the same way every tick, so it is
   * remembered with the lease it used (effect `record_push`) in the story's own slot, never the story
   * unit's: decide holds the push until the record ref here changes, and the inbox shows one
   * Check item. A push that lands, or one that fails another way (its lease was another), clears it.
   */
  private recordPushFailure(a: Extract<Action, { kind: "push_record" }>, rule: string, result: ActionResult): void {
    const key = recordPushSlot(a.unit.story);
    const prev = this.failures[key];
    if (result.ok || (result.detail as { reason?: string } | undefined)?.reason !== "stale") {
      if (prev?.effect !== RECORD_PUSH_EFFECT) return;
      delete this.failures[key];
      this.failuresChanged = true;
      return;
    }
    // the story unit's cursor when it was refused (the slot is the story's, not a unit's)
    const st = this.written.get(a.unit.key) ?? this.obs.units[a.unit.key]?.state;
    this.failures[key] = { effect: RECORD_PUSH_EFFECT, rule, reason: result.error ?? "record push refused as stale", at: this.nowIso(), tick_id: this.tick, step: st?.step ?? "?", attempt: st?.attempt ?? 1, lease: a.expected };
    this.failuresChanged = true;
  }

  /** A refused record push is forgotten once the story is not held here under `remote` (observe reports no `record`). */
  private dropRecordPushSlots(): void {
    const observed = new Set(this.obs.facts.stories.filter((s) => s.record).map((s) => recordPushSlot(s.key)));
    for (const [key, f] of Object.entries(this.failures))
      if (f.effect === RECORD_PUSH_EFFECT && !observed.has(key)) {
        delete this.failures[key];
        this.failuresChanged = true;
      }
  }

  async perform(a: Action): Promise<ActionResult> {
    switch (a.kind) {
      case "apply_receipts":
        return applyReceipts(this, a);
      case "start_unit":
        return startUnit(this, a);
      case "start_slices": {
        const details: unknown[] = [];
        let ok = true;
        for (const s of a.starts) {
          try {
            details.push({ unit: s.unit.key, ...(await startUnit(this, s)) });
          } catch (e) {
            ok = false;
            details.push({ unit: s.unit.key, ok: false, error: (e as Error).message });
          }
        }
        return ok ? { ok, detail: details } : { ok, error: "some slices failed to start", detail: details };
      }
      case "start_run":
        return startRun(this, a);
      case "nudge":
        return nudge(this, a);
      case "retry_fresh":
        return retryFresh(this, a);
      case "run_check":
        return runCheck(this, a);
      case "run_git":
        return runGit(this, a);
      case "classify":
        return classify(this, a);
      case "park": {
        const loc = this.unitLoc(a.unit);
        this.writeReceipts(loc, a.receipts);
        if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
        await this.notify(a.notify);
        const committed = await this.commit(a.commit, a.unit, a.state);
        return { ok: true, detail: committed };
      }
      case "mark_done":
        return markDone(this, a);
      case "commit_push": {
        const loc = this.unitLoc(a.unit);
        // What recover.commit owes is the unit's handoff, norn's one file in the worktree
        // (observe's `uncommitted`); its run state is in the machine dir, never staged in the worktree (outside
        // the repository), and the agent's own files are never committed under a live session
        const rel = relative(a.commit.cwd, loc.handoffFile);
        return { ok: true, detail: await this.commit(a.commit, a.unit, loc.state, [rel]) };
      }
      case "reject_receipt":
        return rejectReceipt(this, a);
      case "mark_corrupt": {
        const loc = this.obs.units[a.unit.key];
        // Decide gives the corrupt state only when it may be written; a broken spec.md never is
        const marked = a.state !== null && loc !== undefined;
        if (a.state && loc) writeState(loc.runsDir, a.state);
        await this.notify(a.notify);
        return { ok: true, detail: { marked, errors: a.errors } };
      }
      case "import_mailbox": {
        const loc = this.unitLoc(a.unit);
        this.writeReceipts(loc, a.receipts);
        const committed = await this.commit(a.commit, a.unit, loc.state);
        const deleted: string[] = [];
        for (const r of a.refs) {
          const res = await deleteMailbox(this.root, this.obs.remote, r.ref, r.sha);
          if (res.ok) deleted.push(r.ref);
        }
        return { ok: true, detail: { ...committed, deleted } };
      }
      case "claim":
        return claim(this, a);
      case "notify":
        await this.notify(a.item);
        return { ok: true };
      case "update_story_mirror":
        return mirror(this, a);
      case "retitle_pr":
        return retitlePr(this, a);
      case "cleanup_merged_story":
        return cleanupMerged(this, a);
      case "close_story":
        return closeClosedIssueStory(this, a);
      case "round_migrate":
        return roundMigrate(this, a);
      case "round_start":
        return roundStart(this, a);
      case "set_aside_record":
        return setAsideRecordAct(this, a);
      case "push_record":
        return pushRecord(this, a);
      case "noop":
        return { ok: true };
      case "intake_story":
        return intake(this, a);
      case "restore_markers": {
        for (const w of a.worktrees) writeUnitMarker(w.path, w.marker);
        return { ok: true, detail: { restored: a.worktrees.map((w) => w.path) } };
      }
      case "reclaim_leases": {
        const removed = await reclaimLeases(this.ctx.home, a.files, this.liveness());
        return { ok: true, detail: { removed } };
      }
    }
  }

  /**
   * The observed facts with this tick's local effects applied — unit states written, claims
   * acquired, merged stories cleaned up. Every state.json act wrote is the validated value it
   * wrote, so this equals a fresh local observe for the inbox without re-reading every
   * worktree; items resolved this tick drop out and items created this tick appear.
   */
  postActFacts(): Facts {
    const f = structuredClone(this.obs.facts);
    f.stories = f.stories.filter((s) => !this.cleaned.has(s.key));
    for (const s of f.stories) {
      const c = this.claimed.get(s.key);
      if (c) s.claim = { state: "mine", blob: c.blob, sha: c.sha };
      for (const u of s.units) {
        // Failures recorded or cleared this tick
        const failure = this.failures[u.unit.key];
        if (failure) u.act_failure = failure;
        else delete u.act_failure;
        const st = this.written.get(u.unit.key);
        if (!st) continue;
        u.state = st;
        u.unapplied = u.unapplied.filter((r) => r.n > st.applied_through);
      }
    }
    // Records retried this tick may have stopped or cleared: read them back as the next observe would
    const owed = owedRecords(readPendingRecords(this.ctx.root));
    if (owed.length) f.owed_records = owed;
    else delete f.owed_records;
    return f;
  }

  /**
   * New inbox items needing a person (gates entered by apply, etc.). Pass facts observed
   * after act, so items resolved this tick are not notified and new ones are not a tick late.
   */
  async notifyInbox(facts: Facts = this.obs.facts): Promise<void> {
    const inbox = buildInbox(facts, this.config);
    for (const g of NOTIFY_GROUPS) for (const item of inbox.groups[g]) await this.notify(item);
  }

  /** Retry owed base-branch records (lifecycle.ts retryRecords). */
  retryRecords(): Promise<RecordRetry[]> {
    return retryRecords(this);
  }
}
