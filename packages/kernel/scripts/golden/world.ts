/**
 * A model host for building golden cases: it holds a few stories' records, gathers KernelFacts from
 * them, runs decide, and performs each decision the way the act protocol says (receipts appended
 * before the effect, state committed last against its version). Agents, checks and plugin steps
 * answer from a script, so a scenario reads as the story it tells and every tick's facts are ones a
 * real host could have gathered. A decision the model cannot perform as written (a commit against a
 * stale version, a receipt for a unit that does not exist) throws: that is a defect in decide.
 */
import type { ChangeRequest, ClaimRecord, StoredMessage, TrackerItem } from "@norn/plugin-api";
import { deriveUlid, type Signal } from "@norn/schema";
import {
  type Decision,
  decide,
  type KernelCapabilities,
  type KernelConfig,
  type KernelFacts,
  type KernelReceipt,
  type KernelWorkflows,
  type LoadedWorkflow,
  newRunState,
  type ReceiptData,
  type ReceiptIntent,
  type RunState,
  type SessionFacts,
  type SlicePlan,
  type StepRunFacts,
  type UnitFacts,
  validateDecision,
  validateKernelFacts,
  validateMailboxLetter,
} from "../../src/index.ts";

export interface SimUnit {
  id: string;
  state: RunState | null;
  version: number | null;
  receipts: KernelReceipt[];
  session: SessionFacts | null;
  /** the run's process still runs, as the host probes it while the session has sent no event */
  run_alive?: boolean;
  step_run?: StepRunFacts;
  corrupt?: string;
  /** the corrupt record holds decide's mark, as the journal reads it back */
  corrupt_marked?: boolean;
}

export interface SimStory {
  key: string;
  item: TrackerItem | null;
  change: ChangeRequest | null;
  claim: ClaimRecord | null;
  units: SimUnit[];
  mailbox: StoredMessage[];
  base_stale?: boolean;
  unpushed?: boolean;
  unsynced?: boolean;
  plan?: SlicePlan;
  /** the forge could not be read this tick: the host gathers no signals and says why */
  signals_error?: string;
}

/** What each step answers, per call at that unit and step: the n-th run takes the n-th entry, the last repeats. */
export type Answers = Record<string, string[]>;

export interface Script {
  /** step name (or `<unit>:<step>`) → the outcome an agent run reports */
  agent: Answers;
  /** step name → a check's outcome */
  check: Answers;
  /** step name → a plugin step kind's outcome (`waiting` for a wait kind still waiting) */
  step: Answers;
  /**
   * await step name → the CI signal kinds the forge reports through each visit, comma-separated (the
   * n-th visit takes the n-th entry, the last repeats); `change.*` comes from the story's change, as the host derives it
   */
  signal: Answers;
}

export interface Tick {
  n: number;
  facts: KernelFacts;
  decisions: Decision[];
}

const SEED = "01JD5G00000000000000000000";
const MINUTE = 60_000;

/**
 * The session's report as the host hands it to decide: dropped once its receipt stands on the record,
 * and named refused when that receipt was rejected.
 */
function reportAsRecorded(u: SimUnit, f: UnitFacts): void {
  const report = f.session?.report;
  const runId = u.state?.run?.id;
  if (!report || !f.session || runId === undefined) return;
  const refusals = new Map(u.receipts.flatMap((r) => (r.data.kind === "receipt.rejected" ? [[r.data.seq, r.data.reason] as const] : [])));
  const r = u.receipts.findLast((x) => x.data.kind === "run.reported" && x.data.run_id === runId && x.data.verb === report.verb && x.data.outcome === report.outcome);
  if (!r) return;
  const refused = refusals.get(r.seq);
  if (refused === undefined) delete f.session.report;
  else f.report_rejected = refused;
}

export const session = (activity: SessionFacts["activity"], over: Partial<SessionFacts> = {}): SessionFacts => ({
  activity,
  silent: false,
  pending_tools: 0,
  subagents: 0,
  pane_answers: 0,
  errors: [],
  ...over,
});

export class World {
  now: number;
  stories: SimStory[] = [];
  intake: TrackerItem[] = [];
  readonly ticks: Tick[] = [];
  readonly script: Script = { agent: {}, check: {}, step: {}, signal: {} };
  /** agent runs the scripted agents should leave alone: a scenario shows their session by hand */
  readonly manual = new Set<string>();
  /** units whose session outlives a stop order: a harness that cannot end it */
  readonly unstoppable = new Set<string>();
  /** ticks a scenario wants kept as cases whatever their rules */
  readonly kept = new Set<number>();
  private readonly calls = new Map<string, number>();
  private n = 0;

