/**
 * act (H4): perform every decided Action. Ordering per actions.ts (P6, S5, S6, S8):
 *   1. write `receipts` (numbered by decide; replay-safe by receipt_id),
 *   2. the external effect (launch, send, kill, command, git, remote),
 *   3. `state.json` last (the commit point),
 *   4. regenerate the handoff header (S9) and commit + push at the step boundary.
 * `run_check` / `run_git` write their result receipt after the effect (next free number); the
 * next tick applies it. A failing effect stops the action before state is written; the next
 * tick re-decides. Every action is reported as an `ActionResult` for the trace (O4).
 */
import { relative } from "node:path";
import {
  type Action,
  type ActFailure,
  type ActionResult,
  buildInbox,
  isSideAction,
  type Decision,
  type Facts,
  type InboxGroup,
} from "@norn/core";
import { deleteMailbox, reclaimLeases, writeActFailures, writeState } from "@norn/store";
import { appendProgress, rejectProgress } from "../report.ts";
import { ActEnv, QueueFull, claimLost } from "./env.ts";
import { applyReceipts, startRun, nudge, retryFresh, classify } from "./session.ts";
import { runCheck } from "./check.ts";
import { runGit } from "./git-step.ts";
import { startUnit, markDone, rejectReceipt, claim, renewAll, intake, mirror, cleanupMerged, retryRecords } from "./lifecycle.ts";

export interface ActRecord {
  decision: Decision;
  result: ActionResult;
}

/** Inbox groups that need a person; their new items are notified once (O3). */
const NOTIFY_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "unclaimed"];

/** R4.3: effects that reach an agent session; one succeeding clears a failed one of the unit. */
const DELIVERY = new Set(["nudge", "answer", "resume", "launch"]);

/** R4.3: the external effect an action performs, as named in an act failure. */
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

/**
 * O6: the handoff heartbeat for a park — the state's park, or, when an implicit ask took the
 * workflow's `ask` edge (no park in state), the ask itself.
 */
function parkLine(a: Extract<Action, { kind: "park" }>): string {
  const p = a.state.park;
  if (p) return `${p.kind} — ${p.reason}`;
  const ask = a.receipts.findLast((r) => r.receipt.kind === "ask")?.receipt;
  return `ask — ${ask?.kind === "ask" ? ask.question : "?"}`;
}

export class Actor extends ActEnv {
  // ------------------------------------------------------------ dispatch

