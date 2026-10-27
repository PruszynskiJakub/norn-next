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
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type Action,
  type ActFailure,
  type ActionResult,
  type AgentLaunch,
  applyReceipts,
  buildInbox,
  GIT_CONFLICT_MARKERS,
  GIT_IN_PROGRESS,
  type BoundaryCommit,
  isSideAction,
  type Decision,
  type Facts,
  type InboxItem,
  type InboxGroup,
  type NewReceipt,
  nornTrailers,
  renderHandoffStatus,
  routeOf,
  type SessionRef,
  type UnitRef,
  type WorktreeSpec,
} from "@norn/core";
import {
  type ClaimBlob,
  parseDuration,
  type ReceiptOf,
  type UnitState,
  type Workflow,
  STORY_UNIT_DIR,
  ulid,
} from "@norn/schema";
import {
  acquireClaim,
  acquireIntegrateLock,
  acquireRunLease,
  appendHandoffHeartbeat,
  appendReceipt,
  appendTrace,
  deleteMailbox,
  listLeases,
  patchSliceFile,
  patchStoryFile,
  pinWorkflow,
  readEnvNorn,
  readActFailures,
  reclaimLeases,
  releaseClaim,
  releaseLease,
  renewClaim,
  sliceFile as sliceFilePath,
  storyFile,
  traceDir,
  updateLease,
  writeActFailures,
  writeHandoffHeader,
  writeLog,
  writeReceiptAt,
  writeState,
  writeStoryFile,
  writeTranscriptSnapshot,
  markNotified,
  type PendingRecord,
  readNotified,
  readPendingRecords,
  writePendingRecords,
} from "@norn/store";
import type { Context } from "../context.ts";
import { integrate, syncRemoteBranch, update as updateStory } from "./integrate.ts";
import { leaseLiveness } from "./leases.ts";
import { markStoryOnBase, mergeFacts, type RecordResult } from "./record.ts";
import type { Observed, StoryLoc, UnitLoc } from "./observe.ts";
import { appendProgress, rejectProgress } from "./report.ts";
import { runShell, tailLines } from "./shell.ts";
import { stopStrayListeners } from "./strays.ts";
import { ensureShim, withNornOnPath } from "./shim.ts";
import { equipWorktree } from "./worktrees.ts";

export interface ActRecord {
  decision: Decision;
  result: ActionResult;
}

/** Inbox groups that need a person; their new items are notified once (O3). */
const NOTIFY_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "unclaimed"];

class QueueFull extends Error {}
/** S6: a receipt number another writer (an agent verb, a person) took since observe. */
class ReceiptTaken extends Error {}

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

/** R1.2: a claim write lost to another heartbeat (CAS stale/rejected, held) — not a network failure. */
function claimLost(r: ActionResult): boolean {
  const reason = (r.detail as { reason?: string } | undefined)?.reason;
  return reason === "stale" || reason === "rejected" || reason === "held" || reason === "corrupt";
}

export class Actor {
  private readonly notified: Set<string>;
  readonly notifiedNow: string[] = [];
  /** what act changed locally this tick, for the post-act facts notifications are built from (O3) */
  private readonly written = new Map<string, UnitState>();
  private readonly claimed = new Map<string, { blob: ClaimBlob; sha: string }>();
  private readonly cleaned = new Set<string>();
  /** R4.3: effects of the current action that failed after its state was written (push, typed delivery) */
  private effectErrors: Array<{ effect: string; reason: string }> = [];
  /** R4.3: effects of the current action that succeeded */
  private effectsOk = new Set<string>();
  /** R4.3: session a failed delivery targeted (for the inbox item; R6.3 reuses it) */
  private failedSession: SessionRef | null = null;
  /** R4.3: unit key → last failed effect (machine-local `failures.json`) */
  private readonly failures: Record<string, ActFailure>;
  private failuresChanged = false;

  constructor(
    readonly ctx: Context,
    readonly obs: Observed,
  ) {
    this.notified = readNotified(obs.root);
    this.failures = readActFailures(obs.root);
  }

  get root() {
    return this.obs.root;
  }
  get git() {
    return this.obs.ports.git;
  }
  get config() {
    return this.obs.config;
  }
  get tick() {
    return this.obs.facts.tick_id;
  }
  private nowIso() {
    return this.ctx.clock.iso();
  }

  // ------------------------------------------------------------ dispatch

