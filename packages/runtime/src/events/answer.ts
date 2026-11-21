/**
 * The kernel's answer to one hook call, from the events it just normalized and what the run is at.
 * Pure. Which answer a hook wants follows from its events: a `tool.requested` asks for a guard, a
 * `turn.ended` for a stop ruling, a `session.started`, `turn.started` or `context.compacted` for
 * context. Nothing to say is null, which a harness renders as allow.
 *
 * - guard: deny a write outside the run's worktree, or to norn's run state, as the old hook did; on
 *   a `writes: docs` step, also a write in the worktree outside the story's spec folder;
 * - stop: block while the run has not reported and its step needs a report, the reason telling the
 *   agent how to report once, at most MAX_STOP_BLOCKS times a run: past that the turn ends, and the
 *   step's bounded nudges and retries take over from a block that would otherwise never end;
 * - context: the outbox's pending entries, which the caller marks delivered once the answer is out.
 */
import type { HarnessAnswer, HarnessCapabilities, HarnessEvent } from "@norn/plugin-api";
import type { Injection } from "./outbox.ts";

export interface AnswerContext {
  /** the run's worktree: writes inside it are the agent's own */
  worktree: string;
  /** paths no agent may write (the data dir's run state), absolute */
  protectedPaths: readonly string[];
  /** the run has reported, by a receipt or a `report.made` event */
  reported: boolean;
  /** the step routes on the agent's report, so ending a turn without one leaves the step hanging */
  needsReport: boolean;
  /** the run has used its MAX_STOP_BLOCKS refusals, so a missing report no longer blocks */
  stopBlocksSpent?: boolean;
  /** how to report, for a stop block's reason: the commands and the step's outcomes */
  reportHint: string;
  pending: readonly Injection[];
  capabilities: HarnessCapabilities;
  /**
   * Roots outside the worktree a write may land in (a temp folder for evidence and findings files);
   * a protected path inside one is still denied.
   */
  writableRoots?: readonly string[];
  /**
   * Set when the run's step is `writes: docs`: inside the worktree a write may land only in `dir`, the
   * story's spec folder; `done` is how the report command is spelled, for the reason a denial gives.
   */
  docs?: { step: string; dir: string; done: string };
  /**
   * The same paths with their symlinks followed: `writes` maps each write's folded path to its real
   * one. A write whose real path lands in run state is denied though its folded path is in the worktree,
   * and on a docs-only step one whose real path leaves the spec folder (`docs`) for the rest of the worktree.
   */
  real?: { worktree: string; protectedPaths: readonly string[]; writes: Readonly<Record<string, string>>; docs?: string };
  /**
   * What to restate when a session starts again having lost its brief (a resume, a compaction);
   * absent on the first start, where the brief itself is about to be read.
   */
  reminder?: string;
}

export interface ComputedAnswer {
  answer: HarnessAnswer | null;
  /** outbox entries this answer carries */
  delivers: string[];
}

