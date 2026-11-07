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
  type SessionRef,
  type UnitRef,
} from "@norn/core";
import type { ClaimBlob, UnitState } from "@norn/schema";
import {
  appendTrace,
  readActFailures,
  releaseStoryLeases,
  tidyHandoff,
  writeReceiptAt,
  writeState,
  handoffPath,
  markNotified,
  readNotified,
  traceEvent,
  runStateDir,
} from "@norn/store";
import type { Context } from "../../context.ts";
import { syncRemoteBranch } from "../integrate.ts";
import { leaseLiveness } from "../leases.ts";
import type { Observed, StoryLoc, UnitLoc } from "../observe/index.ts";
import { receiptsWritten } from "../report.ts";

export class QueueFull extends Error {}
/** A receipt number another writer (an agent verb, a person) took since observe. */
export class ReceiptTaken extends Error {}

/** A claim write lost to another heartbeat (CAS stale/rejected, held) — not a network failure. */
export function claimLost(r: ActionResult): boolean {
  const reason = (r.detail as { reason?: string } | undefined)?.reason;
  return reason === "stale" || reason === "rejected" || reason === "held" || reason === "corrupt";
}

/** The state and shared effects of one act pass (one tick): what every action module works with. */
export class ActEnv {
  readonly notified: Set<string>;
  readonly notifiedNow: string[] = [];
  /** what act changed locally this tick, for the post-act facts notifications are built from */
  readonly written = new Map<string, UnitState>();
  readonly claimed = new Map<string, { blob: ClaimBlob; sha: string }>();
  readonly cleaned = new Set<string>();
  /** Effects of the current action that failed after its state was written (push, typed delivery) */
  effectErrors: Array<{ effect: string; reason: string }> = [];
  /** Effects of the current action that succeeded */
  effectsOk = new Set<string>();
  /** Session a failed delivery targeted (for the inbox item; a retried delivery reuses it) */
  failedSession: SessionRef | null = null;
  /** Unit key → last failed effect (machine-local `failures.json`) */
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
    const specDir = join(root, s.spec_dir);
    return { unit, story: unit.story, root, runsDir: runStateDir(root, { key: unit.story, spec_dir: s.spec_dir }, unit.dir), handoffFile: handoffPath(specDir, unit.dir), worktree: s.worktree, branch: s.branch, state: null, workflow: null };
  }

  liveness() {
    return leaseLiveness((p) => this.obs.ports.process.isAlive(p));
  }

  writeReceipts(loc: Pick<UnitLoc, "runsDir" | "handoffFile">, receipts: NewReceipt[]): void {
    for (const r of receipts) {
      const res = writeReceiptAt(loc.runsDir, r.n, r.receipt);
      if (!res.ok) throw new ReceiptTaken(`receipt number ${r.n} is taken by ${relative(this.root, res.file)}`);
    }
    receiptsWritten(loc.handoffFile, receipts.map((r) => r.receipt));
  }

  /** Write state.json (last) and keep the in-memory location current for later actions this tick. */
  writeUnitState(unit: UnitRef, runsDir: string, state: UnitState): void {
    writeState(runsDir, state);
    this.written.set(unit.key, state);
    const loc = this.obs.units[unit.key];
    if (loc) loc.state = state;
  }

  async releaseRunLeases(unit: UnitRef, kinds: Array<"agent" | "check" | "slot">, runId?: string): Promise<string[]> {
    return releaseStoryLeases(this.ctx.home, this.root, unit.story, (l) => l.slice === unit.slice && kinds.includes(l.kind) && (!runId || l.run_id === runId || l.kind === "slot"));
  }

  /** Tidy the unit's handoff (skeleton when new, an older norn's blocks gone), commit with trailers and push. */
  async commit(
    c: BoundaryCommit | null,
    unit: UnitRef | null,
    state: UnitState | null,
    paths?: string[],
  ): Promise<{ sha: string | null; pushed: boolean | null; push_error?: string; deferred?: string; refused?: string } | null> {
    if (!c) return null;
    if (unit && state) {
      const loc = this.unitLoc(unit);
      // The status is printed by `brief` and `story checkout` (renderHandoffStatus), never written into the file
      if (existsSync(loc.runsDir)) tidyHandoff(loc.handoffFile);
    }
    let sha: string | null;
    try {
      // Decide asks for a story unit's boundary even when nothing changed (`allow_empty`)
      sha = await this.git.commit(c.cwd, { message: c.message, trailers: c.trailers, ...(paths ? { paths } : {}), ...(c.allow_empty ? { allowEmpty: true } : {}) });
    } catch (e) {
      const code = (e as { code?: string }).code;
      // An agent's merge or rebase is in progress in the worktree — norn's files wait there
      // uncommitted (git cannot commit them without concluding it); the next commit after it carries them
      if (code === GIT_IN_PROGRESS) return { sha: null, pushed: null, deferred: (e as Error).message };
      // Never create (or push) a norn commit recording conflict markers: a failed effect, Unblock item
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
    // Committed but not pushed is a failed effect (the record is not on the remote)
    else this.effectErrors.push({ effect: "push", reason: `push of ${c.branch} failed: ${r.message}` });
    return r.ok ? { sha, pushed: true } : { sha, pushed: false, push_error: r.message };
  }

  /**
   * Push a branch (only the claim holder; decide acts only on held stories). Slice branches are
   * rebased by integrate, so they force-push. Never publishes a commit that leaves conflict
   * markers (an agent's merge included); a story branch someone pushed to meanwhile is
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

  /** Why the push of `branch` is held — its unpublished commits leave conflict markers — or null. */
  async markersHeld(cwd: string, remote: string, branch: string): Promise<string | null> {
    const marked = await this.git.outgoingConflictMarkers(cwd, remote, `refs/heads/${branch}`);
    if (!marked.length) return null;
    const where = marked.map((m) => `${m.path}${m.commit ? ` (commit ${m.commit.slice(0, 12)})` : ""}`);
    return `held: conflict markers in ${where.join(", ")}; nothing pushed — resolve them in a new commit (never rewrite the branch)`;
  }

  /**
   * The push of the story branch was rejected — someone pushed to it. Take the
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

  /** Notify once per inbox item id; the id is persisted before sending (receipt-first). */
  async notify(item: InboxItem | null): Promise<void> {
    if (!item || this.notified.has(item.id)) return;
    markNotified(this.root, this.notified, item.id);
    this.notifiedNow.push(item.id);
    for (const n of this.obs.ports.notifiers) {
      try {
        await n.notify(item);
      } catch (e) {
        // notifiers are best-effort, the inbox is the truth; the trace keeps why, naming the file
        this.traceReject(item.slice ?? (item.story || "repo"), "notify", (e as Error).message || `notify ${n.name} failed`, { item: item.id });
      }
    }
  }

  traceReject(unit: string, source: string, reason: string, payload?: unknown): void {
    appendTrace(this.root, traceEvent("reject", this.ctx.clock.now(), { tick_id: this.tick, unit, source, reason, ...(payload === undefined ? {} : { payload }) }));
  }
}
