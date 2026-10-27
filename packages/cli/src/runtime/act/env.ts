/** act's environment (ActEnv): the context, the observed facts and this tick's effect bookkeeping, shared by every act module. */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type ActFailure,
  type ActionResult,
  GIT_CONFLICT_MARKERS,
  GIT_IN_PROGRESS,
  type BoundaryCommit,
  type InboxItem,
  type NewReceipt,
  renderHandoffStatus,
  type SessionRef,
  type UnitRef,
} from "@norn/core";
import type { ClaimBlob, UnitState } from "@norn/schema";
import {
  appendHandoffHeartbeat,
  appendTrace,
  listLeases,
  readActFailures,
  releaseLease,
  writeHandoffHeader,
  writeReceiptAt,
  writeState,
  markNotified,
  readNotified,
  traceEvent,
} from "@norn/store";
import type { Context } from "../../context.ts";
import { syncRemoteBranch } from "../integrate.ts";
import { leaseLiveness } from "../leases.ts";
import type { Observed, StoryLoc, UnitLoc } from "../observe/index.ts";

export class QueueFull extends Error {}
/** S6: a receipt number another writer (an agent verb, a person) took since observe. */
export class ReceiptTaken extends Error {}

/** R1.2: a claim write lost to another heartbeat (CAS stale/rejected, held) — not a network failure. */
export function claimLost(r: ActionResult): boolean {
  const reason = (r.detail as { reason?: string } | undefined)?.reason;
  return reason === "stale" || reason === "rejected" || reason === "held" || reason === "corrupt";
}

/** The state and shared effects of one act pass (one tick): what every action module works with. */
export class ActEnv {
  readonly notified: Set<string>;
  readonly notifiedNow: string[] = [];
  /** what act changed locally this tick, for the post-act facts notifications are built from (O3) */
  readonly written = new Map<string, UnitState>();
  readonly claimed = new Map<string, { blob: ClaimBlob; sha: string }>();
  readonly cleaned = new Set<string>();
  /** R4.3: effects of the current action that failed after its state was written (push, typed delivery) */
  effectErrors: Array<{ effect: string; reason: string }> = [];
  /** R4.3: effects of the current action that succeeded */
  effectsOk = new Set<string>();
  /** R4.3: session a failed delivery targeted (for the inbox item; R6.3 reuses it) */
  failedSession: SessionRef | null = null;
  /** R4.3: unit key → last failed effect (machine-local `failures.json`) */
  readonly failures: Record<string, ActFailure>;
  failuresChanged = false;

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
  nowIso() {
    return this.ctx.clock.iso();
  }

  // ------------------------------------------------------------ locations

  storyLoc(key: string): StoryLoc {
    const s = this.obs.stories[key];
    if (!s) throw new Error(`unknown story ${key}`);
    return s;
  }

  unitLoc(unit: UnitRef): UnitLoc {
    const u = this.obs.units[unit.key];
    if (u) return u;
    // a unit started this tick
    const s = this.storyLoc(unit.story);
    const root = s.worktree ?? s.root;
    return { unit, story: unit.story, root, runsDir: join(root, s.spec_dir, "runs", unit.dir), worktree: s.worktree, branch: s.branch, state: null, workflow: null };
  }

  liveness() {
    return leaseLiveness((p) => this.obs.ports.process.isAlive(p));
  }

  // ------------------------------------------------------------ receipts / state / commit

  writeReceipts(runsDir: string, receipts: NewReceipt[]): void {
    for (const r of receipts) {
      const res = writeReceiptAt(runsDir, r.n, r.receipt);
      if (!res.ok) throw new ReceiptTaken(`receipt number ${r.n} is taken by ${relative(this.root, res.file)} (S6)`);
    }
  }

  /** Write state.json (S5, last) and keep the in-memory location current for later actions this tick. */
  writeUnitState(unit: UnitRef, runsDir: string, state: UnitState): void {
    writeState(runsDir, state);
    this.written.set(unit.key, state);
    const loc = this.obs.units[unit.key];
    if (loc) loc.state = state;
  }

  async releaseRunLeases(unit: UnitRef, kinds: Array<"agent" | "check" | "slot">, runId?: string): Promise<string[]> {
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
  async commit(
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
  async pushBranch(cwd: string, branch: string, trailers: Record<string, string> = {}): Promise<{ ok: true } | { ok: false; message: string }> {
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
  async markersHeld(cwd: string, remote: string, branch: string): Promise<string | null> {
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
  async takeRemoteBranch(cwd: string, remote: string, branch: string, trailers: Record<string, string>): Promise<true | string | null> {
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

  traceReject(unit: string, source: string, reason: string, payload?: unknown): void {
    appendTrace(this.root, traceEvent("reject", this.ctx.clock.now(), { tick_id: this.tick, unit, source, reason, ...(payload === undefined ? {} : { payload }) }));
  }
}
