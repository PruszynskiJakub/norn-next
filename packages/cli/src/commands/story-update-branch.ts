/**
 * `norn story update-branch <key> [--reason <text>]`: bring the branch of a story whose round ended
 * up to date with its base while its change is still open: the base is merged in with the vcs slot
 * (never a rebase) and the branch pushed. A round under way updates its branch through its own
 * update steps, so only a story with every unit ended is updated here.
 *
 * A person's one-off effect, like `norn story take`: done under the story's claim (taken when free,
 * given up again when done) and this machine's tick lock, so neither another machine nor a tick here
 * finishes the story, and removes its worktree, mid-merge. What the update will do is worked out by
 * reads and trial merges first, so a conflict found then is refused with nothing changed or written.
 * The effect then follows the journal's act protocol on the story's own unit: the `branch.update`
 * intent before the first merge, `branch.updated` after the push, both records the kernel applies as
 * no-ops. An intent left without its outcome is an update cut short, and the next run finishes it
 * under that intent rather than reading a branch that already holds its base as nothing to update.
 */
import { outcomeReceiptId, type ReceiptDataOf, type UnitJournal } from "@norn/kernel";
import { type ChangeRequest, fail, ok, parseUnitId, RUN_ENV, type Vcs } from "@norn/plugin-api";
import { ulid } from "@norn/schema";
import { acquireTickLock, baseRefOf, branchOf, ensureWorktree, newTickId, type RuntimeEnv, type TickLock } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { busyError, corruptError, failure, refuse, rendered } from "../output.ts";
import { syncStore, unitsOf } from "./person-support.ts";

const USAGE = "norn story update-branch <key> [--reason <text>]";

const NEW_WORK = 'norn story create "<title>" for the new work';

/** What the update did: the commits it went between and whether the remote has the result. */
export interface BranchUpdate {
  base: string;
  base_sha: string;
  merged: boolean;
  from: string;
  head: string;
  took?: string;
  pushed: boolean;
}

type UpdateIntent = { id: string; data: ReceiptDataOf<"branch.update"> };

/**
 * An update an earlier try cut short: the story's newest `branch.update` with no outcome on the record.
 * One a round started after is that round's past, never finished here.
 */
function cutShort(units: readonly UnitJournal[], key: string): UpdateIntent | null {
  const own = units.find((u) => u.unit === key);
  for (const r of [...(own?.receipts ?? [])].reverse()) {
    if (r.data.kind === "round.started") return null;
    if (r.data.kind === "branch.update") return own?.receipts.some((x) => x.id === outcomeReceiptId(r.id)) ? null : { id: r.id, data: r.data };
  }
  return null;
}

/** Only a story whose every unit ended, with nothing waiting on its record but an update of its own cut short, is updated here. */
function refuseUnfinished(units: readonly UnitJournal[], key: string): void {
  const bad = units.find((u) => u.corrupt !== undefined);
  if (bad) throw corruptError(`${bad.unit} is corrupt: ${bad.corrupt}`, `a person repairs the record of ${bad.unit}`, { unit: bad.unit });
  const own = units.find((u) => u.unit === key);
  if (!own?.state) throw refuse(`${key} has not started its first round yet`, "norn tick starts it", "not_started");
  const going = units.filter((u) => u.state !== null && u.state.ended === undefined);
  if (going.length)
    throw refuse(
      `${key}'s ${own.state.workflow.name} round is under way (${going.map((u) => `${u.unit} at ${u.state?.step}`).join(", ")}); its own update steps bring the branch up to date`,
      `let the round update it, or norn story round ${key} --workflow <name> --force for a new round`,
      "round_unfinished",
      { units: going.map((u) => u.unit) },
    );
  const resumed = cutShort(units, key)?.id;
  const pending = units.filter((u) => u.unapplied.some((r) => r.id !== resumed));
  if (pending.length)
    throw refuse(`${pending.map((u) => u.unit).join(", ")} have receipts the next tick applies first`, `norn tick, then norn story update-branch ${key} again`, "pending", {
      units: pending.map((u) => u.unit),
    });
}

