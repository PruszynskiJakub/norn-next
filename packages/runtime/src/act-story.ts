/**
 * Story-wide decisions: taking a new item in, the story's claim, its mailbox and publishing a shared
 * store. None of them commits a unit's state; each is safe to carry out again, because the store's
 * claims compare versions and its receipts and messages are idempotent by id.
 */
import { type DecisionOf, validateMailboxLetter } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { ensureWorktree } from "./branches.ts";
import type { TickContext } from "./env.ts";

/**
 * Ids the host derives for receipts no decision carries, offset past any decide can mint from the
 * same tick id, so the two never collide.
 */
const HOST_ID_OFFSET = 1_000_000;

/**
 * A new story: its worktree, then a `round.started` receipt pinning the workflow decide chose, which
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
