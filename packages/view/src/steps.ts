/**
 * Step timeline (O4, X1): one row per (step, attempt) a unit visited — when it was entered and
 * left, how long it took, how it ended, who acted (agent run, norn tick, person) and why.
 * Built from durable receipts, refined by the trace's tick decisions when they are still there
 * (the trace is gitignored and may be pruned). Pure: inputs in, plain JSON out.
 */
import type { NumberedReceipt } from "@norn/core";
import { stepOf } from "@norn/core";
import type { Receipt, TraceEvent, UnitState, Workflow } from "@norn/schema";
import { isAbsolute, join } from "node:path";
import { receiptSummary, traceEntries } from "./timeline.ts";
import type { StepRow, StepTotals, StepType, StepWho, TimelineEntry, TraceView, UnitTraceSummary } from "./types.ts";

export interface StepTimelineInput {
  key: string;
  story: string;
  slice: string | null;
  title: string;
  /** absolute runs/<unit>/ */
  runs_dir: string;
  /** absolute trace dir (briefing paths are relative to it) */
  trace_dir: string;
  state: UnitState | null;
  workflow: Workflow | null;
  /** every receipt of the unit, ascending */
  receipts: NumberedReceipt[];
  /** trace events mentioning the unit (or its story); filtered here by exact unit */
  events: TraceEvent[];
  /** story frontmatter intake time; null for slices */
  intake_at?: string | null;
}

export interface StepTimelineOptions {
  /** ms epoch: open steps run to now */
  now: number;
  /** attach the unit's events to each row (no-op and claim-renew ticks hidden) */
  events?: boolean;
  /** attach every event, including no-op and claim-renew ticks */
  all?: boolean;
}