/** The story's change, which must be open: a merged one landed already, and a closed one has nothing to update. */
async function openChange(env: RuntimeEnv, key: string): Promise<ChangeRequest> {
  const branch = branchOf(key);
  const found = await env.slots.forge.findChanges([branch]);
  if (!found.ok) throw failure(`cannot read the change of ${key}: ${found.failure.message}`, "try again", found.failure.code);
  const change = found.value[branch];
  const at = change?.url ? ` (${change.url})` : "";
  if (!change) throw refuse(`${key} has no change open for ${branch}; there is nothing to update`, `norn story round ${key} --workflow <name>, for a round that opens one`, "no_change");
  if (change.state === "merged") throw refuse(`the change of ${key}${at} merged; its branch is done with`, NEW_WORK, "change_merged");
  if (change.state === "closed") throw refuse(`the change of ${key}${at} is closed`, `reopen it on the forge, or ${NEW_WORK}`, "change_closed");
  return change;
}

/** The round that resolves the conflict: the story's workflow at the step it declares for base updates, else any loaded workflow that declares one. */
function resolverRound(env: RuntimeEnv, key: string, pinned: string): string {
  const step = (name: string): string | undefined => {
    const load = env.workflows[name];
    return load?.ok ? load.workflow.graph.base?.step : undefined;
  };
  const name = step(pinned) ? pinned : Object.keys(env.workflows).sort().find((n) => step(n));
  if (!name) return `norn story round ${key} --workflow <name>, on a workflow whose update step resolves conflicts (the norn-merge skill)`;
  return `norn story round ${key} --workflow ${name} --at ${step(name)}, whose update step resolves the conflict (the norn-merge skill)`;
}

async function headOf(vcs: Vcs, ref: string, what: string): Promise<string> {
  const got = await vcs.head(ref);
  if (!got.ok) throw failure(`cannot read ${what} (${ref}): ${got.failure.message}`, "try again", got.failure.code);
  if (got.value === null) throw failure(`${what} (${ref}) names no commit`, "check the base and base_ref config, then try again", "not_found");
  return got.value;
}

async function contains(vcs: Vcs, commit: string, ref: string): Promise<boolean> {
  const got = await vcs.isAncestor(commit, ref);
  if (!got.ok) throw failure(`cannot tell whether ${ref} holds ${commit}: ${got.failure.message}`, "try again", got.failure.code);
  return got.value;
}

/**
 * Merge `from` into the branch, aborting on a conflict. A vcs that can try a merge first is asked
 * before anything moves, so a vcs that ignored the abort would still never be left mid-merge.
 */
async function mergeOrRefuse(vcs: Vcs, branch: string, from: string, onConflict: (files: string[]) => never): Promise<void> {
  await trial(vcs, branch, from, onConflict);
  const merged = await vcs.merge(branch, from, { abortOnConflict: true });
  if (!merged.ok) throw failure(`cannot merge ${from} into ${branch}: ${merged.failure.message}`, "look at the story's worktree, then try again", merged.failure.code);
  if ("conflict" in merged.value) onConflict(merged.value.conflict.files);
}

/**
 * What the update will do, from reads and trial merges alone: null when the branch holds its base and
 * is at its change's head. A conflict a trial finds is refused here, before the intent is written.
 */
