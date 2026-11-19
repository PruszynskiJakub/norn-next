/**
 * Story-wide decisions: taking a new item in, the story's claim, its mailbox, publishing a shared
 * store and tidying an ended story. None of them commits a unit's state; each is safe to carry out again, because the store's
 * claims compare versions and its receipts and messages are idempotent by id.
 */
import { type DecisionOf, validateMailboxLetter } from "@norn/kernel";
import { fail, ok, type PluginResult, parseStoryKey } from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { dropUnitBranch } from "./branch-cleanup.ts";
import { ensureWorktree } from "./branches.ts";
import type { TickContext } from "./env.ts";
import { mirrorSpec } from "./inputs.ts";
import { removeUnitLogs } from "./retention.ts";

/**
 * Ids the host derives for receipts no decision carries, offset past any decide can mint from the
 * same tick id, so the two never collide.
 */
const HOST_ID_OFFSET = 1_000_000;

/**
 * A new story: its worktree, its spec mirrored from the item, then a `round.started` receipt pinning the workflow decide chose, which
 * makes the story a unit of the store. The claim and the first run state follow from decide: the
 * round starts once this machine holds the claim, so a story is never in progress unclaimed.
 */
export async function intakeStory(t: TickContext, d: DecisionOf<"intake_story">, index: number): Promise<PluginResult<unknown>> {
  const { env } = t;
  const unit = d.item.key;
  const load = t.workflows.byName[d.workflow];
  if (!load?.ok) return fail("invalid", `workflow ${d.workflow} does not load`, false);
  const existing = await env.slots.store.readUnit(unit);
  if (!existing.ok) return existing;
  if (existing.value.receipts.length > 0 || existing.value.state !== null) return ok({ already: true });
  // With claims a remote decides, every machine sees the same new item and would write its own first
  // receipt, leaving each a copy of the story the others' never merges with; the claim comes first
  // there, so only its holder makes the story a unit. A local claim has no rival to race.
  if (env.slots.store.capabilities.claims === "distributed") {
    const claimed = await env.slots.store.claims.acquire(unit, env.config.holder, env.config.kernel.claimTtlMs);
    if (!claimed.ok) return claimed.failure.code === "conflict" ? ok({ held_elsewhere: true }) : claimed;
  }
  const worktree = await ensureWorktree(env, unit);
  if (!worktree.ok) return worktree;
  // the spec first: once the round is recorded the story is a unit whose first agent reads it
  const spec = await mirrorSpec(env, unit, d.item);
  if (!spec.ok) return spec;
  const wrote = await env.journal.record(unit, { id: deriveUlid(t.tickId, HOST_ID_OFFSET + index), data: { kind: "round.started", workflow: structuredClone(load.workflow.pinned) } });
  if (!wrote.ok) return wrote;
  return ok({ worktree: worktree.value, seq: wrote.value.seq });
}

export async function claim(t: TickContext, d: DecisionOf<"claim">): Promise<PluginResult<unknown>> {
  const { env } = t;
  return env.slots.store.claims.acquire(d.story, env.config.holder, env.config.kernel.claimTtlMs, d.expect_version);
}

export async function renewClaim(t: TickContext, d: DecisionOf<"renew_claim">): Promise<PluginResult<unknown>> {
  const { env } = t;
  return env.slots.store.claims.renew(d.story, env.config.holder, env.config.kernel.claimTtlMs);
}

export async function releaseClaim(t: TickContext, d: DecisionOf<"release_claim">): Promise<PluginResult<unknown>> {
  const { env } = t;
  return env.slots.store.claims.release(d.story, env.config.holder);
}

/**
 * Letters become receipts of the unit they name, each under its message id, so importing again after
 * a crash before the acknowledgement writes nothing twice. A refused letter is only acknowledged:
 * it names no unit whose record could hold the refusal, and the trace keeps it.
 */
export async function importMailbox(t: TickContext, d: DecisionOf<"import_mailbox">): Promise<PluginResult<unknown>> {
  const { env } = t;
  const mailbox = env.slots.store.mailbox;
  if (!mailbox) return fail("invalid", `store ${env.slots.store.name} has no mailbox`, false);
  const imported: string[] = [];
  if (d.rule === "mailbox.import") {
    const got = await mailbox.receive(d.story);
    if (!got.ok) return got;
    for (const m of got.value) {
      if (!d.ids.includes(m.id)) continue;
      const letter = validateMailboxLetter(m.data);
      if (!letter.ok) continue;
      const wrote = await env.journal.record(letter.value.unit, { id: m.id, data: letter.value.receipt });
      if (!wrote.ok) return wrote;
      imported.push(m.id);
    }
  }
  const acked = await mailbox.ack(d.story, d.ids);
  if (!acked.ok) return acked;
  return ok({ imported, acknowledged: d.ids });
}

export async function flush(t: TickContext, d: DecisionOf<"flush">): Promise<PluginResult<unknown>> {
  const store = t.env.slots.store;
  if (!store.flush) return ok({ pushed: false });
  return store.flush(d.story);
}

/**
 * The item is closed first, the worktrees after, then their branches, and the units' logs last: a
 * closed item is what a person sees, and a worktree or branch left behind by a failure is only disk. Every
 * phase is idempotent (closing a closed item, removing a missing worktree or branch), so a failure is carried out again whole next tick under that
 * tick's id; the tick keeps the claim until it succeeds.
 */
export async function finishStory(t: TickContext, d: DecisionOf<"finish_story">): Promise<PluginResult<unknown>> {
  const { env } = t;
  let closed = false;
  if (d.close_item) {
    const tracker = env.slots.tracker;
    const key = parseStoryKey(d.story, tracker.keyPrefix);
    if (!key) return fail("invalid", `${d.story} is not a key of tracker ${tracker.name}`, false);
    const done = await tracker.perform({ kind: "close", id: key.id }, { receipt_id: d.effect_id });
    if (!done.ok) return done;
    closed = true;
  }
  const removed: string[] = [];
  if (env.slots.vcs.capabilities.worktrees) {
    for (const unit of d.worktrees) {
      const gone = await env.slots.vcs.worktree.remove(unit);
      if (!gone.ok) return gone;
      removed.push(unit);
    }
  }
  // slices before their story, whose branch is where an integrated slice's commits are found; a branch
  // that cannot go is reported and never fails the finish, which would keep the claim for it
  const branchesRemoved: string[] = [];
  const branchesKept: Array<{ branch: string; reason: string }> = [];
  if (env.slots.vcs.capabilities.worktrees) {
    for (const unit of [...d.worktrees].sort((a, b) => Number(a === d.story) - Number(b === d.story))) {
      const fate = await dropUnitBranch(env, unit);
      if (!fate.ok) t.problems?.push(`${unit}: branch: ${fate.failure.message}`);
      else if (fate.value?.deleted) branchesRemoved.push(fate.value.branch);
      else if (fate.value) branchesKept.push({ branch: fate.value.branch, reason: fate.value.reason });
    }
  }
  // the logs last, once no worktree is left whose agent could still write them; a log left behind is
  // only disk, so it is reported and never fails the finish, which would keep the claim for it
  let logs = 0;
  for (const unit of d.worktrees) {
    const gone = await removeUnitLogs(env, unit);
    logs += gone.removed;
    t.problems?.push(...gone.problems);
  }
  return ok({ closed, removed, branches_removed: branchesRemoved, branches_kept: branchesKept, logs_removed: logs });
}
