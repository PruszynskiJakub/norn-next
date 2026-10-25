/**
 * Shared by the agent-protocol verbs (`brief`, `done`, `ask`, `stuck`, `hook`; §9): locate the
 * unit worktree (A3), load its runs/<unit>/ (S1, S2), find the live run (MO3) and the report
 * already made for it (§9.3: exactly one report per run).
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { NumberedReceipt, UnitRef } from "@norn/core";
import { storyWorktreePath } from "@norn/core";
import type { Criterion, Mode, Receipt, ResolvedConfig, Step, UnitState, Workflow } from "@norn/schema";
import { loadUnit, readSliceFile, readState, readStoryFile, type UnitMarker, unitDir } from "@norn/store";
import { type Context, findUnitMarker } from "../context.ts";
import { corruptError, refuse } from "../output.ts";

export interface UnitSession {
  /** main checkout (trace lives here) */
  root: string;
  worktree: string;
  marker: UnitMarker;
  unit: UnitRef;
  /** absolute spec folder inside the worktree */
  specPath: string;
  /** absolute runs/<unit>/ inside the worktree */
  runsDir: string;
  state: UnitState;
  workflow: Workflow;
  /** every valid receipt, ascending */
  receipts: NumberedReceipt[];
  /** receipts above applied_through, ascending */
  unapplied: NumberedReceipt[];
}

export function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export const unitRefOf = (m: UnitMarker): UnitRef => ({ story: m.story, slice: m.slice, dir: m.unit, key: m.slice ?? m.story });

/** A3: the verbs work only inside a unit worktree. */
export function requireWorktree(ctx: Context, verb: string): { worktree: string; marker: UnitMarker } {
  if (ctx.worktree && ctx.unit) return { worktree: ctx.worktree, marker: ctx.unit };
  const found = findUnitMarker(safeRealpath(ctx.cwd));
  if (found) return found;
  throw refuse(
    `norn ${verb} runs only inside a unit worktree (a directory with a .norn-unit marker)`,
    "stop: this session is not in a unit worktree. A person starts the agent from the unit's item in `norn inbox` (`norn open <unit>` opens or prints it)",
    "not_in_unit",
  );
}

/** Load the unit of the current worktree; refuses when not started, corrupt (S2) or workflow missing. */
export function loadUnitSession(ctx: Context, verb: string, at?: { worktree: string; marker: UnitMarker }): UnitSession {
  const { worktree, marker } = at ?? requireWorktree(ctx, verb);
  const unit = unitRefOf(marker);
  const specPath = join(worktree, marker.spec_dir);
  const snap = loadUnit(worktree, specPath, unit, { includeApplied: true });
  if (snap.errors.length || snap.state?.status === "corrupt")
    throw corruptError(`unit ${unit.key} is corrupt (S2): ${snap.errors.map((e) => e.file).join(", ") || "state.json"}`, `stop and tell the person: norn why ${unit.key}`, snap.errors);
  if (!snap.state) throw refuse(`unit ${unit.key} has not started yet`, "norn tick (or wait for the heartbeat), then run it again", "not_started");
  if (!snap.workflow) throw corruptError(`unit ${unit.key} has no pinned workflow (S7)`, `stop and tell the person: norn why ${unit.key}`);
  return {
    root: safeRealpath(marker.repo),
    worktree,
    marker,
    unit,
    specPath,
    runsDir: snap.path,
    state: snap.state,
    workflow: snap.workflow.workflow,
    receipts: snap.receipts ?? [],
    unapplied: snap.unapplied,
  };
}

export const stepOfSession = (s: UnitSession): Step | null => (s.state.step === "$done" ? null : (s.workflow.steps[s.state.step] ?? null));

const atCursor = (s: UnitSession, r: Receipt) => r.step === s.state.step && r.attempt === s.state.attempt;

/**
 * The live run of the cursor step (MO3): the applied run in state.json, else a `started`
 * receipt for this step/attempt not yet applied by the tick (brief ran, no tick since).
 */
export function currentRun(s: UnitSession): { run_id: string; applied: boolean } | null {
  const st = s.state;
  if (st.run && st.run.step === st.step && st.run.attempt === st.attempt && (st.status === "running" || st.status === "parked"))
    return { run_id: st.run.run_id, applied: true };
  const pending = s.unapplied.findLast((r) => r.receipt.kind === "started" && atCursor(s, r.receipt) && r.receipt.run_id);
  return pending?.receipt.run_id ? { run_id: pending.receipt.run_id, applied: false } : null;
}

const REPORTS = new Set(["done", "ask", "stuck"]);

/**
 * The report already made for `run_id` that still stands: a `done` or `stuck`, or an `ask`
 * not answered since (an answer resumes the same run, B2). Implicit asks (norn) don't count.
 */
export function standingReport(s: UnitSession, run_id: string): NumberedReceipt | null {
  let last: NumberedReceipt | null = null;
  for (const nr of s.receipts) {
    const r = nr.receipt;
    if (!atCursor(s, r)) continue;
    if (REPORTS.has(r.kind) && r.run_id === run_id && r.by === "agent" && !(r.kind === "ask" && r.implicit)) last = nr;
    else if (r.kind === "answer" && last?.receipt.kind === "ask") last = null;
  }
  return last;
}

