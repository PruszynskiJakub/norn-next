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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type Action,
  type ActionResult,
  type AgentLaunch,
  applyReceipts,
  buildInbox,
  type BoundaryCommit,
  type Decision,
  type Facts,
  type InboxItem,
  type InboxGroup,
  type NewReceipt,
  renderHandoffStatus,
  routeFor,
  type SessionRef,
  type UnitRef,
  type WorktreeSpec,
} from "@norn/core";
import { git as gitAdapter } from "@norn/adapters";
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
  acquireLease,
  acquireRunLease,
  appendHandoffHeartbeat,
  appendReceipt,
  appendTrace,
  deleteMailbox,
  git as rawGit,
  listLeases,
  patchSliceFile,
  patchStoryFile,
  pinWorkflow,
  readEnvNorn,
  reclaimLeases,
  releaseClaim,
  releaseLease,
  renewClaim,
  sliceFile as sliceFilePath,
  slotEnv,
  storyFile,
  updateLease,
  writeEnvNorn,
  writeHandoffHeader,
  writeLog,
  writeReceiptAt,
  writeState,
  writeStoryFile,
  writeTranscriptSnapshot,
  writeUnitMarker,
} from "@norn/store";
import type { Context } from "../context.ts";
import { leaseLiveness } from "./leases.ts";
import { markStoryOnBase, type RecordResult } from "./record.ts";
import { markNotified, type PendingRecord, readNotified, readPendingRecords, writePendingRecords } from "./local.ts";
import type { Observed, StoryLoc, UnitLoc } from "./observe.ts";
import { runShell, tailLines } from "./shell.ts";

export interface ActRecord {
  decision: Decision;
  result: ActionResult;
}

/** Inbox groups that need a person; their new items are notified once (O3). */
const NOTIFY_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "unclaimed"];

class QueueFull extends Error {}

export class Actor {
  private readonly notified: Set<string>;
  readonly notifiedNow: string[] = [];
  /** what act changed locally this tick, for the post-act facts notifications are built from (O3) */
  private readonly written = new Map<string, UnitState>();
  private readonly claimed = new Map<string, { blob: ClaimBlob; sha: string }>();
  private readonly cleaned = new Set<string>();

