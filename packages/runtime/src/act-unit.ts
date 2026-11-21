/**
 * Decisions that move a unit's record without starting anything: applying receipts, parking, marking
 * it done or corrupt, and starting a story's slices. Each writes its receipts before its state, and a
 * state is only ever the one decide computed, so routing stays in the kernel.
 */
import { type DecisionOf, newRunState, type RunState } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { ensureWorktree } from "./branches.ts";
import type { TickContext } from "./env.ts";
import { worktreeOf } from "./inputs.ts";
import { unitInFacts, writeAndCommit } from "./record.ts";

const unitOf = (d: { unit: string | null; rule: string }): string => {
  if (d.unit === null) throw new Error(`${d.rule}: a unit decision without a unit`);
  return d.unit;
};

/**
 * A session that ended is resumed in the unit's worktree, which a person may have removed while the
 * unit was parked. Only a missing worktree is made again: ensuring an existing one catches its branch
 * up, which would move files under a live agent, and refuses a branch that diverged from its remote
 * copy, which would hold the answer back for good.
 */
async function restoreRemovedWorktree(t: TickContext, unit: string, handle: string): Promise<PluginResult<unknown>> {
  if ((await t.env.launcher.alive?.(handle)) !== false) return ok(null);
  // a git worktree always holds its `.git` entry, so an empty listing is a folder that is gone
  if ((await t.env.ctx.files.list(worktreeOf(t.env, unit))).length > 0) return ok(null);
  return ensureWorktree(t.env, unit);
}

/**
 * Answers a person sent (`answer.sent`) that this commit applies go to the live session first: the
 * launcher is idempotent by input id, so a commit that then fails and is applied again next tick
 * delivers nothing twice, where delivering after the commit could lose an answer to a crash. A failed
 * delivery holds the commit back for the same reason. The answers decide marked `undelivered` have
 * no session that could take them and are applied as they are: the run's retry carries them.
 */
async function deliverAnswers(t: TickContext, unit: string, through: number, before: RunState | null, undelivered: readonly string[]): Promise<PluginResult<unknown>> {
  const handle = before?.run?.session;
  if (!handle) return ok(null);
  let worktreeChecked = false;
  for (const r of unitInFacts(t.facts, unit)?.receipts ?? []) {
    if (r.seq > through || r.data.kind !== "answer.sent" || undelivered.includes(r.id)) continue;
    // a dialog's keys go to a live pane, which resumes nothing
    if (!worktreeChecked && r.data.to !== "dialog") {
      const restored = await restoreRemovedWorktree(t, unit, handle);
      if (!restored.ok) return restored;
      worktreeChecked = true;
    }
    // an answer that did not reach the agent must not be applied, or the unit unparks with nobody told
    // a dialog's answer is keys pressed in the pane; typed as a prompt it would reach the agent as words
    const sent = r.data.to === "dialog" ? await t.env.launcher.answer(handle, r.data.input_id, r.data.text, { dialog: true }) : await t.env.launcher.answer(handle, r.data.input_id, r.data.text);
    if (!sent.ok) return sent;
  }
  return ok(null);
}

/**
 * A headless run the commit replaced or ended is stopped, so no agent goes on working for a step the
 * unit has left, and so is a supervisor the commit dropped. An attended run is the person's to close:
 * they work beside it.
 */
async function stopReplaced(t: TickContext, before: RunState | null, after: RunState): Promise<void> {
  // a supervisor that answered, handed back, or was overtaken by the person stands in no longer
  const sup = before?.supervisor;
  if (sup?.session && after.supervisor?.id !== sup.id) await t.env.launcher.stop(sup.session);
  const run = before?.run;
  if (!run?.session || run.attended || after.run?.id === run.id) return;
  await t.env.launcher.stop(run.session);
}

export async function applyReceipts(t: TickContext, d: DecisionOf<"apply_receipts">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const before = unitInFacts(t.facts, unit)?.state ?? null;
  const wrote = await writeAndCommit(t.env, t.facts, unit, d.receipts, d.state, d.expect_version, () => deliverAnswers(t, unit, d.state.applied_through, before, d.undelivered ?? []));
  if (!wrote.ok) return wrote;
  await stopReplaced(t, before, d.state);
  return ok({ ...wrote.value, ...(d.rejected.length ? { rejected: d.rejected } : {}) });
}

export async function park(t: TickContext, d: DecisionOf<"park">): Promise<PluginResult<unknown>> {
  const wrote = await writeAndCommit(t.env, t.facts, unitOf(d), [d.intent], d.state, d.expect_version);
  return wrote.ok ? ok({ ...wrote.value, inbox: d.inbox }) : wrote;
}

/** The mark is a receipt even on a record that fails validation; a readable state ends corrupt with it. */
export async function markCorrupt(t: TickContext, d: DecisionOf<"mark_corrupt">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const wrote = await writeAndCommit(t.env, t.facts, unit, [d.intent], d.state, d.expect_version);
  if (!wrote.ok) return wrote;
  if (d.state) await stopReplaced(t, unitInFacts(t.facts, unit)?.state ?? null, d.state);
  return ok({ ...wrote.value, reason: d.reason });
}

/** The `unit.marked` receipt is the mark; the next tick applies it, so a run still on the record is settled first. */
export async function markDone(t: TickContext, d: DecisionOf<"mark_done">): Promise<PluginResult<unknown>> {
  return writeAndCommit(t.env, t.facts, unitOf(d), [d.intent], null, null);
}

/**
 * Each slice gets its worktree, cut from the story's branch, then its first run state. A slice whose
 * state is already there was started by an earlier pass of this decision and is left as it is.
 */
export async function startSlices(t: TickContext, d: DecisionOf<"start_slices">): Promise<PluginResult<unknown>> {
  const story = unitOf(d);
  const started: string[] = [];
  for (const s of d.slices) {
    const workflow = t.workflows.byHash[s.hash];
    if (!workflow) return fail("invalid", `slice ${s.unit}: workflow ${s.workflow} (${s.hash.slice(0, 12)}) is not loaded`, false);
    const worktree = await ensureWorktree(t.env, s.unit);
    if (!worktree.ok) return worktree;
    const read = await t.env.journal.readUnit(s.unit);
    if (!read.ok) return read;
    if (read.value.state !== null || read.value.corrupt !== undefined) continue;
    const committed = await t.env.journal.commit(s.unit, newRunState({ unit: s.unit, story: story.split("/")[0] as string, workflow }), null);
    if (!committed.ok) return committed;
    started.push(s.unit);
  }
  return ok({ started });
}