export const reportCommand = (r: Receipt) => (r.kind === "done" ? `norn done ${r.outcome}` : `norn ${r.kind}`);

/** Refusal when the unit is in no shape for an agent to work on it (do_instead names the right command). */
export function refuseUnlessAgentWork(s: UnitSession, verb: string): void {
  const st = s.state;
  const key = s.unit.key;
  if (st.status === "done" || st.step === "$done") throw refuse(`unit ${key} is done; there is nothing to ${verb}`, "end your turn", "unit_done");
  if (st.status === "stuck")
    throw refuse(`unit ${key} is stuck: ${st.park?.reason ?? "unknown"}`, `end your turn; a person unblocks it with: norn unstick ${key}`, "unit_stuck");
  const step = stepOfSession(s);
  if (!step) throw refuse(`step '${st.step}' does not exist in workflow ${s.workflow.name} (S7)`, `end your turn; a person fixes it with: norn unstick ${key} --to <step>`, "no_step");
  if (step.type === "gate") throw refuse(`${st.step} is a gate: a person decides, not an agent`, `end your turn; a person runs: norn approve ${key} (or --reject)`, "gate_step");
  if (step.type !== "agent")
    throw refuse(`${st.step} is a ${step.type} step: norn runs it, not an agent`, "end your turn; the heartbeat (norn tick / norn watch) runs it", "not_agent_step");
  // R6.1 (A14): an implicit ask (a prompt norn saw in the pane or a hook) does not hold the agent
  // back — its report is the answer, also once a person's answer waits to be applied (B6: the
  // answer let the agent's own `norn done` run); an explicit `norn ask` waits for the person
  if (st.status === "parked" && st.park?.kind === "ask") {
    if (!implicitAsk(s)) throw refuse(`unit ${key} waits for an answer: ${st.park.reason}`, `end your turn; a person answers with: norn answer ${key} "…"`, "parked_ask");
  } else if (st.status === "parked" && st.park?.kind !== "attended")
    throw refuse(`unit ${key} is parked (${st.park?.kind}): ${st.park?.reason ?? ""}`, `end your turn; a person resolves it: norn unstick ${key}`, "parked");
}

/**
 * R6.1: the implicit ask the unit is parked on (park flag, or the ask receipt of older states), and
 * whether an answer to it (a person's, or the tick's) already waits to be applied. Null when the
 * unit is not parked on an implicit ask.
 */
export function implicitAsk(s: UnitSession): { ask: NumberedReceipt; answered: boolean } | null {
  const park = s.state.status === "parked" && s.state.park?.kind === "ask" ? s.state.park : null;
  if (!park) return null;
  const ask = s.receipts.findLast((r) => r.receipt.kind === "ask" && atCursor(s, r.receipt) && (!park.receipt_id || r.receipt.receipt_id === park.receipt_id));
  if (!ask || !(park.implicit || (ask.receipt.kind === "ask" && ask.receipt.implicit))) return null;
  return { ask, answered: s.unapplied.some((r) => r.receipt.kind === "answer" && atCursor(s, r.receipt)) };
}

/** R6.1: the implicit ask the unit is parked on, when no answer to it waits to be applied yet. */
export function implicitAskOpen(s: UnitSession): NumberedReceipt | null {
  const open = implicitAsk(s);
  return open && !open.answered ? open.ask : null;
}

/** The story's mode (MO1): stored in the story unit's state, which lives in the story worktree. */
export function storyMode(ctx: Context, s: UnitSession, config: ResolvedConfig): Mode {
  if (s.unit.slice === null) return s.state.mode ?? config.default_mode;
  const slug = basename(s.marker.spec_dir).slice(s.unit.story.length + 1);
  const wt = storyWorktreePath(s.root, s.unit.story, slug);
  const dir = unitDir(join(existsSync(wt) ? wt : s.root, s.marker.spec_dir), "_story");
  const st = readState(dir);
  return (st.ok ? st.value.mode : undefined) ?? config.default_mode;
}

/** `who` for agent receipts: the run's agent, else the step's, else the default (A6). */
export function agentName(s: UnitSession, config: ResolvedConfig): string {
  const step = stepOfSession(s);
  return s.state.run?.agent ?? (step?.type === "agent" ? step.agent : undefined) ?? config.default_agent;
}

/** QV1/QV4: the unit's frontmatter `criteria` — its slice file, or story.md for the story unit; null = none declared. */
export function unitCriteria(s: UnitSession): Criterion[] | null {
  const file = s.unit.slice ? join(s.specPath, "slices", `${s.unit.dir}.md`) : join(s.specPath, "story.md");
  const r = s.unit.slice ? readSliceFile(file, s.worktree) : readStoryFile(file, s.worktree);
  if (r.ok) return r.value.frontmatter.criteria ?? null;
  if (r.reason === "missing") return null;
  throw corruptError(`${file} failed validation (S2): its criteria cannot be checked`, `stop and tell the person: norn why ${s.unit.key}`, r.error ? [r.error] : []);
}