  async run(decisions: Decision[]): Promise<ActRecord[]> {
    const out: ActRecord[] = [];
    // R1.2: a story's renewal runs before its other actions; once it loses the CAS, nothing else of
    // that story is done this tick (R2.2: a checkout without the claim writes and pushes nothing)
    const order = [...decisions.filter((d) => isSideAction(d.action)), ...decisions.filter((d) => !isSideAction(d.action))];
    const lost = new Set<string>();
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
          result = await this.perform(d.action);
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
        return this.applyReceipts(a);
      case "start_unit":
        return this.startUnit(a);
      case "start_slices": {
        const details: unknown[] = [];
        let ok = true;
        for (const s of a.starts) {
          try {
            details.push({ unit: s.unit.key, ...(await this.startUnit(s)) });
          } catch (e) {
            ok = false;
            details.push({ unit: s.unit.key, ok: false, error: (e as Error).message });
          }
        }
        return ok ? { ok, detail: details } : { ok, error: "some slices failed to start", detail: details };
      }
      case "start_run":
        return this.startRun(a);
      case "nudge":
        return this.nudge(a);
      case "retry_fresh":
        return this.retryFresh(a);
      case "run_check":
        return this.runCheck(a);
      case "run_git":
        return this.runGit(a);
      case "classify":
        return this.classify(a);
      case "park": {
        const loc = this.unitLoc(a.unit);
        this.writeReceipts(loc.runsDir, a.receipts);
        if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
        await this.notify(a.notify);
        const committed = await this.commit(a.commit, a.unit, a.state, `${a.rule}: ${a.park.kind} — ${a.park.reason}`);
        return { ok: true, detail: committed };
      }
      case "mark_done":
        return this.markDone(a);
      case "commit_push": {
        const loc = this.unitLoc(a.unit);
        const rel = relative(a.commit.cwd, loc.runsDir);
        return { ok: true, detail: await this.commit(a.commit, a.unit, loc.state, null, [rel]) };
      }
      case "reject_receipt":
        return this.rejectReceipt(a);
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
        return this.claim(a);
      case "notify":
        await this.notify(a.item);
        return { ok: true };
      case "update_story_mirror":
        return this.mirror(a);
      case "cleanup_merged_story":
        return this.cleanupMerged(a);
      case "noop":
        return { ok: true };
      case "intake_story":
        return this.intake(a);
      case "reclaim_leases": {
        const removed = await reclaimLeases(this.ctx.home, a.files, this.liveness());
        return { ok: true, detail: { removed } };
      }
    }
  }

  // ------------------------------------------------------------ locations

  private storyLoc(key: string): StoryLoc {
    const s = this.obs.stories[key];
    if (!s) throw new Error(`unknown story ${key}`);
    return s;
  }

  private unitLoc(unit: UnitRef): UnitLoc {
    const u = this.obs.units[unit.key];
    if (u) return u;
    // a unit started this tick
    const s = this.storyLoc(unit.story);
    const root = s.worktree ?? s.root;
    return { unit, story: unit.story, root, runsDir: join(root, s.spec_dir, "runs", unit.dir), worktree: s.worktree, branch: s.branch, state: null, workflow: null };
  }

  private liveness() {
    return leaseLiveness((p) => this.obs.ports.process.isAlive(p));
  }

  // ------------------------------------------------------------ receipts / state / commit

  private writeReceipts(runsDir: string, receipts: NewReceipt[]): void {
    for (const r of receipts) {
      const res = writeReceiptAt(runsDir, r.n, r.receipt);
      if (!res.ok) throw new ReceiptTaken(`receipt number ${r.n} is taken by ${relative(this.root, res.file)} (S6)`);
    }
  }

  /** Write state.json (S5, last) and keep the in-memory location current for later actions this tick. */
  private writeUnitState(unit: UnitRef, runsDir: string, state: UnitState): void {
    writeState(runsDir, state);
    this.written.set(unit.key, state);
    const loc = this.obs.units[unit.key];
    if (loc) loc.state = state;
  }

  private async releaseRunLeases(unit: UnitRef, kinds: Array<"agent" | "check" | "slot">, runId?: string): Promise<string[]> {
    const listing = await listLeases(this.ctx.home, () => true);
    const out: string[] = [];
    for (const e of listing.live) {
      const l = e.lease;
      if (l.repo !== this.root || l.story !== unit.story || l.slice !== unit.slice || !kinds.includes(l.kind)) continue;
      if (runId && l.run_id !== runId && l.kind !== "slot") continue;
      if (releaseLease(this.ctx.home, e.file)) out.push(e.file);
    }
    return out;
  }

  /** Regenerate the handoff header (S9), add a heartbeat line (O6), commit with trailers (S4) and push (S8, T7). */
  private async commit(
    c: BoundaryCommit | null,
    unit: UnitRef | null,
    state: UnitState | null,
    heartbeat: string | null,
    paths?: string[],
  ): Promise<{ sha: string | null; pushed: boolean | null; push_error?: string; deferred?: string; refused?: string } | null> {
    if (!c) return null;
    if (unit && state) {
      const loc = this.unitLoc(unit);
      if (existsSync(loc.runsDir)) {
        const header = renderHandoffStatus(state, { workflow: loc.workflow })
          .split("\n")
          .filter((l) => !l.startsWith("<!--"))
          .join("\n");
        writeHandoffHeader(loc.runsDir, header);
        if (heartbeat) appendHandoffHeartbeat(loc.runsDir, `- ${heartbeat}`);
      }
    }
    let sha: string | null;
    try {
      sha = await this.git.commit(c.cwd, { message: c.message, trailers: c.trailers, ...(paths ? { paths } : {}) });
    } catch (e) {
      const code = (e as { code?: string }).code;
      // H1: an agent's merge or rebase is in progress in the worktree — norn's files wait there
      // uncommitted (git cannot commit them without concluding it); the next commit after it carries them
      if (code === GIT_IN_PROGRESS) return { sha: null, pushed: null, deferred: (e as Error).message };
      // H1: never create (or push) a norn commit recording conflict markers: a failed effect, Unblock item (R4.3)
      if (code === GIT_CONFLICT_MARKERS) {
        this.effectErrors.push({ effect: "commit", reason: `commit on ${c.branch} refused: ${(e as Error).message}` });
        return { sha: null, pushed: null, refused: (e as Error).message };
      }
      throw e;
    }
    this.effectsOk.add("commit");
    if (!c.push || !this.obs.remote) return { sha, pushed: null };
    const r = await this.pushBranch(c.cwd, c.branch, c.trailers);
    if (r.ok) this.effectsOk.add("push");
    // R4.3: committed but not pushed is a failed effect (the record is not on the remote, S8)
    else this.effectErrors.push({ effect: "push", reason: `push of ${c.branch} failed: ${r.message}` });
    return r.ok ? { sha, pushed: true } : { sha, pushed: false, push_error: r.message };
  }

  /**
   * Push a branch (T7: only the claim holder; decide acts only on held stories). Slice branches are
   * rebased by integrate, so they force-push. BS5.2: never publishes a commit that leaves conflict
   * markers (an agent's merge included); BS3.3a: a story branch someone pushed to meanwhile is
   * merged in (never rebased) and pushed again.
   */
  private async pushBranch(cwd: string, branch: string, trailers: Record<string, string> = {}): Promise<{ ok: true } | { ok: false; message: string }> {
    const remote = this.obs.remote;
    if (!remote) return { ok: true };
    const held = await this.markersHeld(cwd, remote, branch);
    if (held) return { ok: false, message: held };
    const force = branch.includes("/") ? "+" : "";
    const push = () => this.git.push(cwd, remote, `${force}refs/heads/${branch}:refs/heads/${branch}`);
    let r = await push();
    if (!r.ok && r.reason === "rejected" && !force) {
      const taken = await this.takeRemoteBranch(cwd, remote, branch, trailers);
      if (taken !== true) return { ok: false, message: `${r.reason}: ${r.message}${taken ? `; ${taken}` : ""}` };
      r = await push();
    }
    return r.ok ? { ok: true } : { ok: false, message: `${r.reason}: ${r.message}` };
  }

  /** BS5.2 (dogfood D5): why the push of `branch` is held — its unpublished commits leave conflict markers — or null. */
  private async markersHeld(cwd: string, remote: string, branch: string): Promise<string | null> {
    const marked = await this.git.outgoingConflictMarkers(cwd, remote, `refs/heads/${branch}`);
    if (!marked.length) return null;
    const where = marked.map((m) => `${m.path}${m.commit ? ` (commit ${m.commit.slice(0, 12)})` : ""}`);
    return `held: conflict markers in ${where.join(", ")}; nothing pushed — resolve them in a new commit (never rewrite the branch)`;
  }

  /**
   * BS3.3a (dogfood D4): the push of the story branch was rejected — someone pushed to it. Take the
   * remote branch in (fast-forward, else a merge commit with norn's trailers); true when the push may
   * be retried, else why not (null = nothing new on the remote, e.g. a protected branch).
   */
  private async takeRemoteBranch(cwd: string, remote: string, branch: string, trailers: Record<string, string>): Promise<true | string | null> {
    try {
      if ((await this.git.status(cwd)).branch !== branch) return `${branch} is not checked out in ${cwd}`;
      const r = await syncRemoteBranch(this.git, { cwd, branch, remote, message: `Merge ${remote}/${branch} into ${branch}`, trailers: { ...trailers, "Norn-Tick": this.tick } });
      if (r.outcome === "conflict") return `story branch diverged from ${remote}/${branch}; merging it conflicts in ${r.files.join(", ") || "?"} — merge it in ${cwd} by hand`;
      return r.outcome === "adopted" || r.outcome === "merged" ? true : null;
    } catch (e) {
      return `taking in ${remote}/${branch} failed: ${(e as Error).message}`;
    }
  }

  // ------------------------------------------------------------ notifications (O3)

  /** Notify once per inbox item id; the id is persisted before sending (receipt-first). */
  async notify(item: InboxItem | null): Promise<void> {
    if (!item || this.notified.has(item.id)) return;
    markNotified(this.root, this.notified, item.id);
    this.notifiedNow.push(item.id);
    for (const n of this.obs.ports.notifiers) {
      try {
        await n.notify(item);
      } catch {
        /* notifiers are best-effort; the inbox is the truth */
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

  // ------------------------------------------------------------ runner

  private async kill(session: SessionRef | null): Promise<boolean> {
    const runner = this.obs.ports.runner;
    if (!session || !runner || session.runner !== runner.name) return false;
    await runner.kill(session).catch(() => undefined);
    return true;
  }

  /** Launch an agent session for a run (A6, B5), holding an agent lease (K1). */
  private async launch(unit: UnitRef, launch: AgentLaunch): Promise<{ session: SessionRef; lease: string }> {
    const runner = this.obs.ports.runner;
    if (!runner) throw new Error("no runner configured (MO2)");
    const agent = this.obs.ports.agents[launch.agent];
    if (!agent) throw new Error(`agent '${launch.agent}' is not configured`);
    const lease = await acquireRunLease(this.ctx.home, "agent", this.config.max_agents, {
      repo: this.root,
      story: unit.story,
      slice: unit.slice,
      run_id: launch.run_id,
      now: this.nowIso(),
      liveness: this.liveness(),
    });
    if (!lease.ok) throw new QueueFull(`queued: max_agents ${this.config.max_agents} in use (K1)`);
    try {
      const env = { ...(readEnvNorn(launch.cwd) ?? {}), ...launch.env, NORN_HOME: this.root };
      const cfg = this.config.agents[launch.agent];
      const cmd = agent.launchCommand({
        cwd: launch.cwd,
        prompt: launch.prompt,
        env,
        headless: runner.name === "headless",
        config: { ...(cfg?.command ? { command: cfg.command } : {}), ...(cfg?.args ? { args: cfg.args } : {}), ...(cfg?.env ? { env: cfg.env } : {}) },
        ...(launch.model ? { model: launch.model } : {}),
        ...(launch.resume ? { resume: launch.resume } : {}),
      });
      // R8.1 (A1): the agent's `norn` is this norn — shim first on PATH inside the command itself
      const onPath = withNornOnPath(cmd.argv, ensureShim(this.ctx.home), this.ctx.env.PATH);
      const session = await runner.launch({ cwd: launch.cwd, argv: onPath.argv, env: { ...env, ...cmd.env, ...onPath.env }, title: launch.title, run_id: launch.run_id });
      // K1/K3: the lease must outlive this tick. With an agent process it follows that process; without
      // one (pane runners) it carries the worktree and stays live while the run is running (leases.ts).
      if (session.process) updateLease(this.ctx.home, lease.entry.file, { ...lease.entry.lease, holder: session.process });
      else updateLease(this.ctx.home, lease.entry.file, { ...lease.entry.lease, worktree: launch.cwd });
      return { session, lease: lease.entry.file };
    } catch (e) {
      releaseLease(this.ctx.home, lease.entry.file);
      throw e;
    }
  }

  /**
   * The decided `started` receipt carries no session (it is written before the launch, P6).
   * Record the session in a second `started` receipt for the same run and apply it, so
   * state.run.session / process are filled exactly as a later apply would.
   */
  private recordSession(unit: UnitRef, runsDir: string, decided: UnitState, receipts: NewReceipt[], session: SessionRef): UnitState {
    const started = [...receipts].reverse().find((r) => r.receipt.kind === "started")?.receipt as ReceiptOf<"started"> | undefined;
    const wf = this.unitWorkflow(unit);
    if (!started || !wf) return decided;
    const r: ReceiptOf<"started"> = {
      ...started,
      receipt_id: ulid(this.ctx.clock.now()),
      at: this.nowIso(),
      session: { runner: session.runner, session_id: session.session_id, ...(session.pane_id ? { pane_id: session.pane_id } : {}), ...this.reachOf(session) },
      ...(session.process ? { process: session.process } : {}),
    };
    const n = Math.max(...receipts.map((x) => x.n)) + 1;
    const res = writeReceiptAt(runsDir, n, r);
    if (!res.ok) throw new Error(`receipt number ${n} is taken (S6)`);
    return applyReceipts(decided, [{ n, file: "", receipt: r }], { workflow: wf, now: this.nowIso(), limits: this.config.limits, tick_id: this.tick }).state;
  }

  /** R6.3, R9.1: how a person reaches the session, recorded with it for the inbox */
  private reachOf(session: SessionRef): { reach?: string } {
    const runner = this.obs.ports.runner;
    const reach = runner?.reach && runner.name === session.runner ? runner.reach(session) : undefined;
    return reach ? { reach } : {};
  }

  private unitWorkflow(unit: UnitRef): Workflow | null {
    return this.obs.units[unit.key]?.workflow ?? null;
  }

  // ------------------------------------------------------------ unit actions

  private async applyReceipts(a: Extract<Action, { kind: "apply_receipts" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const prevRun = loc.state?.run?.run_id;
    let state = a.state;
    let resumed: SessionRef | null = null;
    // S7/O2: the cursor moved off a live run (workflow --to / unstick): stop it before the new state
    const killed = await this.kill(a.kill ?? null);
    if (a.launch) {
      // B2: resume the same agent session with the answer as the prompt (headless / session gone)
      ({ session: resumed } = await this.launchAfterReceipts(a.unit, loc.runsDir, a.receipts, a.launch));
      if (state) state = this.recordSession(a.unit, loc.runsDir, state, a.receipts, resumed);
    } else
      try {
        this.writeReceipts(loc.runsDir, a.receipts);
      } catch (e) {
        // R6.1, B11: the tick resolving an implicit ask raced the agent's own report, whose `answer`
        // (`by: "agent"`) took the number first. S6 keeps the first; the ask is closed either way, so
        // this is not a failed action — nothing else is written, the next tick applies the report.
        if (e instanceof ReceiptTaken && a.rule === "agent.ask.implicit.resolved") return { ok: true, detail: { superseded: e.message } };
        throw e;
      }
    for (const r of a.rejected) this.traceReject(a.unit.key, `receipt ${r.n}`, r.reason, { receipt_id: r.receipt_id });
    let keyed = false;
    const keys = a.input?.keys;
    if (a.input && keys) {
      // R6.2/R6.3: an answer to a pane prompt is typed as its keystrokes before state is written —
      // a failed delivery leaves the unit parked on the ask (the next tick tries again)
      const input = a.input;
      try {
        const runner = this.obs.ports.runner;
        if (!runner || runner.name !== input.session.runner) throw new Error("the session's runner is not available here");
        if (!runner.sendKeys) throw new Error(`runner ${runner.name} cannot type into a prompt`);
        await runner.sendKeys(input.session, keys);
      } catch (e) {
        this.failedSession = input.session;
        throw new Error(`answer to ${a.unit.key} not delivered: ${(e as Error).message}`);
      }
      this.effectsOk.add("answer");
      keyed = true;
    }
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    const released =
      state && state.status !== "running"
        ? await this.releaseRunLeases(a.unit, ["agent"])
        : a.kill && prevRun
          ? await this.releaseRunLeases(a.unit, ["agent"], prevRun)
          : [];
    const summary = a.advance ? `${a.advance.from}.${a.advance.outcome} → ${a.advance.to}${a.advance.reset ? ` (reset ${a.advance.reset.join(", ")})` : ""}` : `applied ${a.applied.join(", ") || "none"}`;
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: ${summary}`);
    let delivered: boolean | string = resumed ? "resumed" : keyed;
    if (resumed) this.effectsOk.add("resume");
    if (a.input && !keyed) {
      // B2: the answer goes into the same session after state is written
      try {
        const runner = this.obs.ports.runner;
        if (!runner || runner.name !== a.input.session.runner) throw new Error("session's runner is not available here");
        await runner.send(a.input.session, a.input.text, { submit: true });
        delivered = true;
        this.effectsOk.add("answer");
      } catch (e) {
        delivered = `not delivered: ${(e as Error).message}`;
        // R4.3 (A4): the state is written, but the answer never reached the agent — not ok
        this.effectErrors.push({ effect: "answer", reason: `answer to ${a.unit.key} not delivered: ${(e as Error).message}` });
        this.failedSession = a.input.session;
      }
    }
    return { ok: true, detail: { ...committed, released, delivered, ...(a.kill ? { killed } : {}), ...(resumed ? { session: resumed } : {}) } };
  }

  /** Create a unit worktree (K4, K5): branch, worktree, slot lease, `.env.norn`, `.norn-unit`. */
  private async ensureWorktree(spec: WorktreeSpec, unit: UnitRef, spec_dir: string): Promise<{ created: boolean; slot: number | null }> {
    let created = false;
    if (!existsSync(spec.path)) {
      const exists = await this.git.branchExists(this.root, spec.branch);
      // F33: a new story branch starts from the fetched base (`<remote>/<base>`), not a stale local `main`
      const tracking = this.obs.remote && spec.from === this.obs.facts.repo.default_branch ? `refs/remotes/${this.obs.remote}/${spec.from}` : null;
      // (by sha: a remote-tracking start point would make it the new branch's upstream)
      const from = (tracking ? await this.git.readRef(this.root, tracking).catch(() => null) : null) ?? spec.from;
      await this.git.worktreeAdd(this.root, spec.path, spec.branch, exists ? undefined : { from });
      created = true;
    }
    const slot = await equipWorktree(
      { root: this.root, home: this.ctx.home, config: this.config, now: this.nowIso(), liveness: this.liveness(), preferredSlot: spec.slot !== null ? { slot: spec.slot, env: spec.env } : null },
      { path: spec.path, branch: spec.branch, story: unit.story, slice: unit.slice, unit: unit.dir, spec_dir },
    );
    return { created, slot };
  }

  private async startUnit(a: Extract<Action, { kind: "start_unit" }>): Promise<ActionResult> {
    const story = this.storyLoc(a.unit.story);
    const detail: Record<string, unknown> = {};
    if (a.slice_status && a.unit.slice) {
      // planned → active on the story branch first, so the slice branch is cut with it
      const nn = a.unit.dir.split("-")[0] as string;
      const slug = a.unit.dir.slice(nn.length + 1);
      const storyWt = story.worktree ?? story.root;
      const file = sliceFilePath(join(storyWt, story.spec_dir), nn, slug);
      const r = patchSliceFile(file, { status: a.slice_status }, storyWt);
      if (!r.ok) throw new Error(`cannot set ${relative(storyWt, file)} status: ${r.reason}`);
      detail.slice_status = await this.git.commit(storyWt, {
        message: `norn: ${a.unit.key} ${a.slice_status}`,
        trailers: { "Norn-Story": a.unit.story, "Norn-Slice": a.unit.slice, "Norn-Step": a.state?.step ?? "start", "Norn-Tick": this.tick },
        paths: [relative(storyWt, file)],
      });
    }
    let wtPath = story.worktree;
    if (a.worktree) {
      detail.worktree = await this.ensureWorktree(a.worktree, a.unit, story.spec_dir);
      wtPath = a.worktree.path;
    }
    if (!wtPath) throw new Error(`no worktree for ${a.unit.key}`);
    const runsDir = join(wtPath, story.spec_dir, "runs", a.unit.dir);
    const pin = pinWorkflow(runsDir, a.workflow_source);
    if (!pin.ok) throw new Error(`runs/${a.unit.dir}/workflow.yaml is already pinned with different content (S7)`);
    this.obs.units[a.unit.key] = {
      unit: a.unit,
      story: a.unit.story,
      root: wtPath,
      runsDir,
      worktree: wtPath,
      branch: a.worktree?.branch ?? story.branch,
      state: null,
      workflow: null,
    };
    this.writeReceipts(runsDir, a.receipts);
    if (a.state) this.writeUnitState(a.unit, runsDir, a.state);
    if (a.unit.slice === null) {
      const r = patchStoryFile(storyFile(join(wtPath, story.spec_dir)), { status: "active" }, wtPath);
      detail.story_status = r.ok ? "active" : r.reason;
    }
    detail.commit = await this.commit(a.commit, a.unit, a.state, `${a.rule}: ${a.workflow} at ${a.state?.step ?? "?"}`);
    return { ok: true, detail };
  }

  private async startRun(a: Extract<Action, { kind: "start_run" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const { session, lease } = await this.launchAfterReceipts(a.unit, loc.runsDir, a.receipts, a.launch);
    this.effectsOk.add("launch");
    const state = a.state ? this.recordSession(a.unit, loc.runsDir, a.state, a.receipts, session) : null;
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    // R2.1 (N6): commit and push the started receipts now — only runs/, never the agent's fresh work
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: ${a.step} run ${a.launch.run_id}`, a.commit ? [relative(a.commit.cwd, loc.runsDir)] : undefined);
    return { ok: true, detail: { session, lease, ...committed } };
  }

  /**
   * K1 is checked before anything is written (a full machine just queues). Then receipts (P6),
   * then the launch. A failed launch leaves the started receipt; the next tick applies it and
   * classification (stalled/timeout) bounds the run.
   */
  private async launchAfterReceipts(unit: UnitRef, runsDir: string, receipts: NewReceipt[], launch: AgentLaunch, beforeLaunch?: () => Promise<unknown>) {
    const listing = await listLeases(this.ctx.home, this.liveness());
    const agents = listing.live.filter((e) => e.lease.kind === "agent" && e.lease.run_id !== launch.run_id).length;
    if (agents >= this.config.max_agents) throw new QueueFull(`queued: max_agents ${this.config.max_agents} in use (K1)`);
    this.writeReceipts(runsDir, receipts);
    await beforeLaunch?.();
    return this.launch(unit, launch);
  }

  /**
   * R4.2: deliver a counted nudge — typed into the live session (`input`), or by resuming the agent
   * session with the nudge text (`launch`) after terminating the old process. R4.3: a failed delivery
   * throws (ok: false; the classify receipt stays and is applied next tick, the nudge counted) and is
   * kept as the unit's act failure for the inbox.
   */
  private async nudge(a: Extract<Action, { kind: "nudge" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const runId = a.input?.run_id ?? a.launch?.run_id ?? "unknown";
    let resumed: SessionRef | null = null;
    if (a.launch) {
      const launch = a.launch;
      const kill = a.kill;
      try {
        ({ session: resumed } = await this.launchAfterReceipts(a.unit, loc.runsDir, a.receipts, launch, async () => {
          await this.kill(kill);
          // the old process held the run's agent lease; the resumed one takes it over (K1)
          await this.releaseRunLeases(a.unit, ["agent"], launch.run_id);
        }));
      } catch (e) {
        if (e instanceof QueueFull) throw e;
        this.failedSession = kill;
        throw new Error(`nudge to ${a.unit.key} not delivered: resume failed: ${(e as Error).message}`);
      }
      this.effectsOk.add("resume");
    } else this.writeReceipts(loc.runsDir, a.receipts);
    const snapshot = await this.snapshot(a.unit, runId, a.snapshot);
    if (a.input) {
      const runner = this.obs.ports.runner;
      try {
        if (!runner || runner.name !== a.input.session.runner) throw new Error("the run's runner is not available on this machine");
        await runner.send(a.input.session, a.input.text, { submit: true });
      } catch (e) {
        this.failedSession = a.input.session;
        throw new Error(`nudge to ${a.unit.key} not delivered: ${(e as Error).message}`);
      }
      this.effectsOk.add("nudge");
    }
    let state = a.state;
    if (state && resumed) state = this.recordSession(a.unit, loc.runsDir, state, a.receipts, resumed);
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: nudged ${state?.nudges_used ?? "?"}${resumed ? " (resumed)" : ""}`);
    return { ok: true, detail: { ...committed, ...(resumed ? { session: resumed } : {}) }, ...(snapshot ? { transcript: snapshot } : {}) };
  }

  private async retryFresh(a: Extract<Action, { kind: "retry_fresh" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    let state = a.state;
    let session: SessionRef | null = null;
    await this.releaseRunLeases(a.unit, ["agent"]);
    if (a.launch) {
      // receipts, kill the old session, then the fresh one (B2, C1)
      ({ session } = await this.launchAfterReceipts(a.unit, loc.runsDir, a.receipts, a.launch, () => this.kill(a.kill)));
      this.effectsOk.add("launch");
      if (state) state = this.recordSession(a.unit, loc.runsDir, state, a.receipts, session);
    } else {
      this.writeReceipts(loc.runsDir, a.receipts);
      await this.kill(a.kill);
    }
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: fresh session${session ? "" : " (ready)"}`);
    return { ok: true, detail: { session, ...committed } };
  }

  /** W2/C5: run the command in the worktree with `.env.norn`; write the check receipt after. */
  private async runCheck(a: Extract<Action, { kind: "run_check" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const attempt = loc.state?.attempt;
    if (!attempt) throw new Error(`${a.unit.key} has no state`);
    const lease = await acquireRunLease(this.ctx.home, "check", this.config.max_checks, {
      repo: this.root,
      story: a.unit.story,
      slice: a.unit.slice,
      run_id: a.run_id,
      now: this.nowIso(),
      liveness: this.liveness(),
    });
    if (!lease.ok) throw new QueueFull(`queued: max_checks ${this.config.max_checks} in use (K1)`);
    try {
      const env = { ...process.env, ...this.ctx.env, ...(readEnvNorn(a.cwd) ?? {}), ...a.env, NORN_HOME: this.root };
      // K4.1: a server an agent left running from this worktree must not hold the slot's ports
      const portBase = Number((env as Record<string, string | undefined>).PORT_BASE);
      const stopped = Number.isInteger(portBase) && portBase > 0
        ? await stopStrayListeners(a.cwd, { from: portBase, to: portBase + this.config.slots.ports_per_slot - 1 })
        : [];
      const res = await runShell(a.command, { cwd: a.cwd, env, timeoutMs: a.timeout_ms });
      if (stopped.length) res.output = `${stopped.map((s) => `norn: stopped pid ${s.pid} (${s.command}) left listening on :${s.port} from this worktree (K4.1)`).join("\n")}\n${res.output}`;
      const pass = !res.timed_out && res.exit_code === 0;
      const receipt: ReceiptOf<"check"> = {
        kind: "check",
        receipt_id: ulid(this.ctx.clock.now()),
        run_id: a.run_id,
        step: a.step,
        attempt,
        at: this.nowIso(),
        by: "norn",
        who: this.obs.facts.machine.holder,
        tick_id: this.tick,
        outcome: pass ? "pass" : "fail",
        command: a.command,
        exit_code: res.exit_code,
        duration_ms: res.duration_ms,
        output_tail: tailLines(res.output, 200),
        ...(res.timed_out ? { reason: "timeout" as const } : {}),
      };
      if (!pass) receipt.log = writeLog(loc.runsDir, a.run_id, res.output);
      const written = appendReceipt(loc.runsDir, receipt);
      return { ok: true, detail: { outcome: receipt.outcome, exit_code: res.exit_code, duration_ms: res.duration_ms, receipt: written.n, ...(receipt.log ? { log: receipt.log } : {}) } };
    } finally {
      releaseLease(this.ctx.home, lease.entry.file);
    }
  }

  /** W2 git steps (K6, open-pr, BS3 update); the outcome is a `classify` receipt written after the effect. */
  private async runGit(a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
    if (a.action !== "integrate" && a.action !== "update") return this.runGitLocked(a);
    // K6/BS3: slice integrations and base updates of one story never interleave, across processes too
    mkdirSync(traceDir(this.root), { recursive: true });
    const lock = await acquireIntegrateLock(this.root, a.unit.story, { now: () => this.nowIso(), note: `${a.unit.key} ${a.action}` });
    if (!lock.ok) throw new QueueFull(`integrate lock of ${a.unit.story} is held (pid ${lock.holder.holder.pid}); retried next tick (K6)`);
    try {
      return await this.runGitLocked(a);
    } finally {
      lock.release();
    }
  }

  /** BS3: push the updated story branch; a refused push is a failed effect (R4.3), the receipt still stands. */
  private async pushUpdated(cwd: string, branch: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const r = await this.pushBranch(cwd, branch);
    if (r.ok) this.effectsOk.add("push");
    else this.effectErrors.push({ effect: "push", reason: `push of ${branch} failed: ${r.message}` });
    return r;
  }

  private async runGitLocked(a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const st = loc.state;
    const wf = loc.workflow;
    if (!st || !wf) throw new Error(`${a.unit.key} has no state or pinned workflow`);
    let outcome: "done" | "conflict" | "stuck";
    let detail: string;
    let base: ReceiptOf<"classify">["base"];
    const extra: Record<string, unknown> = {};
    switch (a.action) {
      case "update": {
        const u = a.update;
        if (!u) throw new Error("update without a base");
        const res = await updateStory(this.git, { cwd: a.cwd, branch: a.branch, baseSha: u.sha, remote: this.obs.remote, message: u.message, trailers: u.trailers });
        if (res.outcome === "stuck") {
          // BS3 step 1/3: dirty worktree, diverged story branch → $stuck with the reason
          outcome = "stuck";
          detail = res.reason;
          break;
        }
        if (res.adopted) extra.adopted = res.adopted;
        if (res.outcome === "conflict") {
          // BS3 step 6: the merge was aborted; the resolve step gets the base sha and the paths
          outcome = "conflict";
          base = { ref: u.ref, sha: u.sha, conflicts: res.files };
          detail = `merging ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} conflicts in ${res.files.join(", ") || "?"}`;
          // an adopted fast-forward is still the record: publish it (S8)
          if (res.adopted) extra.story_push = await this.pushUpdated(a.cwd, a.branch);
          break;
        }
        outcome = "done";
        // BS3: the merge commit (or the head found up to date) goes into the record, for status and why
        base = { ref: u.ref, sha: u.sha, conflicts: [], head: res.head, merged: res.merged };
        detail = res.merged ? `merged ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} at ${res.head.slice(0, 12)}` : `${a.branch} is up to date with ${u.branch} (${u.sha.slice(0, 12)})`;
        // BS3 step 5: pushed at the step boundary (S8, T7), as integrate does
        if (res.merged || res.adopted) extra.story_push = await this.pushUpdated(a.cwd, a.branch);
        break;
      }
      case "integrate": {
        if (!a.onto) throw new Error("integrate without a story branch");
        const res = await integrate(this.git, { sliceCwd: a.cwd, storyBranch: a.onto });
        if (res.outcome === "conflict") {
          outcome = "conflict";
          detail = `rebase onto ${a.onto} conflicts in ${res.files.join(", ") || "?"}`;
        } else {
          outcome = "done";
          detail = `${a.branch} integrated into ${a.onto} at ${res.head.slice(0, 12)}`;
          extra.story_push = await this.pushBranch(a.cwd, a.onto);
        }
        break;
      }
      case "push": {
        const r = await this.pushBranch(a.cwd, a.branch);
        if (!r.ok) throw new Error(`push failed: ${r.message}`);
        outcome = "done";
        detail = this.obs.remote ? `pushed ${a.branch}` : `no git remote; nothing to push`;
        break;
      }
      case "open-pr": {
        const remote = this.obs.ports.remote;
        if (!remote) throw new Error("no remote provider configured");
        if (!a.pr) throw new Error("open-pr without PR details");
        const pushed = await this.pushBranch(a.cwd, a.branch);
        if (!pushed.ok) throw new Error(`push failed: ${pushed.message}`);
        let pr = await remote.findPullRequest(a.branch);
        if (!pr || pr.state !== "open") pr = await remote.openDraftPullRequest({ head: a.branch, base: a.pr.base, title: a.pr.title, body: a.pr.body });
        outcome = "done";
        detail = `draft PR #${pr.number} ${pr.url}`;
        extra.pr = pr;
        break;
      }
    }
    const receipt: ReceiptOf<"classify"> = {
      kind: "classify",
      receipt_id: ulid(this.ctx.clock.now()),
      run_id: a.run_id,
      step: a.step,
      attempt: st.attempt,
      at: this.nowIso(),
      by: "norn",
      who: this.obs.facts.machine.holder,
      tick_id: this.tick,
      outcome,
      rule: a.rule,
      detail,
      route: "$stuck", // set below from the in-memory apply
      ...(base ? { base } : {}),
    };
    // §10, W4: the route is where applying this receipt sends the unit — an exhausted counter
    // (e.g. integrate.conflict past conflict_loop's max) records `$stuck`, not the edge's target.
    // A receipt apply would refuse moves nothing; it keeps `$stuck`.
    const applied = applyReceipts(st, [{ n: st.applied_through + 1, file: "", receipt }], { workflow: wf, now: receipt.at, limits: this.config.limits, tick_id: this.tick });
    receipt.route = routeOf(applied) ?? "$stuck";
    const written = appendReceipt(loc.runsDir, receipt);
    return { ok: true, detail: { outcome, detail, receipt: written.n, ...extra } };
  }

  private async classify(a: Extract<Action, { kind: "classify" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    this.writeReceipts(loc.runsDir, a.receipts);
    const killed = await this.kill(a.kill);
    const runId = loc.state?.run?.run_id ?? a.receipts[0]?.receipt.run_id ?? "none";
    const transcript = await this.snapshot(a.unit, runId, a.snapshot);
    if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
    const released = a.state && a.state.status !== "running" ? await this.releaseRunLeases(a.unit, ["agent"]) : [];
    const committed = await this.commit(a.commit, a.unit, a.state, `${a.rule}: ${a.outcome}`);
    return { ok: true, detail: { killed, released, ...committed }, ...(transcript ? { transcript } : {}) };
  }

  /** C4: last assistant message + head + diff stat into the trace; a pointer line in the handoff. */
  private async snapshot(unit: UnitRef, runId: string, req: { transcript: string | null; cwd: string } | null): Promise<string | null> {
    if (!req) return null;
    const loc = this.unitLoc(unit);
    const agentName = loc.state?.run?.agent ?? this.config.default_agent;
    const agent = this.obs.ports.agents[agentName];
    const last = req.transcript && agent ? await agent.lastAssistantMessage(req.transcript).catch(() => null) : null;
    const head = req.cwd ? await this.git.revParse(req.cwd, "HEAD").catch(() => null) : null;
    const diff = req.cwd ? await this.git.diffStat(req.cwd, "HEAD").catch(() => "") : "";
    const text = [`# snapshot ${unit.key} run ${runId}`, `head: ${head ?? "?"}`, "", "## last assistant message", last ?? "(none)", "", "## diff --stat HEAD", diff || "(clean)"].join("\n");
    const rel = writeTranscriptSnapshot(this.root, /^[0-9A-Z]{26}$/.test(runId) ? runId : "unknown", ulid(this.ctx.clock.now()), text);
    if (existsSync(loc.runsDir)) appendHandoffHeartbeat(loc.runsDir, `- silent: last message snapshot in trace/${rel}`);
    return rel;
  }

  private async markDone(a: Extract<Action, { kind: "mark_done" }>): Promise<ActionResult> {
    const story = this.storyLoc(a.unit.story);
    const storyWt = story.worktree;
    const detail: Record<string, unknown> = {};
    const loc = this.unitLoc(a.unit);
    this.writeReceipts(loc.runsDir, a.receipts);
    if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
    const wt = a.cleanup.worktree;
    if (wt && existsSync(wt) && a.unit.slice) {
      // the slice's final state commit ($done) lands after integration: bring it into the story branch
      const res = await integrate(this.git, { sliceCwd: wt, storyBranch: story.branch, ...(storyWt ? { storyCwd: storyWt } : {}) });
      if (res.outcome === "conflict") throw new Error(`cannot bring ${a.unit.key}'s final state into ${story.branch}: conflict in ${res.files.join(", ")}`);
    }
    if (a.slice_status && a.unit.slice && storyWt) {
      const nn = a.unit.dir.split("-")[0] as string;
      const file = sliceFilePath(join(storyWt, story.spec_dir), nn, a.unit.dir.slice(nn.length + 1));
      const r = patchSliceFile(file, { status: a.slice_status }, storyWt);
      if (!r.ok) throw new Error(`cannot set ${relative(storyWt, file)} status: ${r.reason}`);
      detail.commit = await this.commit(
        { cwd: storyWt, branch: story.branch, message: `norn: ${a.unit.key} ${a.slice_status}`, trailers: nornTrailers(this.tick, a.unit.story, a.unit.slice, "$done"), push: true },
        null,
        null,
        null,
        [relative(storyWt, file)],
      );
    }
    if (wt && existsSync(wt)) {
      await this.git.worktreeRemove(this.root, wt).catch(() => this.git.worktreeRemove(this.root, wt, { force: true }));
      detail.worktree_removed = wt;
    }
    if (a.cleanup.release_slot) detail.released = await this.releaseRunLeases(a.unit, ["slot", "agent", "check"]);
    // decide names the branch only when it is in the story branch (or the integration above put it there)
    const b = a.cleanup.branch_local;
    if (b && (await this.git.branchExists(this.root, b))) {
      await this.git.deleteBranch(this.root, b, { force: true });
      detail.branch_deleted = b;
    } else if (a.cleanup.branch_kept) detail.branch_kept = a.cleanup.branch_kept;
    if (a.commit) detail.unit_commit = await this.commit(a.commit, a.unit, a.state, `${a.rule}`);
    return { ok: true, detail };
  }

  private async rejectReceipt(a: Extract<Action, { kind: "reject_receipt" }>): Promise<ActionResult> {
    if ("ref" in a.source) {
      const res = await deleteMailbox(this.root, this.obs.remote, a.source.ref, a.source.sha);
      this.traceReject(a.unit.key, a.source.ref, a.reason, { sha: a.source.sha });
      return { ok: true, detail: { deleted: res.ok } };
    }
    const loc = this.unitLoc(a.unit);
    if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
    this.traceReject(a.unit.key, `receipt ${a.source.n}`, a.reason);
    return { ok: true };
  }

  private traceReject(unit: string, source: string, reason: string, payload?: unknown): void {
    appendTrace(this.root, { type: "reject", id: ulid(this.ctx.clock.now()), at: this.nowIso(), tick_id: this.tick, unit, source, reason, ...(payload === undefined ? {} : { payload }) });
  }

  // ------------------------------------------------------------ claims (T3–T6)

  private async claim(a: Extract<Action, { kind: "claim" }>): Promise<ActionResult> {
    const story = a.unit.story;
    const remote = this.obs.remote;
    if (a.op === "release") {
      const r = await releaseClaim(this.root, remote, story, a.expected ?? "");
      return r.ok ? { ok: true } : { ok: false, error: r.message };
    }
    if (!a.blob) throw new Error("claim without blob");
    const r = a.op === "acquire" ? await acquireClaim(this.root, remote, a.blob, { now: this.obs.facts.now }) : await renewClaim(this.root, remote, a.blob, a.expected ?? "");
    if (r.ok) this.claimed.set(story, { blob: a.blob, sha: r.sha });
    if (r.ok) return { ok: true, detail: { sha: r.sha } };
    const detail: Record<string, unknown> = { reason: r.reason };
    // R3.1 (H6): the intake race is lost — undo what the intake made here, unless it holds work
    if (a.rule === "claim.acquire.intake" && claimLost({ ok: false, detail })) detail.intake = await this.dropLostIntake(story, a.lost_intake).catch((e: Error) => ({ kept: `clean-up failed: ${e.message}` }));
    return { ok: false, error: r.message, detail };
  }

  /**
   * R3.1: after losing `claim.acquire.intake`, remove what decide said holds nothing beyond the
   * intake (`lost_intake.drop`): the story worktree, its local branch (and the spec folder in it) and
   * its slot. Otherwise keep everything; observe then reports the local work (R2.3).
   */
  private async dropLostIntake(story: string, lost: Extract<Action, { kind: "claim" }>["lost_intake"]): Promise<{ removed: string[] } | { kept: string }> {
    if (!lost) return { kept: "not decided: the intake branch was not observed" };
    if ("keep" in lost) return { kept: lost.keep };
    const wt = lost.drop.worktree;
    const removed: string[] = [];
    if (wt && existsSync(wt)) {
      await this.git.worktreeRemove(this.root, wt, { force: true });
      removed.push(wt);
    }
    if (await this.git.branchExists(this.root, lost.drop.branch)) {
      await this.git.deleteBranch(this.root, lost.drop.branch, { force: true });
      removed.push(lost.drop.branch);
    }
    const listing = await listLeases(this.ctx.home, () => true);
    for (const e of listing.live) if (e.lease.repo === this.root && e.lease.story === story && releaseLease(this.ctx.home, e.file)) removed.push(e.file);
    return { removed };
  }

  // ------------------------------------------------------------ remote lifecycle (GR2, GR6, GR8)

  private async intake(a: Extract<Action, { kind: "intake_story" }>): Promise<ActionResult> {
    const unit: UnitRef = { story: a.key, slice: null, dir: STORY_UNIT_DIR, key: a.key };
    const specDir = dirname(a.story_file);
    // T5/T10: a story already intaken elsewhere (its branch is on the remote) is continued by take, never re-intaken
    if (this.obs.remote && !existsSync(a.worktree.path) && !(await this.git.branchExists(this.root, a.worktree.branch)) && (await this.git.branchExists(this.root, a.worktree.branch, "remote", this.obs.remote)))
      return { ok: true, detail: { skipped: `${a.worktree.branch} already exists on ${this.obs.remote}`, do_instead: `norn take ${a.key}` } };
    const wt = await this.ensureWorktree(a.worktree, unit, specDir);
    const file = join(a.worktree.path, a.story_file);
    const written = !existsSync(file);
    if (written) writeStoryFile(file, a.frontmatter, a.body.endsWith("\n") || !a.body ? `\n${a.body}` : `\n${a.body}\n`);
    const committed = await this.commit(a.commit, null, null, null);
    return { ok: true, detail: { worktree: a.worktree.path, ...wt, story_file: written ? a.story_file : "exists", ...committed } };
  }

  private async mirror(a: Extract<Action, { kind: "update_story_mirror" }>): Promise<ActionResult> {
    const story = this.storyLoc(a.unit.story);
    if (!story.worktree) return { ok: true, detail: { skipped: "no story worktree; story.md is never written in the main checkout" } };
    const r = patchStoryFile(storyFile(join(story.worktree, story.spec_dir)), a.fields, story.worktree);
    if (!r.ok) throw new Error(`cannot update story.md: ${r.reason}`);
    await this.notify(a.notify);
    return { ok: true, detail: await this.commit(a.commit, null, null, null) };
  }

  private async cleanupMerged(a: Extract<Action, { kind: "cleanup_merged_story" }>): Promise<ActionResult> {
    const detail: Record<string, unknown> = {};
    const errors: string[] = [];
    this.cleaned.add(a.unit.story);
    const tryDo = async (what: string, f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        errors.push(`${what}: ${(e as Error).message}`);
      }
    };
    // slice worktrees first, the story worktree last
    for (const wt of [...a.worktrees].reverse()) if (existsSync(wt)) await tryDo(`remove ${wt}`, () => this.git.worktreeRemove(this.root, wt, { force: true }));
    const listing = await listLeases(this.ctx.home, () => true);
    for (const e of listing.live) if (e.lease.repo === this.root && e.lease.story === a.unit.story) releaseLease(this.ctx.home, e.file);
    for (const b of a.local_branches) if (await this.git.branchExists(this.root, b)) await tryDo(`delete ${b}`, () => this.git.deleteBranch(this.root, b, { force: true }));
    if (this.obs.remote) for (const b of a.remote_branches) await tryDo(`delete remote ${b}`, () => this.git.deleteRemoteBranch(this.root, this.obs.remote as string, b));
    for (const ref of a.refs) {
      await tryDo(`delete ${ref}`, async () => {
        await this.git.updateRef(this.root, { ref, sha: null });
        if (this.obs.remote) await this.git.pushRef(this.root, this.obs.remote, { ref, sha: null });
      });
    }
    // the record stays on the base branch (GR6): mark story.md done there (record.ts; never forced).
    // Deferred (merge not on the base yet) or failed → owed; later ticks retry it (retryRecords).
    // GR6 done record: how the PR landed (merge commit, merged_by, merged_at; P2 ancestry) goes into
    // story.md `merge:` on the base with the status (record.ts), and is kept in records.json while owed
    const story = this.storyLoc(a.unit.story);
    const facts = this.obs.facts.stories.find((s) => s.key === a.unit.story);
    const merge = facts ? await mergeFacts({ root: this.root, remote: this.obs.remote, git: this.git, base: this.obs.facts.repo.default_branch, story: facts }).catch(() => undefined) : undefined;
    if (merge) detail.merge = merge;
    detail.record = await this.record({ story: a.unit.story, spec_dir: story.spec_dir, status: a.story_status, attempted_at: 0, attempts: 0, reason: "", ...(merge ? { merge } : {}) });
    return errors.length ? { ok: false, error: errors.join("; "), detail } : { ok: true, detail };
  }

  /** One attempt at a GR6 record; keeps it in `records.json` until it lands (idempotent: `unchanged` counts). */
  private async record(p: PendingRecord): Promise<RecordResult | { state: "failed"; reason: string }> {
    const res = await markStoryOnBase({
      root: this.root,
      remote: this.obs.remote,
      git: this.git,
      base: this.obs.facts.repo.default_branch,
      spec_dir: p.spec_dir,
      story: p.story,
      status: p.status,
      trailers: { "Norn-Story": p.story, "Norn-Tick": this.tick },
      ...(p.merge ? { merge: p.merge } : {}),
    }).catch((e: Error) => ({ state: "failed" as const, reason: e.message }));
    const rest = readPendingRecords(this.root).filter((r) => r.story !== p.story);
    if (res.state === "deferred" || res.state === "failed") rest.push({ ...p, attempted_at: this.ctx.clock.now(), attempts: p.attempts + 1, reason: res.reason });
    writePendingRecords(this.root, rest);
    return res;
  }

  /** GR6: retry owed base-branch records, at most once per `remote.sync_interval` each (H5). */
  async retryRecords(): Promise<Array<{ story: string; state: string; reason?: string }>> {
    const every = parseDuration(this.config.remote.sync_interval);
    const now = this.ctx.clock.now();
    const out: Array<{ story: string; state: string; reason?: string }> = [];
    for (const p of readPendingRecords(this.root)) {
      if (now - p.attempted_at < every) continue;
      const r = await this.record(p);
      out.push({ story: p.story, state: r.state, ...("reason" in r ? { reason: r.reason } : {}) });
    }
    return out;
  }
}