async function planUpdate(env: RuntimeEnv, key: string, change: ChangeRequest, pinned: string, reason: string | undefined): Promise<UpdateIntent | null> {
  const vcs = env.slots.vcs;
  const branch = branchOf(key);
  const from = await headOf(vcs, branch, `the branch of ${key}`);
  // a head the clone lacks reads as no commit, never as a failure: there is nothing of it to take in
  const known = await vcs.head(change.head_sha);
  const changeHead = known.ok && known.value !== null ? change.head_sha : null;
  // commits on the change this branch lacks (a person's push, another machine's) come in first, or the push would be refused
  const took = changeHead && !(await contains(vcs, changeHead, branch)) ? changeHead : undefined;
  const base = await baseRefOf(env);
  const baseSha = await headOf(vcs, base, "the base");
  const merge = !(await contains(vcs, baseSha, branch));
  if (!merge && took === undefined && from === change.head_sha) return null;
  if (vcs.conflicts) {
    if (took !== undefined) await trial(vcs, branch, took, (files) => changeConflict(branch, took, files));
    if (merge) await trial(vcs, branch, baseSha, (files) => baseConflict(env, key, pinned, base, baseSha, files, null));
  }
  const data = { kind: "branch.update" as const, base, base_sha: baseSha, from, ...(took !== undefined && { took }), merge, by: env.config.holder, ...(reason && { reason }) };
  // a fresh id: a try cut short is found again by its kind and missing outcome, not by its id
  return { id: ulid(Date.parse(env.ctx.now())), data };
}

async function trial(vcs: Vcs, branch: string, from: string, onConflict: (files: string[]) => never): Promise<void> {
  const got = await vcs.conflicts?.(branch, from);
  if (!got) return;
  if (!got.ok) throw failure(`cannot try merging ${from} into ${branch}: ${got.failure.message}`, "try again", got.failure.code);
  if (got.value.length) onConflict(got.value);
}

function changeConflict(branch: string, changeHead: string, files: string[]): never {
  throw refuse(`${branch} and its change's head ${changeHead.slice(0, 12)} conflict in ${files.join(", ") || "?"}; nothing was changed`, "a person merges the change's head into the branch by hand", "change_conflict", {
    files,
    change_head: changeHead,
  });
}

/** `kept` is the branch's head when the update had already moved it, by taking in the change's head first. */
function baseConflict(env: RuntimeEnv, key: string, pinned: string, base: string, baseSha: string, files: string[], kept: { head: string; from: string } | null): never {
  const branch = branchOf(key);
  const left = kept
    ? `the merge was aborted, but ${branch} keeps what it took in before the base (it moved from ${kept.from.slice(0, 12)} to ${kept.head.slice(0, 12)}), unpushed`
    : "the merge was aborted and the branch left as it was";
  throw refuse(`merging ${base} (${baseSha.slice(0, 12)}) into ${branch} conflicts in ${files.join(", ") || "?"}; ${left}`, resolverRound(env, key, pinned), "conflict", {
    files,
    base,
    base_sha: baseSha,
    ...(kept && { moved_to: kept.head }),
  });
}

/** The effect, under the claim, the lock and the intent: the change's head taken in when the branch lacks it, the base merged, the result pushed. */
async function perform(env: RuntimeEnv, key: string, plan: ReceiptDataOf<"branch.update">, pinned: string): Promise<BranchUpdate> {
  const vcs = env.slots.vcs;
  const branch = branchOf(key);
  const took = plan.took;
  if (took !== undefined && !(await contains(vcs, took, branch))) await mergeOrRefuse(vcs, branch, took, (files) => changeConflict(branch, took, files));
  if (!(await contains(vcs, plan.base_sha, branch))) {
    const before = await headOf(vcs, branch, `the branch of ${key}`);
    const kept = before === plan.from ? null : { head: before, from: plan.from };
    await mergeOrRefuse(vcs, branch, plan.base_sha, (files) => baseConflict(env, key, pinned, plan.base, plan.base_sha, files, kept));
  }
  const head = await headOf(vcs, branch, `the branch of ${key}`);
  let pushed = false;
  if (vcs.capabilities.push) {
    const p = await vcs.push(branch);
    if (!p.ok) throw failure(`merged into ${branch} but could not push it: ${p.failure.message}`, `norn story update-branch ${key} again`, p.failure.code);
    pushed = true;
  }
  return { base: plan.base, base_sha: plan.base_sha, merged: plan.merge, from: plan.from, head, ...(took !== undefined && { took }), pushed };
}

/**
 * The update through the act protocol: the intent on the record before the first merge, the outcome
 * after the push. A refusal inside the effect is handed on as it was raised, the intent left for the
 * next run to finish.
 */