/** Ticks that changed nothing for the unit: `noop` decisions and claim renewals. */
export function isNoiseEntry(e: TimelineEntry): boolean {
  return e.source === "tick" && (e.kind === "noop" || e.summary.startsWith("tick claim.renew "));
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const keyOf = (step: string, attempt: number) => `${step}#${attempt}`;

interface Seg {
  step: string;
  attempt: number;
  entered_at: string | null;
  left_at: string | null;
  outcome: string | null;
  to: string | null;
  counter: { name: string; value: number; max: number } | null;
  receipts: NumberedReceipt[];
  order: number;
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A state snapshot carried by a tick action for this unit (apply, classify, start). */
interface StateMark {
  at: string;
  step: string;
  attempt: number;
  entered_at: string;
  updated_at: string | null;
  created_at: string | null;
  outcome: string | null;
  counter: Seg["counter"];
}

function stateMarks(events: TraceEvent[], unit: string): { marks: StateMark[]; first_at: string | null; merged_at: string | null } {
  const marks: StateMark[] = [];
  let first_at: string | null = null;
  let merged_at: string | null = null;
  const take = (at: string, action: Rec) => {
    const st = obj(action.state);
    const step = str(st?.step);
    if (!st || !step || typeof st.attempt !== "number") return;
    const adv = obj(action.advance);
    const c = obj(adv?.counter);
    marks.push({
      at,
      step,
      attempt: st.attempt,
      entered_at: str(st.step_entered_at) ?? at,
      updated_at: str(st.updated_at),
      created_at: str(st.created_at),
      outcome: str(adv?.outcome) ?? str(action.outcome),
      counter: c && typeof c.value === "number" && typeof c.max === "number" ? { name: String(c.name), value: c.value, max: c.max } : null,
    });
  };
  for (const ev of events) {
    if (ev.type !== "tick") continue;
    for (const d of ev.decisions) {
      const action = obj(d.action) as Rec;
      if (d.unit === unit) {
        first_at ??= ev.at;
        if (d.result.ok && action.kind === "cleanup_merged_story") merged_at ??= ev.at;
        if (d.result.ok) take(ev.at, action);
      }
      // A story's start_slices carries each slice's first state (nested start_unit actions).
      if (d.result.ok && Array.isArray(action.starts))
        for (const s of action.starts) {
          const sa = obj(s);
          if (sa && str(obj(sa.unit)?.key) === unit) {
            first_at ??= ev.at;
            take(ev.at, sa);
          }
        }
    }
  }
  return { marks, first_at, merged_at };
}

/** Outcome-bearing receipt of a step, newest first preference. */
function outcomeOf(r: Receipt): string | null {
  switch (r.kind) {
    case "done":
    case "check":
      return r.outcome;
    case "classify":
      return r.route === "nudge" || r.route === "retry" || r.route === "park" ? null : r.outcome;
    case "approve":
    case "reject":
      return r.kind;
    case "stuck":
      return "stuck";
    case "unstick":
      return "unstick";
    default:
      return null;
  }
}

function inferType(seg: Seg, wf: Workflow | null): { type: StepType; attended: boolean } {
  const st = wf ? stepOf(wf, seg.step) : null;
  if (st) return { type: st.type as StepType, attended: st.type === "agent" && !!st.attended };
  const kinds = new Set(seg.receipts.map((r) => r.receipt.kind));
  if (kinds.has("started") || kinds.has("done")) return { type: "agent", attended: false };
  if (kinds.has("check")) return { type: "check", attended: false };
  if (kinds.has("approve") || kinds.has("reject")) return { type: "gate", attended: false };
  if (seg.receipts.some((r) => r.receipt.kind === "classify" && r.receipt.rule.startsWith("git."))) return { type: "git", attended: false };
  if (seg.step === "slices") return { type: "slices", attended: false };
  return { type: "unknown", attended: false };
}

function whoOf(receipts: NumberedReceipt[]): StepWho[] {
  const out: StepWho[] = [];
  const seen = new Set<string>();
  const add = (w: StepWho) => {
    const k = `${w.by}|${w.name}|${w.run_id}|${w.tick_id}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  };
  const hasStarted = receipts.some((r) => r.receipt.kind === "started");
  for (const { receipt: r } of receipts) {
    if (r.by === "agent") {
      if (r.kind === "started" || !hasStarted) add({ by: "agent", name: (r.kind === "started" ? r.agent : undefined) ?? r.who ?? "agent", run_id: r.run_id, tick_id: null });
    } else if (r.by === "norn") add({ by: "norn", name: "tick", run_id: r.run_id, tick_id: r.tick_id ?? null });
    else add({ by: "human", name: r.who ?? "human", run_id: null, tick_id: null });
  }
  return out;
}

/** Full reason text of a step: what ended it and why (never truncated here). */
function reasonOf(receipts: NumberedReceipt[]): string | null {
  const parts: string[] = [];
  for (const { receipt: r } of receipts) {
    switch (r.kind) {
      case "done": {
        const f = r.findings?.length ? ` [${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}: ${r.findings.map((x) => `${x.severity} ${x.title}`).join("; ")}]` : "";
        parts.push(`${r.handoff}${f}`.trim());
        break;
      }
      case "check":
        parts.push(`${r.command} → ${r.reason === "timeout" ? "timeout" : `exit ${r.exit_code}`} (${Math.round(r.duration_ms / 100) / 10}s)`);
        break;
      case "classify":
        parts.push(`${r.rule}${r.detail ? `: ${r.detail}` : ""}`);
        break;
      case "approve":
      case "reject":
        parts.push(`${r.kind}${r.comment ? `: ${r.comment}` : ""}`);
        break;
      case "stuck":
        parts.push(`stuck: ${r.reason}`);
        break;
      case "ask":
        parts.push(`ask: ${r.question}`);
        break;
      case "answer":
        parts.push(`answer: ${r.answer}`);
        break;
      case "unstick":
      case "mode":
      case "workflow":
        parts.push(receiptSummary(r));
        break;
      case "started":
        break;
    }
  }
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

/** Human wait inside a step: ask → answer (or step exit / now when unanswered). */
function askWait(receipts: NumberedReceipt[], end: number): number {
  let total = 0;
  let open: number | null = null;
  for (const { receipt: r } of receipts) {
    if (r.kind === "ask") open ??= ms(r.at);
    else if (open !== null && r.kind === "answer") {
      total += Math.max(0, ms(r.at) - open);
      open = null;
    }
  }
  if (open !== null && Number.isFinite(end)) total += Math.max(0, end - open);
  return total;
}

const abs = (base: string, p: string) => (isAbsolute(p) ? p : join(base, p));

function emptyTotals(): StepTotals {
  return { wall_clock_ms: null, merge_wait_ms: null, by_type: {}, by_step: {}, human_wait_ms: 0 };
}

function addTotals(t: StepTotals, rows: StepRow[]): void {
  for (const r of rows) {
    const d = r.duration_ms ?? 0;
    t.by_type[r.type] = (t.by_type[r.type] ?? 0) + d;
    t.by_step[r.step] = (t.by_step[r.step] ?? 0) + d;
    t.human_wait_ms += r.wait_ms;
  }
}

/** Rows and summary of one unit. */
export function buildStepTimeline(input: StepTimelineInput, opts: StepTimelineOptions): TraceView {
  const { state, receipts } = input;
  const segs = new Map<string, Seg>();
  let order = 0;
  const seg = (step: string, attempt: number): Seg => {
    const k = keyOf(step, attempt);
    let s = segs.get(k);
    if (!s) {
      s = { step, attempt, entered_at: null, left_at: null, outcome: null, to: null, counter: null, receipts: [], order: order++ };
      segs.set(k, s);
    }
    return s;
  };

  // 1. Trace transitions: each state snapshot after a tick action marks the cursor.
  const { marks, first_at, merged_at } = stateMarks(input.events, input.key);
  let cur: Seg | null = null;
  let done_at: string | null = null;
  for (const m of marks) {
    if (cur && cur.step === m.step && cur.attempt === m.attempt) continue;
    if (cur) {
      cur.left_at = m.step === "$done" ? (m.updated_at ?? m.at) : m.entered_at;
      cur.outcome = m.outcome ?? cur.outcome;
      cur.to = m.step;
      cur.counter = m.counter;
    }
    if (m.step === "$done" || m.step === "$stuck") {
      if (m.step === "$done") done_at = m.updated_at ?? m.at;
      cur = null;
      continue;
    }
    cur = seg(m.step, m.attempt);
    cur.entered_at ??= m.entered_at;
  }

  // 2. Receipts: durable; they create rows the trace no longer knows about.
  for (const nr of receipts) {
    const r = nr.receipt;
    if (r.step === "$done" || r.step === "$stuck") continue;
    seg(r.step, r.attempt).receipts.push(nr);
  }
  // The cursor step, entered but not yet reported on.
  if (state && state.step !== "$done" && state.step !== "$stuck") {
    const s = seg(state.step, state.attempt);
    s.entered_at ??= state.step_entered_at;
  }
  if (state?.status === "done") done_at ??= state.updated_at;

  // 3. Order and fill gaps from receipts (entry = previous exit; exit = outcome receipt).
  const sortAt = (s: Seg) => {
    const t = ms(s.entered_at ?? s.receipts[0]?.receipt.at);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const list = [...segs.values()].sort((a, b) => sortAt(a) - sortAt(b) || a.order - b.order);
  const isCursor = (s: Seg) => !!state && state.step === s.step && state.attempt === s.attempt && state.status !== "done";
  list.forEach((s, i) => {
    const prev = list[i - 1];
    if (!s.entered_at) s.entered_at = (i === 0 ? state?.created_at : prev?.left_at) ?? s.receipts[0]?.receipt.at ?? null;
    const last = [...s.receipts].reverse().find((r) => outcomeOf(r.receipt) !== null);
    if (!s.outcome && last) s.outcome = outcomeOf(last.receipt);
    if (!s.to && last?.receipt.kind === "classify") s.to = last.receipt.route;
    if (!s.left_at && !isCursor(s)) s.left_at = list[i + 1]?.entered_at ?? (i === list.length - 1 ? done_at : null) ?? last?.receipt.at ?? null;
    if (!s.to) s.to = list[i + 1]?.step ?? (s.left_at && done_at && i === list.length - 1 ? "$done" : null);
  });

  // 4. Events per row (optional): receipts by step/attempt, trace events by time window.
  let hidden = 0;
  const eventsByRow = new Map<Seg, TimelineEntry[]>();
  {
    const entries: Array<{ e: TimelineEntry; seg: Seg | null }> = [];
    for (const s of list) for (const nr of s.receipts) entries.push({ e: { at: nr.receipt.at, source: "receipt", kind: nr.receipt.kind, summary: receiptSummary(nr.receipt, Number.POSITIVE_INFINITY), ref: abs(input.runs_dir, `receipts/${nr.file.split("/").at(-1)}`) }, seg: s });
    for (const ev of input.events)
      for (const e of traceEntries(ev, input.key, Number.POSITIVE_INFINITY)) {
        if (!opts.all && isNoiseEntry(e)) {
          hidden++;
          continue;
        }
        if (e.source === "briefing") e.ref = abs(input.trace_dir, e.ref);
        entries.push({ e, seg: null });
      }
    // Foreign commits are always shown on their row: they change the branch behind norn's back.
    const shown = opts.events || opts.all ? entries : entries.filter(({ e }) => e.source === "foreign");
    {
      for (const { e, seg: s } of shown) {
        const t = ms(e.at);
        const target = s ?? [...list].reverse().find((x) => ms(x.entered_at) <= t) ?? list[0];
        if (!target) continue;
        const l = eventsByRow.get(target) ?? [];
        l.push(e);
        eventsByRow.set(target, l);
      }
      for (const l of eventsByRow.values()) l.sort((a, b) => ms(a.at) - ms(b.at));
    }
  }

  // Briefings per (step, attempt).
  const briefings = new Map<string, string[]>();
  for (const ev of input.events)
    if (ev.type === "briefing" && ev.unit === input.key) {
      const k = keyOf(ev.step, ev.attempt);
      briefings.set(k, [...(briefings.get(k) ?? []), abs(input.trace_dir, ev.briefing)]);
    }

  const rows: StepRow[] = list.map((s) => {
    const open = isCursor(s) && !s.left_at;
    const end = s.left_at ? ms(s.left_at) : open ? opts.now : Number.NaN;
    const start = ms(s.entered_at);
    const duration = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
    const { type, attended } = inferType(s, input.workflow);
    const wait = type === "gate" ? (duration ?? 0) : askWait(s.receipts, end);
    const evidence = s.receipts.flatMap(({ receipt: r }) => (r.kind === "done" && r.evidence ? [abs(input.runs_dir, r.evidence)] : []));
    const logs = s.receipts.flatMap(({ receipt: r }) => (r.kind === "check" && r.log ? [abs(input.runs_dir, r.log)] : []));
    const row: StepRow = {
      unit: input.key,
      slice: input.slice,
      step: s.step,
      attempt: s.attempt,
      type,
      attended,
      entered_at: s.entered_at,
      left_at: s.left_at,
      duration_ms: duration,
      open,
      outcome: s.outcome,
      to: s.to,
      counter: s.counter,
      who: whoOf(s.receipts),
      reason: reasonOf(s.receipts),
      wait_ms: wait,
      paths: {
        receipts: s.receipts.map((nr) => abs(input.runs_dir, `receipts/${nr.file.split("/").at(-1)}`)),
        evidence,
        logs,
        briefings: briefings.get(keyOf(s.step, s.attempt)) ?? [],
      },
    };
    if (opts.events || opts.all) row.events = eventsByRow.get(s) ?? [];
    else if (eventsByRow.has(s)) row.events = eventsByRow.get(s);
    return row;
  });

  const intake_at = [input.intake_at, state?.created_at, first_at, rows[0]?.entered_at]
    .filter((x): x is string => !!x)
    .sort((a, b) => ms(a) - ms(b))[0] ?? null;
  const totals = emptyTotals();
  addTotals(totals, rows);
  const endWall = done_at ? ms(done_at) : opts.now;
  totals.wall_clock_ms = intake_at ? Math.max(0, endWall - ms(intake_at)) : null;
  totals.merge_wait_ms = merged_at && done_at ? Math.max(0, ms(merged_at) - ms(done_at)) : null;

  const unit: UnitTraceSummary = {
    unit: input.key,
    story: input.story,
    slice: input.slice,
    title: input.title,
    status: state?.status ?? "not_started",
    step: state?.step ?? null,
    intake_at,
    done_at,
    merged_at,
    totals,
  };
  return { ...unit, steps: rows, units: [unit], hidden_events: hidden };
}

/**
 * Story view: the story's rows interleaved in time with each slice's rows; totals over the
 * story (wall-clock, per step type) plus human wait summed over the story and its slices.
 */
export function mergeStoryTimeline(story: TraceView, slices: TraceView[]): TraceView {
  const rows = [...story.steps.map((r, i) => ({ r, i, u: 0 })), ...slices.flatMap((s, u) => s.steps.map((r, i) => ({ r, i, u: u + 1 })))];
  const t = (r: StepRow) => {
    const x = ms(r.entered_at);
    return Number.isFinite(x) ? x : Number.POSITIVE_INFINITY;
  };
  rows.sort((a, b) => t(a.r) - t(b.r) || a.u - b.u || a.i - b.i);
  const totals: StepTotals = { ...story.totals, by_type: { ...story.totals.by_type }, by_step: { ...story.totals.by_step } };
  totals.human_wait_ms += slices.reduce((s, x) => s + x.totals.human_wait_ms, 0);
  return {
    ...story,
    totals,
    steps: rows.map((x) => x.r),
    units: [...story.units, ...slices.flatMap((s) => s.units)],
    hidden_events: story.hidden_events + slices.reduce((s, x) => s + x.hidden_events, 0),
  };
}