  constructor(
    readonly holder: string,
    readonly capabilities: KernelCapabilities,
    readonly workflows: KernelWorkflows,
    readonly config: KernelConfig,
    start: string,
  ) {
    this.now = Date.parse(start);
  }

  iso(at: number = this.now): string {
    return new Date(at).toISOString();
  }

  advance(minutes: number): void {
    this.now += minutes * MINUTE;
  }

  story(key: string): SimStory {
    const s = this.stories.find((x) => x.key === key);
    if (!s) throw new Error(`no story ${key}`);
    return s;
  }

  unit(id: string): SimUnit {
    const s = this.story(id.split("/")[0] as string);
    const u = s.units.find((x) => x.id === id);
    if (!u) throw new Error(`no unit ${id}`);
    return u;
  }

  /** A receipt a person (or another writer) appends, as a CLI verb would. */
  append(id: string, data: ReceiptData): KernelReceipt {
    const u = this.unit(id);
    const r: KernelReceipt = { seq: (u.receipts.at(-1)?.seq ?? 0) + 1, id: deriveUlid(SEED, 10_000 + this.n * 100 + u.receipts.length), at: this.iso(), data };
    u.receipts.push(r);
    return r;
  }

  /**
   * An agent reports as the reporting API does: its `run.reported` receipt on the record first, then
   * the event the session reads as reported.
   */
  report(id: string, verb: "done" | "ask" | "stuck", outcome?: string, text?: string): void {
    const u = this.unit(id);
    const st = u.state as RunState;
    if (!st.run) throw new Error(`${id}: no run to report`);
    this.append(id, { kind: "run.reported", run_id: st.run.id, verb, ...(outcome !== undefined && { outcome }), ...(text !== undefined && { text }), step: st.step, attempt: st.attempt });
    u.session = session("reported", { report: { verb, ...(outcome !== undefined && { outcome }) } });
  }

  /** A gate decision a person makes on the unit's current step and attempt. */
  decideGate(id: string, outcome: "approve" | "reject", reason?: string): void {
    const st = this.unit(id).state as RunState;
    this.append(id, { kind: "gate.decided", outcome, by: "person", ...(reason ? { reason } : {}), step: st.step, attempt: st.attempt });
  }

  /** Keep the next tick as a case. */
  keepNext(): void {
    this.kept.add(this.n);
  }

  facts(): KernelFacts {
    const units = (s: SimStory): UnitFacts[] =>
      s.units.map((u) => {
        const through = u.state?.applied_through ?? 0;
        const f: UnitFacts = { id: u.id, state: structuredClone(u.state), version: u.version, receipts: structuredClone(u.receipts.filter((r) => r.seq > through)), session: structuredClone(u.session) };
        if (u.step_run) f.step_run = { ...u.step_run };
        if (u.run_alive !== undefined && u.session === null) f.run_alive = u.run_alive;
        reportAsRecorded(u, f);
        if (u.corrupt !== undefined) {
          f.corrupt = u.corrupt;
          f.state = null;
          f.receipts = [];
          if (u.corrupt_marked) f.corrupt_marked = true;
        }
        return f;
      });
    const facts: KernelFacts = {
      tick_id: deriveUlid(SEED, this.n),
      now: this.iso(),
      holder: this.holder,
      capabilities: structuredClone(this.capabilities),
      stories: this.stories.map((s) => {
        const out: KernelFacts["stories"][number] = { key: s.key, item: structuredClone(s.item), change: structuredClone(s.change), claim: structuredClone(s.claim), units: units(s), mailbox: structuredClone(s.mailbox) };
        if (s.base_stale !== undefined) out.base_stale = s.base_stale;
        if (s.unpushed !== undefined) out.unpushed = s.unpushed;
        if (s.unsynced !== undefined) out.unsynced = s.unsynced;
        if (s.plan) out.plan = structuredClone(s.plan);
        const signals = this.signals(s);
        if (signals && s.signals_error !== undefined) {
          out.signals = [];
          out.signals_error = s.signals_error;
        } else if (signals) out.signals = signals;
        return out;
      }),
      intake: structuredClone(this.intake),
    };
    const v = validateKernelFacts(facts);
    if (!v.ok) throw new Error(`tick ${this.n}: facts fail validation: ${JSON.stringify(v.errors)}`);
    return facts;
  }

