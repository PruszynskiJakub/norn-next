/**
 * Shared by the agent-protocol verbs (`brief`, `done`, `ask`, `stuck`, `hook`; §9): locate the
 * unit worktree (A3) and load its runs/<unit>/ (S1, S2). The rules over the loaded unit (live run,
 * standing report, implicit ask, agent work) live in core `agent-unit.ts`.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentUnit, UnitRef } from "@norn/core";
import { cmd, agentWorkRefusal, cursorStep, storyWorktreePath } from "@norn/core";
import type { Criterion, Mode, Receipt, ResolvedConfig } from "@norn/schema";
import { loadUnit, readSliceFile, readState, readStoryFile, type UnitMarker, unitDir } from "@norn/store";
import { type Context, findUnitMarker, safeRealpath } from "../context.ts";
import { corruptError, refuse } from "../output.ts";

export interface UnitSession extends AgentUnit {
  /** main checkout (trace lives here) */
  root: string;
  worktree: string;
  marker: UnitMarker;
  /** absolute spec folder inside the worktree */
  specPath: string;
  /** absolute runs/<unit>/ inside the worktree */
  runsDir: string;
}

const unitRefOf = (m: UnitMarker): UnitRef => ({ story: m.story, slice: m.slice, dir: m.unit, key: m.slice ?? m.story });

/** A3: the verbs work only inside a unit worktree. */
function requireWorktree(ctx: Context, verb: string): { worktree: string; marker: UnitMarker } {
  if (ctx.worktree && ctx.unit) return { worktree: ctx.worktree, marker: ctx.unit };
  const found = findUnitMarker(safeRealpath(ctx.cwd));
  if (found) return found;
  throw refuse(
    `norn ${verb} runs only inside a unit worktree (a directory with a .norn-unit marker)`,
    `stop: this session is not in a unit worktree. A person starts the agent from the unit's item in \`${cmd.inbox()}\` (\`${cmd.open("<unit>")}\` opens or prints it)`,
    "not_in_unit",
  );
}

/** Set in the environment of an orient agent (`norn orient --open`): its hooks are not facts of any run. */
export const ORIENT_ENV = "NORN_ORIENT";

/** Load the unit of the current worktree; refuses when not started, corrupt (S2) or workflow missing. */
export function loadUnitSession(ctx: Context, verb: string, at?: { worktree: string; marker: UnitMarker }): UnitSession {
  // orient: the agent beside a person is no run of the unit, so it cannot start or report one
  if (ctx.env[ORIENT_ENV] === "1" && verb !== "hook")
    throw refuse(`norn ${verb} is not for an orient session: it is no run of the unit`, `tell the person what you found; they run the step's agent with \`${cmd.open()}\` or the cockpit`, "orient_session");
  const { worktree, marker } = at ?? requireWorktree(ctx, verb);
  const unit = unitRefOf(marker);
  const specPath = join(worktree, marker.spec_dir);
  const snap = loadUnit(worktree, specPath, unit, { includeApplied: true });
  if (snap.errors.length || snap.state?.status === "corrupt")
    throw corruptError(`unit ${unit.key} is corrupt (S2): ${snap.errors.map((e) => e.file).join(", ") || "state.json"}`, `stop and tell the person: ${cmd.why(unit.key)}`, snap.errors);
  if (!snap.state) throw refuse(`unit ${unit.key} has not started yet`, `${cmd.tick()} (or wait for the heartbeat), then run it again`, "not_started");
  if (!snap.workflow) throw corruptError(`unit ${unit.key} has no pinned workflow (S7)`, `stop and tell the person: ${cmd.why(unit.key)}`);
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

export const reportCommand = (r: Receipt) => (r.kind === "done" ? `norn done ${r.outcome}` : `norn ${r.kind}`);

/** Throw the refusal when the unit is in no shape for an agent to work on it (rule: core `agentWorkRefusal`). */
export function refuseUnlessAgentWork(s: UnitSession, verb: string): void {
  const no = agentWorkRefusal(s, verb);
  if (no) throw refuse(no.error, no.do_instead, no.code);
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
  const step = cursorStep(s);
  return s.state.run?.agent ?? (step?.type === "agent" ? step.agent : undefined) ?? config.default_agent;
}

/** QV1/QV4: the unit's frontmatter `criteria` — its slice file, or story.md for the story unit; null = none declared. */
export function unitCriteria(s: UnitSession): Criterion[] | null {
  const file = s.unit.slice ? join(s.specPath, "slices", `${s.unit.dir}.md`) : join(s.specPath, "story.md");
  const r = s.unit.slice ? readSliceFile(file, s.worktree) : readStoryFile(file, s.worktree);
  if (r.ok) return r.value.frontmatter.criteria ?? null;
  if (r.reason === "missing") return null;
  throw corruptError(`${file} failed validation (S2): its criteria cannot be checked`, `stop and tell the person: ${cmd.why(s.unit.key)}`, r.error ? [r.error] : []);
}