  constructor(
    readonly ctx: Context,
    readonly obs: Observed,
  ) {
    this.notified = readNotified(obs.root);
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
    for (const d of decisions) {
      let result: ActionResult;
      try {
        result = await this.perform(d.action);
      } catch (e) {
        result = e instanceof QueueFull ? { ok: false, error: e.message, detail: { queued: true } } : { ok: false, error: (e as Error).message };
      }
      out.push({ decision: d, result });
    }
    return out;
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
      case "kill_run": {
        const loc = this.unitLoc(a.unit);
        this.writeReceipts(loc.runsDir, a.receipts);
        await this.kill(a.session);
        if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
        return { ok: true, detail: await this.commit(a.commit, a.unit, a.state, `${a.rule}: killed (${a.reason})`) };
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
        // only a unit's own runs/ files mark its state corrupt; a broken story.md is surfaced, never written into state (S2)
        const ownFiles = a.errors.length > 0 && a.errors.every((e) => e.file.includes(`/runs/${a.unit.dir}/`));
        const stateBroken = a.errors.some((e) => e.file.endsWith("state.json"));
        let marked = false;
        if (loc?.state && loc.state.status !== "corrupt" && ownFiles && !stateBroken) {
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
      if (!res.ok) throw new Error(`receipt number ${r.n} is taken by ${relative(this.root, res.file)} (S6)`);
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
  ): Promise<{ sha: string | null; pushed: boolean | null; push_error?: string } | null> {
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
    const sha = await this.git.commit(c.cwd, { message: c.message, trailers: c.trailers, ...(paths ? { paths } : {}) });
    if (!c.push || !this.obs.remote) return { sha, pushed: null };
    const r = await this.pushBranch(c.cwd, c.branch);
    return r.ok ? { sha, pushed: true } : { sha, pushed: false, push_error: r.message };
  }

  /** Push a branch (T7: only the claim holder; decide acts only on held stories). Slice branches are rebased by integrate, so they force-push. */
  private async pushBranch(cwd: string, branch: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.obs.remote) return { ok: true };
    const force = branch.includes("/") ? "+" : "";
    const r = await this.git.push(cwd, this.obs.remote, `${force}refs/heads/${branch}:refs/heads/${branch}`);
    return r.ok ? { ok: true } : { ok: false, message: `${r.reason}: ${r.message}` };
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
      const session = await runner.launch({ cwd: launch.cwd, argv: cmd.argv, env: { ...env, ...cmd.env }, title: launch.title, run_id: launch.run_id });
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
      session: { runner: session.runner, session_id: session.session_id, ...(session.pane_id ? { pane_id: session.pane_id } : {}) },
      ...(session.process ? { process: session.process } : {}),
    };
    const n = Math.max(...receipts.map((x) => x.n)) + 1;
    const res = writeReceiptAt(runsDir, n, r);
    if (!res.ok) throw new Error(`receipt number ${n} is taken (S6)`);
    return applyReceipts(decided, [{ n, file: "", receipt: r }], { workflow: wf, now: this.nowIso(), limits: this.config.limits, tick_id: this.tick }).state;
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
    } else this.writeReceipts(loc.runsDir, a.receipts);
    for (const r of a.rejected) this.traceReject(a.unit.key, `receipt ${r.n}`, r.reason, { receipt_id: r.receipt_id });
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    const released =
      state && state.status !== "running"
        ? await this.releaseRunLeases(a.unit, ["agent"])
        : a.kill && prevRun
          ? await this.releaseRunLeases(a.unit, ["agent"], prevRun)
          : [];
    const summary = a.advance ? `${a.advance.from}.${a.advance.outcome} → ${a.advance.to}` : `applied ${a.applied.join(", ") || "none"}`;
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: ${summary}`);
    let delivered: boolean | string = resumed ? "resumed" : false;
    if (a.input) {
      // B2: the answer goes into the same session after state is written
      try {
        const runner = this.obs.ports.runner;
        if (!runner || runner.name !== a.input.session.runner) throw new Error("session's runner is not available here");
        await runner.send(a.input.session, a.input.text, { submit: true });
        delivered = true;
      } catch (e) {
        delivered = `not delivered: ${(e as Error).message}`;
      }
    }
    return { ok: true, detail: { ...committed, released, delivered, ...(a.kill ? { killed } : {}), ...(resumed ? { session: resumed } : {}) } };
  }

  /** Create a unit worktree (K4, K5): branch, worktree, slot lease, `.env.norn`, `.norn-unit`. */
  private async ensureWorktree(spec: WorktreeSpec, unit: UnitRef, spec_dir: string): Promise<{ created: boolean; slot: number | null }> {
    let created = false;
    if (!existsSync(spec.path)) {
      const exists = await this.git.branchExists(this.root, spec.branch);
      await this.git.worktreeAdd(this.root, spec.path, spec.branch, exists ? undefined : { from: spec.from });
      created = true;
    }
    await this.ensureExcluded();
    const slots = this.config.slots;
    const req = {
      kind: "slot" as const,
      repo: this.root,
      story: unit.story,
      slice: unit.slice,
      run_id: null,
      worktree: spec.path,
      portBase: (n: number) => slots.port_base + n * slots.ports_per_slot,
      now: this.nowIso(),
      liveness: this.liveness(),
    };
    let lease = spec.slot !== null ? await acquireLease(this.ctx.home, { ...req, range: { min: spec.slot, max: spec.slot } }) : null;
    if (!lease?.ok) lease = await acquireLease(this.ctx.home, { ...req, range: { min: slots.min, max: slots.max } });
    const slot = lease.ok ? lease.entry.n : null;
    const env = slot === null ? {} : slot === spec.slot ? spec.env : slotEnv(slot, slots);
    writeEnvNorn(spec.path, env);
    writeUnitMarker(spec.path, { repo: this.root, story: unit.story, slice: unit.slice, unit: unit.dir, spec_dir });
    return { created, slot };
  }

  /** `.env.norn` and `.norn-unit` are machine-local: never committed (shared info/exclude). */
  private async ensureExcluded(): Promise<void> {
    const r = await rawGit(this.root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (r.code !== 0) return;
    const path = join(r.stdout.trim(), "info", "exclude");
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      /* none yet */
    }
    const missing = [".env.norn", ".norn-unit"].filter((p) => !text.split("\n").includes(p));
    if (!missing.length) return;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${text && !text.endsWith("\n") ? "\n" : ""}# norn (machine-local worktree files)\n${missing.join("\n")}\n`);
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
    const state = a.state ? this.recordSession(a.unit, loc.runsDir, a.state, a.receipts, session) : null;
    if (state) this.writeUnitState(a.unit, loc.runsDir, state);
    const committed = await this.commit(a.commit, a.unit, state, `${a.rule}: ${a.step} run ${a.launch.run_id}`);
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

  private async nudge(a: Extract<Action, { kind: "nudge" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    this.writeReceipts(loc.runsDir, a.receipts);
    const snapshot = await this.snapshot(a.unit, a.input.run_id, a.snapshot);
    const runner = this.obs.ports.runner;
    if (!runner || runner.name !== a.input.session.runner) throw new Error("the run's runner is not available on this machine");
    await runner.send(a.input.session, a.input.text, { submit: true });
    if (a.state) this.writeUnitState(a.unit, loc.runsDir, a.state);
    const committed = await this.commit(a.commit, a.unit, a.state, `${a.rule}: nudged ${a.state?.nudges_used ?? "?"}`);
    return { ok: true, detail: committed, ...(snapshot ? { transcript: snapshot } : {}) };
  }

  private async retryFresh(a: Extract<Action, { kind: "retry_fresh" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    let state = a.state;
    let session: SessionRef | null = null;
    await this.releaseRunLeases(a.unit, ["agent"]);
    if (a.launch) {
      // receipts, kill the old session, then the fresh one (B2, C1)
      ({ session } = await this.launchAfterReceipts(a.unit, loc.runsDir, a.receipts, a.launch, () => this.kill(a.kill)));
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
      const res = await runShell(a.command, { cwd: a.cwd, env, timeoutMs: a.timeout_ms });
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

  /** W2 git steps (K6, open-pr); the outcome is a `classify` receipt written after the effect. */
  private async runGit(a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
    const loc = this.unitLoc(a.unit);
    const st = loc.state;
    const wf = loc.workflow;
    if (!st || !wf) throw new Error(`${a.unit.key} has no state or pinned workflow`);
    let outcome: "done" | "conflict";
    let detail: string;
    const extra: Record<string, unknown> = {};
    switch (a.action) {
      case "integrate": {
        if (!a.onto) throw new Error("integrate without a story branch");
        const res = await gitAdapter.integrate(this.git, { sliceCwd: a.cwd, storyBranch: a.onto });
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
      route: routeFor(wf, a.step, outcome) as ReceiptOf<"classify">["route"],
    };
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
      const res = await gitAdapter.integrate(this.git, { sliceCwd: wt, storyBranch: story.branch, ...(storyWt ? { storyCwd: storyWt } : {}) });
      if (res.outcome === "conflict") throw new Error(`cannot bring ${a.unit.key}'s final state into ${story.branch}: conflict in ${res.files.join(", ")}`);
    }
    if (a.slice_status && a.unit.slice && storyWt) {
      const nn = a.unit.dir.split("-")[0] as string;
      const file = sliceFilePath(join(storyWt, story.spec_dir), nn, a.unit.dir.slice(nn.length + 1));
      const r = patchSliceFile(file, { status: a.slice_status }, storyWt);
      if (!r.ok) throw new Error(`cannot set ${relative(storyWt, file)} status: ${r.reason}`);
      detail.commit = await this.commit(
        { cwd: storyWt, branch: story.branch, message: `norn: ${a.unit.key} ${a.slice_status}`, trailers: { "Norn-Story": a.unit.story, "Norn-Slice": a.unit.slice, "Norn-Step": "$done", "Norn-Tick": this.tick }, push: true },
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
    const b = a.cleanup.branch_local;
    if (b && (await this.git.branchExists(this.root, b))) {
      if (await this.git.isAncestor(this.root, `refs/heads/${b}`, `refs/heads/${story.branch}`)) {
        await this.git.deleteBranch(this.root, b, { force: true });
        detail.branch_deleted = b;
      } else detail.branch_kept = `${b} is not in ${story.branch}`;
    }
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
    return r.ok ? { ok: true, detail: { sha: r.sha } } : { ok: false, error: r.message, detail: { reason: r.reason } };
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
    const story = this.storyLoc(a.unit.story);
    detail.record = await this.record({ story: a.unit.story, spec_dir: story.spec_dir, status: a.story_status, attempted_at: 0, attempts: 0, reason: "" });
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