  /**
   * The signals the host gathers for a story whose own unit waits at an await step, neither ended nor
   * parked: the scripted CI kinds of this visit, and the change's merge onto `main` or its closing.
   */
  private signals(s: SimStory): Signal[] | undefined {
    const st = s.units.find((u) => u.id === s.key)?.state;
    const step = st && !st.ended && !st.parked ? this.workflows.byHash[st.workflow.hash]?.graph.steps[st.step] : undefined;
    if (!st || !step?.await) return undefined;
    const subject = `change/${s.change?.id ?? 0}`;
    const out: Signal[] = [];
    const ci = this.scripted(this.script.signal, s.key, st.step, st.attempt - 1);
    for (const kind of (ci ?? "").split(",").filter(Boolean)) out.push({ source: "forge", kind: kind as Signal["kind"], subject, at: this.iso() });
    if (s.change?.state === "merged" && s.change.base_branch === "main") out.push({ source: "forge", kind: "change.merged", subject, at: this.iso() });
    if (s.change?.state === "closed") out.push({ source: "forge", kind: "change.closed", subject, at: this.iso() });
    return out;
  }

  /** Gather facts, decide, perform every decision, and keep the tick. */
  tick(): Tick {
    const facts = this.facts();
    const decisions = decide(structuredClone(facts), this.workflows, this.config);
    for (const d of decisions) {
      const v = validateDecision(d);
      if (!v.ok) throw new Error(`tick ${this.n}: ${d.rule} fails validation: ${JSON.stringify(v.errors)}`);
    }
    const t = { n: this.n, facts, decisions };
    this.ticks.push(t);
    for (const d of decisions) this.perform(d);
    this.answer();
    this.n++;
    this.advance(1);
    return t;
  }

  /** Tick until `until` holds or `max` ticks pass, which throws: a scenario that does not converge is a defect. */
  run(until: (w: World) => boolean, max = 40): void {
    for (let i = 0; i < max; i++) {
      if (until(this)) return;
      this.tick();
    }
    if (!until(this)) throw new Error(`no convergence after ${max} ticks; last: ${JSON.stringify(this.ticks.at(-1)?.decisions.map((d) => `${d.unit}:${d.rule}`))}`);
  }

  private nextCall(key: string): number {
    const n = this.calls.get(key) ?? 0;
    this.calls.set(key, n + 1);
    return n;
  }

  private scripted(answers: Answers, unit: string, step: string, n: number): string | undefined {
    const list = answers[`${unit}:${step}`] ?? answers[step];
    if (!list?.length) return undefined;
    return list[Math.min(n, list.length - 1)];
  }

  private record(u: SimUnit, intent: ReceiptIntent): void {
    if (u.receipts.some((r) => r.id === intent.id)) throw new Error(`receipt ${intent.id} written twice to ${u.id}`);
    u.receipts.push({ seq: (u.receipts.at(-1)?.seq ?? 0) + 1, id: intent.id, at: this.iso(), data: structuredClone(intent.data) });
  }

  private commit(u: SimUnit, state: RunState, expect: number | null): void {
    if (expect !== u.version) throw new Error(`${u.id}: commit expects version ${expect}, the store has ${u.version}`);
    const before = u.state;
    u.state = structuredClone(state);
    u.version = (u.version ?? 0) + 1;
    // a session or step run belongs to one run of one attempt; a new one starts with no facts
    if ((before?.run && before.run.id !== state.run?.id) || before?.step !== state.step || before?.attempt !== state.attempt) {
      u.session = null;
      delete u.run_alive;
      delete u.step_run;
    }
  }

  private unitOf(d: Decision): SimUnit {
    if (d.unit === null) throw new Error(`${d.rule}: a unit action without a unit`);
    const s = this.stories.find((x) => x.key === d.unit?.split("/")[0]);
    let u = s?.units.find((x) => x.id === d.unit);
    if (!u && s) {
      u = { id: d.unit, state: null, version: null, receipts: [], session: null };
      s.units.push(u);
    }
    if (!u) throw new Error(`${d.rule}: no story for ${d.unit}`);
    return u;
  }