  async run(decisions: Decision[]): Promise<ActRecord[]> {
    const out: ActRecord[] = [];
    // R1.2: a story's renewal runs before its other actions; once it loses the CAS, nothing else of
    // that story is done this tick (R2.2: a checkout without the claim writes and pushes nothing)
    const order = [...decisions.filter((d) => isSideAction(d.action)), ...decisions.filter((d) => !isSideAction(d.action))];
    const lost = new Set<string>();
    const renewed = await this.renewals(order.filter((d) => isSideAction(d.action)));
    for (const d of order) {
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
          // R4.3: an action whose effect failed is never ok, even when its state was written
          if (result.ok && this.effectErrors.length) result = { ...result, ok: false, error: this.effectErrors.map((f) => f.reason).join("; ") };
        } catch (e) {
          counted = !(e instanceof QueueFull);
          result = e instanceof QueueFull ? { ok: false, error: e.message, detail: { queued: true } } : { ok: false, error: (e as Error).message };
        }
      if (story && isSideAction(d.action) && !result.ok && claimLost(result)) lost.add(story);
      if (counted) this.recordFailure(d, result);
      out.push({ decision: d, result });
    }
    if (this.failuresChanged) writeActFailures(this.root, this.failures);
    // the trace keeps decide's order
    return decisions.map((d) => out.find((r) => r.decision === d) as ActRecord);
  }

  /** T4, H5: every renewal due this tick in one CAS batch (one push); a failed batch fails each. */
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
   * R4.3: remember a unit's failed effect (inbox Unblock item, status), or forget it once an effect of
   * the same family succeeds for the unit. Claim and repo-level actions are not unit failures.
   */
  private recordFailure(d: Decision, result: ActionResult): void {
    const a = d.action;
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
        this.writeReceipts(loc.runsDir, a.receipts);
        if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
        await this.notify(a.notify);
        const committed = await this.commit(a.commit, a.unit, a.state, `${a.rule}: ${parkLine(a)}`);
        return { ok: true, detail: committed };
      }
      case "mark_done":
        return markDone(this, a);
      case "commit_push": {
        const loc = this.unitLoc(a.unit);
        const rel = relative(a.commit.cwd, loc.runsDir);
        return { ok: true, detail: await this.commit(a.commit, a.unit, loc.state, null, [rel]) };
      }
      case "reject_receipt":
        return rejectReceipt(this, a);
      case "mark_corrupt": {
        const loc = this.obs.units[a.unit.key];
        // S2: decide says whether the state is marked (`mark_state`); a broken story.md never is
        let marked = false;
        if (a.mark_state && loc?.state) {
          const reason = `corrupt: ${a.errors.map((e) => e.file).join(", ")} failed validation (S2)`;
          writeState(loc.runsDir, { ...loc.state, status: "corrupt", park: { kind: "corrupt", reason, since: this.nowIso() }, updated_at: this.nowIso(), last_tick_id: this.tick });
          marked = true;
        }
        await this.notify(a.notify);
        return { ok: true, detail: { marked, errors: a.errors } };
      }
      case "import_mailbox": {
        const loc = this.unitLoc(a.unit);
        this.writeReceipts(loc.runsDir, a.receipts);
        // a gate rejection is a milestone in handoff.md, as when it is written locally (O6)
        for (const r of a.receipts) if (r.receipt.kind === "reject") appendProgress(loc.runsDir, rejectProgress(r.receipt));
        const committed = await this.commit(a.commit, a.unit, loc.state, `${a.rule}: ${a.receipts.map((r) => r.receipt.kind).join(", ")}`);
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
      case "cleanup_merged_story":
        return cleanupMerged(this, a);
      case "noop":
        return { ok: true };
      case "intake_story":
        return intake(this, a);
      case "reclaim_leases": {
        const removed = await reclaimLeases(this.ctx.home, a.files, this.liveness());
        return { ok: true, detail: { removed } };
      }
    }
  }

  /**
   * O3: the observed facts with this tick's local effects applied — unit states written, claims
   * acquired, merged stories cleaned up. Every state.json act wrote is the validated value it
   * wrote (S5), so this equals a fresh local observe for the inbox without re-reading every
   * worktree; items resolved this tick drop out and items created this tick appear.
   */
  postActFacts(): Facts {
    const f = structuredClone(this.obs.facts);
    f.stories = f.stories.filter((s) => !this.cleaned.has(s.key));
    for (const s of f.stories) {
      const c = this.claimed.get(s.key);
      if (c) s.claim = { state: "mine", blob: c.blob, sha: c.sha };
      for (const u of s.units) {
        // R4.3: failures recorded or cleared this tick
        const failure = this.failures[u.unit.key];
        if (failure) u.act_failure = failure;
        else delete u.act_failure;
        const st = this.written.get(u.unit.key);
        if (!st) continue;
        u.state = st;
        u.unapplied = u.unapplied.filter((r) => r.n > st.applied_through);
      }
    }
    return f;
  }

  /**
   * New inbox items needing a person (gates entered by apply, etc.). O3: pass facts observed
   * after act, so items resolved this tick are not notified and new ones are not a tick late.
   */
  async notifyInbox(facts: Facts = this.obs.facts): Promise<void> {
    const inbox = buildInbox(facts, this.config);
    for (const g of NOTIFY_GROUPS) for (const item of inbox.groups[g]) await this.notify(item);
  }

  /** GR6: retry owed base-branch records, at most once per `remote.sync_interval` each (H5). */
  retryRecords(): Promise<Array<{ story: string; state: string; reason?: string }>> {
    return retryRecords(this);
  }
}