/** `p` with `.` and `..` folded, resolved against `base` when relative. Pure: no symlink is followed. */
export function resolvePath(base: string, p: string): string {
  const parts: string[] = [];
  for (const seg of (p.startsWith("/") ? p : `${base}/${p}`).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

/** `p` is `dir` or inside it; both already resolved. */
function under(dir: string, p: string): boolean {
  return p === dir || p.startsWith(dir === "/" ? "/" : `${dir}/`);
}

function guard(events: readonly HarnessEvent[], ctx: AnswerContext): HarnessAnswer | null {
  const worktree = resolvePath("/", ctx.worktree);
  for (const e of events) {
    if (e.type !== "tool.requested" || e.kind !== "write" || !e.detail) continue;
    const path = resolvePath(worktree, e.detail);
    // a protected folder may hold the worktree (a data dir with the worktrees inside it): the worktree stays the agent's
    const hit = under(worktree, path) ? undefined : ctx.protectedPaths.map((p) => resolvePath("/", p)).find((p) => under(p, path));
    // a link in the worktree can carry a write elsewhere: the path it really lands on is judged too
    const real = ctx.real;
    const landed = real?.writes[path];
    const realHit = real === undefined || landed === undefined || under(real.worktree, landed) ? undefined : real.protectedPaths.find((p) => under(p, landed));
    if (hit !== undefined || realHit !== undefined)
      return { kind: "deny", reason: `norn: \`${path}\` is norn's run state. Never edit it: a hand-edited file fails validation and makes the unit corrupt.` };
    const roots = [worktree, ...(ctx.writableRoots ?? []).map((r) => resolvePath("/", r))];
    if (!roots.some((r) => under(r, path)))
      return {
        kind: "deny",
        reason: `norn: \`${path}\` is outside this unit's worktree \`${worktree}\`. Work only in this worktree: another one is another unit's live work.`,
      };
    if (ctx.docs && under(worktree, path)) {
      const dir = resolvePath(worktree, ctx.docs.dir);
      // a link in the spec folder can carry a write into the code: where it really lands is judged too
      const escaped = real?.docs !== undefined && landed !== undefined && under(real.worktree, landed) && !under(real.docs, landed);
      if (!under(dir, path) || escaped) return { kind: "deny", reason: docsOnlyReason(ctx.docs, dir, path) };
    }
  }
  return null;
}

function docsOnlyReason(docs: NonNullable<AnswerContext["docs"]>, dir: string, path: string): string {
  return (
    `norn: step \`${docs.step}\` is docs-only (\`writes: docs\`): it writes only the story's documents in \`${dir}\` and files outside the repo, never \`${path}\`. ` +
    `Do not edit code in this step: report what needs changing as findings, \`${docs.done} <outcome> --findings <file>\` with the file outside the repo (under $TMPDIR).`
  );
}

/** Turn ends refused per run for want of a report, before the turn may end and classification takes over. */
export const MAX_STOP_BLOCKS = 3;

const STOP_EVENTS: ReadonlySet<HarnessEvent["type"]> = new Set(["turn.ended"]);
const CONTEXT_EVENTS: ReadonlySet<HarnessEvent["type"]> = new Set(["session.started", "turn.started", "context.compacted"]);

function joined(pending: readonly Injection[]): string {
  return pending.map((p) => p.text).join("\n\n");
}

/**
 * Whether these events ask for a stop ruling that would block for a missing report, the one answer
 * that spends a refusal; the caller claims one before answering and passes `stopBlocksSpent` when
 * none is left.
 */
export function owesReportBlock(events: readonly HarnessEvent[], ctx: Pick<AnswerContext, "needsReport" | "reported" | "capabilities">): boolean {
  if (events.some((e) => e.type === "tool.requested") || !events.some((e) => STOP_EVENTS.has(e.type))) return false;
  return ctx.capabilities.blockStop && ctx.needsReport && !ctx.reported;
}

/**
 * The pending entries this answer may carry. A nudge asks for the report, so once the run has
 * reported it has nothing left to say: carried on a stop, it would block a run that is done.
 */
function due(ctx: AnswerContext): readonly Injection[] {
  return ctx.reported ? ctx.pending.filter((p) => p.source !== "nudge") : ctx.pending;
}

function stop(ctx: AnswerContext): ComputedAnswer {
  const blocks = ctx.capabilities.blockStop;
  const owed = ctx.needsReport && !ctx.reported && ctx.stopBlocksSpent !== true;
  // a queued nudge or answer rides on the block: the agent reads the reason and carries on with it
  const pending = due(ctx);
  const carried = blocks && pending.length > 0 ? pending : [];
  if (!owed && carried.length === 0) return { answer: null, delivers: [] };
  if (!blocks) return { answer: null, delivers: [] };
  const reason = [carried.length > 0 ? joined(carried) : null, owed ? ctx.reportHint : null].filter((x): x is string => x !== null).join("\n\n");
  return { answer: { kind: "block", reason }, delivers: carried.map((p) => p.id) };
}

function context(events: readonly HarnessEvent[], ctx: AnswerContext): ComputedAnswer {
  if (!ctx.capabilities.injectContext) return { answer: null, delivers: [] };
  const restarted = events.some((e) => e.type === "session.started" || e.type === "context.compacted");
  const pending = due(ctx);
  const texts = [restarted && ctx.reminder ? ctx.reminder : null, pending.length > 0 ? joined(pending) : null].filter((x): x is string => x !== null);
  if (texts.length === 0) return { answer: null, delivers: [] };
  return { answer: { kind: "context", text: texts.join("\n\n") }, delivers: pending.map((p) => p.id) };
}

export function answerFor(events: readonly HarnessEvent[], ctx: AnswerContext): ComputedAnswer {
  if (events.some((e) => e.type === "tool.requested")) {
    const denied = ctx.capabilities.denyTool ? guard(events, ctx) : null;
    return { answer: denied, delivers: [] };
  }
  if (events.some((e) => STOP_EVENTS.has(e.type))) return stop(ctx);
  if (events.some((e) => CONTEXT_EVENTS.has(e.type))) return context(events, ctx);
  return { answer: null, delivers: [] };
}