async function act(env: RuntimeEnv, key: string, intent: UpdateIntent, pinned: string): Promise<BranchUpdate> {
  let raised: { error: unknown } | null = null;
  const acted = await env.journal.act<BranchUpdate>(key, {
    intent,
    perform: async () => {
      try {
        return ok(await perform(env, key, intent.data, pinned));
      } catch (error) {
        raised = { error };
        return fail("conflict", error instanceof Error ? error.message : String(error));
      }
    },
    outcome: (done) => ({ kind: "branch.updated", ...done, by: intent.data.by, ...(intent.data.reason && { reason: intent.data.reason }) }),
    next: () => null,
  });
  if (raised) throw (raised as { error: unknown }).error;
  // the branch may be updated already; what is missing is its record, which a run again finishes under the same intent
  if (!acted.ok) throw failure(`could not record the update of ${branchOf(key)}: ${acted.failure.message}`, `norn story update-branch ${key} again`, acted.failure.code);
  if (acted.value.value === null) throw failure(`the update of ${branchOf(key)} is on the record already`, `norn story view ${key}`, "conflict");
  return acted.value.value;
}

/** Whether the unit's worktree is there now, so one made only for the update is removed again when the update is refused. */
async function hasWorktree(env: RuntimeEnv, key: string): Promise<boolean> {
  const path = env.slots.vcs.worktree.path(key);
  const cut = path.lastIndexOf("/");
  return (await env.ctx.files.list(path.slice(0, cut))).includes(path.slice(cut + 1));
}

/** Take this machine's claim on the story for the update: true when it took a free one, false when it already held it. */
async function claimFor(env: RuntimeEnv, key: string): Promise<boolean> {
  const claims = env.slots.store.claims;
  const holder = env.config.holder;
  const read = await claims.read(key);
  if (!read.ok) throw failure(`cannot read the claim of ${key}: ${read.failure.message}`, "try again", read.failure.code);
  const held = read.value;
  if (held?.holder === holder) return false;
  if (held && Date.parse(env.ctx.now()) < Date.parse(held.expires_at))
    throw refuse(`${key} is held by ${held.holder} until ${held.expires_at}`, `update it on the machine of ${held.holder}, or norn story take ${key} --force first`, "claim_held", {
      holder: held.holder,
      expires_at: held.expires_at,
    });
  if (held)
    throw refuse(`the claim of ${held.holder} on ${key} expired at ${held.expires_at}`, `norn story take ${key} --force, once ${held.holder} no longer acts on it`, "claim_held", {
      holder: held.holder,
      expires_at: held.expires_at,
      expired: true,
    });
  const took = await claims.acquire(key, holder, env.config.kernel.claimTtlMs, null);
  if (!took.ok) {
    if (took.failure.code === "conflict") throw refuse(`the claim of ${key} was taken while updating it: ${took.failure.message}`, `norn story update-branch ${key} again`, "claim_moved");
    throw failure(`cannot take the claim of ${key}: ${took.failure.message}`, "try again", took.failure.code);
  }
  return true;
}

