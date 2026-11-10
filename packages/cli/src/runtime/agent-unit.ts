/**
 * Shared by the agent-protocol verbs (`brief`, `done`, `ask`, `stuck`, `hook`): locate the
 * unit worktree and load its runs/<unit>/. The rules over the loaded unit (live run,
 * standing report, implicit ask, agent work) live in core `agent-unit.ts`.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentUnit, UnitRef } from "@norn/core";
import { cmd, agentWorkRefusal, cursorStep, foreignSessionRefusal, storyMode, storyWorktreePath } from "@norn/core";
import { type Criterion, type Mode, type Receipt, type ResolvedConfig, STORY_UNIT_DIR } from "@norn/schema";
import { loadUnit, readPinnedWorkflow, readUnitHooks, readSliceFile, readState, readStoryFile, storyFile, type UnitMarker, runStateDir, worktreesDir } from "@norn/store";
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
  /** the unit's handoff, from its own resolver */
  handoffFile: string;
}

const unitRefOf = (m: UnitMarker): UnitRef => ({ story: m.story, slice: m.slice, dir: m.unit, key: m.slice ?? m.story });

/** The verbs work only inside a unit worktree. */
function requireWorktree(ctx: Context, verb: string): { worktree: string; marker: UnitMarker } {
  if (ctx.worktree && ctx.unit) return { worktree: ctx.worktree, marker: ctx.unit };
  const found = findUnitMarker(safeRealpath(ctx.cwd));
  if (found) return found;
  throw refuse(
    `norn ${verb} runs only inside a unit worktree (a directory with a .norn-unit marker)`,
    `stop: this session is not in a unit worktree. A person starts the agent from the unit's item in \`${cmd.status()}\` (\`${cmd.storyStart("<unit>")}\` opens or prints it)`,
    "not_in_unit",
  );
}

/** Set in the environment of an orient agent (`norn story chat`): its hooks are not facts of any run. */
export const ORIENT_ENV = "NORN_ORIENT";

/** Load the unit of the current worktree; refuses when not started, corrupt or workflow missing. */
export function loadUnitSession(ctx: Context, verb: string, at?: { worktree: string; marker: UnitMarker }): UnitSession {
  // orient: the agent beside a person is no run of the unit, so it cannot start or report one
  if (ctx.env[ORIENT_ENV] === "1" && verb !== "hook")
    throw refuse(`norn ${verb} is not for an orient session: it is no run of the unit`, `tell the person what you found; they run the step's agent with \`${cmd.storyStart()}\` or the cockpit`, "orient_session");
  const { worktree, marker } = at ?? requireWorktree(ctx, verb);
  const unit = unitRefOf(marker);
  const specPath = join(worktree, marker.spec_dir);
  const snap = loadUnit(worktree, { key: marker.story, spec_dir: marker.spec_dir }, unit, { includeApplied: true });
  if (snap.errors.length || snap.state?.status === "corrupt")
    throw corruptError(`unit ${unit.key} is corrupt: ${snap.errors.map((e) => e.file).join(", ") || "state.json"}`, `stop and tell the person: ${cmd.runView(unit.key, { why: true })}`, snap.errors);
  if (!snap.state) throw refuse(`unit ${unit.key} has not started yet`, `${cmd.tick()} (or wait for the heartbeat), then run it again`, "not_started");
  if (!snap.workflow) throw corruptError(`unit ${unit.key} has no pinned workflow`, `stop and tell the person: ${cmd.runView(unit.key, { why: true })}`);
  return {
    root: safeRealpath(marker.repo),
    worktree,
    marker,
    unit,
    specPath,
    runsDir: snap.path,
    handoffFile: snap.handoffFile,
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

/**
 * The agent session running `norn <verb>` here, from the hooks that fired in this worktree just
 * before — the PreToolUse of this very call when it names the verb, else the latest fact with a session —
 * or `NORN_AGENT_SESSION_ID`. Also its transcript and agent.
 */
export function callerSession(ctx: Context, s: UnitSession, verb: string): { agent_session_id?: string; transcript?: string; agent?: string } {
  const since = new Date(ctx.clock.now() - 3_600_000).toISOString();
  const own = readUnitHooks(s.root, [{ story: s.unit.story, slice: s.unit.slice }], since)[0] ?? [];
  const facts = own.map((e) => e.fact).filter((f) => f.agent_session_id && (f.cwd === s.worktree || f.cwd.startsWith(`${s.worktree}/`)));
  const call = new RegExp(`\\bnorn\\b.*\\b${verb}\\b`);
  const last = facts.findLast((f) => f.event === "tool_use" && f.native === "PreToolUse" && !!f.command && call.test(f.command)) ?? facts.at(-1);
  const id = last?.agent_session_id ?? ctx.env.NORN_AGENT_SESSION_ID;
  const out: { agent_session_id?: string; transcript?: string; agent?: string } = {};
  if (id) out.agent_session_id = id;
  if (last?.transcript) out.transcript = last.transcript;
  if (last?.agent) out.agent = last.agent;
  return out;
}

/** Refuse when another agent session than the run's own runs `norn <verb>` on it. */
export function refuseForeignSession(ctx: Context, s: UnitSession, run_id: string, verb: string): void {
  const no = foreignSessionRefusal(s, run_id, callerSession(ctx, s, verb).agent_session_id ?? null, verb);
  if (no) throw refuse(no.error, no.do_instead, no.code);
}

/** The story's mode: stored in the story unit's state, which lives in the story worktree. */
export function unitStoryMode(_ctx: Context, s: UnitSession, config: ResolvedConfig): Mode {
  if (s.unit.slice === null) return storyMode(s.state, s.workflow, config);
  const slug = basename(s.marker.spec_dir).slice(s.unit.story.length + 1);
  const wt = storyWorktreePath(worktreesDir(s.root), s.unit.story, slug);
  const dir = runStateDir(existsSync(wt) ? wt : s.root, { key: s.unit.story, spec_dir: s.marker.spec_dir }, STORY_UNIT_DIR);
  const st = readState(dir);
  const wf = readPinnedWorkflow(dir);
  return storyMode(st.ok ? st.value : null, wf.ok ? wf.value.workflow : null, config);
}

/** `who` for agent receipts: the run's agent, else the step's, else the default. */
export function agentName(s: UnitSession, config: ResolvedConfig): string {
  const step = cursorStep(s);
  return s.state.run?.agent ?? (step?.type === "agent" ? step.agent : undefined) ?? config.agent;
}

/** The unit's frontmatter `criteria` — its slice file, or spec.md for the story unit; null = none declared. */
export function unitCriteria(s: UnitSession): Criterion[] | null {
  const file = s.unit.slice ? join(s.specPath, "slices", `${s.unit.dir}.md`) : storyFile(s.specPath);
  const r = s.unit.slice ? readSliceFile(file, s.worktree) : readStoryFile(file, s.worktree);
  if (r.ok) return r.value.frontmatter.criteria ?? null;
  if (r.reason === "missing") return null;
  // A slice or story still carrying criteria `needs` is refused, not corrupt
  if (r.reason === "needs_removed") throw refuse(r.error.errors[0]?.message ?? "`needs` was removed", `fix ${r.error.file}`, "needs_removed");
  throw corruptError(`${file} failed validation: its criteria cannot be checked`, `stop and tell the person: ${cmd.runView(s.unit.key, { why: true })}`, r.error ? [r.error] : []);
}