  private perform(d: Decision): void {
    switch (d.kind) {
      case "intake_story":
        this.stories.push({ key: d.item.key, item: structuredClone(d.item), change: null, claim: null, units: [], mailbox: [] });
        this.intake = this.intake.filter((i) => i.key !== d.item.key);
        return;
      case "claim": {
        const s = this.story(d.story);
        if ((s.claim?.version ?? null) !== d.expect_version) throw new Error(`${d.story}: claim expects version ${d.expect_version}, the store has ${s.claim?.version ?? null}`);
        s.claim = { story: d.story, holder: this.holder, acquired_at: this.iso(), expires_at: this.iso(this.now + this.config.claimTtlMs), version: (s.claim?.version ?? 0) + 1 };
        return;
      }
      case "renew_claim": {
        const s = this.story(d.story);
        if (!s.claim) throw new Error(`${d.story}: renewing a claim nobody holds`);
        s.claim = { ...s.claim, expires_at: this.iso(this.now + this.config.claimTtlMs), version: s.claim.version + 1 };
        return;
      }
      case "release_claim":
        this.story(d.story).claim = null;
        return;
      case "apply_receipts": {
        const u = this.unitOf(d);
        for (const r of d.receipts) this.record(u, r);
        this.commit(u, d.state, d.expect_version);
        return;
      }
      case "start_run":
      case "retry_run":
      case "nudge":
      case "mark_done":
      case "run_check": {
        const u = this.unitOf(d);
        if (d.intent) this.record(u, d.intent);
        if (d.kind === "run_check") {
          const outcome = this.scripted(this.script.check, u.id, d.step, this.nextCall(`${u.id}:${d.step}`)) ?? "pass";
          u.step_run = { kind: "check", running: false, outcome };
        }
        if (d.kind === "retry_run" || d.kind === "start_run") u.session = null;
        if (d.kind === "nudge") u.session = session("working");
        return;
      }
      case "run_step": {
        const u = this.unitOf(d);
        if (d.intent) this.record(u, d.intent);
        const outcome = this.scripted(this.script.step, u.id, d.step, this.nextCall(`${u.id}:${d.step}`)) ?? "done";
        u.step_run = { kind: d.step_kind, running: false, outcome };
        return;
      }
      case "start_slices": {
        const s = this.story((d.unit as string).split("/")[0] as string);
        for (const sl of d.slices) {
          const wf = this.workflows.byHash[sl.hash] as LoadedWorkflow;
          const u: SimUnit = { id: sl.unit, state: null, version: null, receipts: [], session: null };
          s.units.push(u);
          this.commit(u, newRunState({ unit: sl.unit, story: s.key, workflow: wf }), null);
        }
        return;
      }
      case "park": {
        const u = this.unitOf(d);
        this.record(u, d.intent);
        if (d.state) this.commit(u, d.state, d.expect_version);
        return;
      }
      case "mark_corrupt": {
        // the mark is appended even to a record that fails validation; the journal reads it back as corrupt_marked
        const u = this.unitOf(d);
        this.record(u, d.intent);
        if (u.corrupt !== undefined) u.corrupt_marked = true;
        else if (d.state) this.commit(u, d.state, d.expect_version);
        return;
      }
      case "stop_run": {
        // the harness ends the session; its end is what the next tick reads
        const u = this.unitOf(d);
        if (d.intent) this.record(u, d.intent);
        if (!this.unstoppable.has(u.id)) u.session = session("ended");
        return;
      }
      case "import_mailbox": {
        const s = this.story(d.story);
        for (const id of d.ids) {
          const m = s.mailbox.find((x) => x.id === id);
          const letter = validateMailboxLetter(m?.data);
          if (d.rule === "mailbox.import" && letter.ok) this.append(letter.value.unit, letter.value.receipt);
        }
        s.mailbox = s.mailbox.filter((m) => !d.ids.includes(m.id));
        return;
      }
      case "flush":
      case "notify":
      case "noop":
        return;
    }
  }

  /** Scripted agents report once their run is on the record and they have nothing on hand. */
  private answer(): void {
    for (const s of this.stories)
      for (const u of s.units) {
        const run = u.state?.run;
        if (!run || u.session !== null || this.manual.has(u.id) || u.receipts.some((r) => r.seq > (u.state?.applied_through ?? 0))) continue;
        // only an agent reports; a plugin step of the same name answers through its step run
        if (!this.workflows.byHash[u.state?.workflow.hash ?? ""]?.graph.steps[run.step]?.agent) continue;
        const outcome = this.scripted(this.script.agent, u.id, run.step, this.nextCall(`${u.id}:${run.step}:agent`));
        if (outcome === undefined) continue;
        this.report(u.id, "done", outcome);
      }
  }
}