export const storyUpdateBranchCommand = defineCommand({
  name: "story update-branch",
  summary: "Merge the base into a finished story's branch and push it, for its open change",
  usage: USAGE,
  options: { reason: { type: "string" } },
  optionHelp: { "--reason <text>": "why, kept on the record" },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const reason = opt.str(args, "reason")?.trim() || undefined;
    // a step agent's branch is its round's to update, through the workflow's update steps
    if (ctx.env[RUN_ENV.run]) throw refuse(`a step agent may not update a story's branch (run ${ctx.env[RUN_ENV.run]})`, "a person runs it, outside any norn run", "agent_update");
    const ref = parseUnitId(key);
    if (!ref) throw refuse(`${key} is not a story key`, "norn story list", "unknown_story");
    if (ref.slice !== null) throw refuse(`a branch update is a story's, not a slice's (${key})`, `norn story update-branch ${ref.story}`, "not_a_story");
    const env = await ctx.runtimeEnv();
    const vcs = env.slots.vcs;
    if (!vcs.capabilities.merge || !vcs.capabilities.worktrees)
      throw refuse(`vcs ${vcs.name} cannot merge into a story's own worktree`, "update the branch by hand", "vcs_unsupported");
    await syncStore(env, key, `norn story update-branch ${key}`);
    const units = await unitsOf(env, key);
    refuseUnfinished(units, key);
    const pinned = units.find((u) => u.unit === key)?.state?.workflow.name ?? "story";
    const change = await openChange(env, key);

    const lock: TickLock | null = await acquireTickLock(env.ctx, newTickId(env.ctx.now()), env.config.lockStaleMs);
    if (!lock) throw busyError(`a tick is running in this repo`, `norn story update-branch ${key} again once it ends`, "tick_running");
    const problems: string[] = [];
    let took = false;
    let recorded = false;
    let outcome: { done: BranchUpdate; intent: UpdateIntent; resumed: boolean } | null = null;
    try {
      took = await claimFor(env, key);
      let current = units;
      // what the last holder flushed is fetched before this machine reads the record again or writes beside it
      if (took) {
        await syncStore(env, key, `norn story update-branch ${key}`);
        current = await unitsOf(env, key);
        refuseUnfinished(current, key);
      }
      const existed = await hasWorktree(env, key);
      try {
        const made = await ensureWorktree(env, key);
        if (!made.ok) throw failure(`cannot make the worktree of ${key}: ${made.failure.message}`, "try again", made.failure.code);
        if (vcs.capabilities.push) {
          const fetched = await vcs.fetch();
          if (!fetched.ok) throw failure(`cannot fetch: ${fetched.failure.message}`, `norn story update-branch ${key} again once the remote is reachable`, fetched.failure.code);
        }
        const resumed = cutShort(current, key);
        const intent = resumed ?? (await planUpdate(env, key, change, pinned, reason));
        if (intent) {
          recorded = true;
          outcome = { done: await act(env, key, intent, pinned), intent, resumed: resumed !== null };
        }
      } catch (e) {
        // a worktree made only for an update that did not go through has no round left to remove it
        if (!existed) {
          const removed = await vcs.worktree.remove(key);
          if (!removed.ok) problems.push(`could not remove the worktree of ${key} again: ${removed.failure.message}`);
        }
        throw e;
      }
    } finally {
      // what went on the record is published while the claim is still this machine's: only the holder writes a story's run data
      const store = env.slots.store;
      if (recorded && store.capabilities.shared && store.flush) {
        const flushed = await store.flush(key);
        if (!flushed.ok) problems.push(`the record of the update of ${key} waits for the next flush: ${flushed.failure.message}`);
      }
      if (took) {
        const released = await env.slots.store.claims.release(key, env.config.holder);
        if (!released.ok) problems.push(`could not give up the claim of ${key}: ${released.failure.message}`);
      }
      await lock.release();
    }
    const branch = branchOf(key);
    if (!outcome) {
      const value = { story: key, branch, updated: false, head: change.head_sha, claim_taken: took, problems };
      return rendered(value, `${branch} already holds its base and its change is at its head; nothing to update.`);
    }
    const { done, intent, resumed } = outcome;
    const value = { story: key, branch, updated: true, ...done, claim_taken: took, receipt_id: outcomeReceiptId(intent.id), replayed: false, resumed, problems };
    const what = done.merged ? `Merged ${done.base} (${done.base_sha.slice(0, 12)}) into ${branch}` : `${branch} already held ${done.base}`;
    const tookLine = done.took ? `, after taking in its change's head ${done.took.slice(0, 12)}` : "";
    const pushLine = done.pushed ? `; pushed ${done.head.slice(0, 12)}` : `; nothing pushed (vcs ${vcs.name} has no remote)`;
    const finished = resumed ? " This finished an update an earlier run cut short." : "";
    const notes = problems.length ? `\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "";
    return rendered(value, `${what}${tookLine}${pushLine}.${finished} The next tick applies the record; for a story that ended done it removes the worktree again.${notes}`);
  },
});
