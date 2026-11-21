/**
 * Detection for an agent step that may not keep code (`code:read`, `code:scratch`): what its agent
 * could change is noted before it starts, as a receipt, so the check once it reports compares against
 * a record rather than a guess. A snapshot that cannot be taken is recorded as failed, which parks the
 * unit; the run never starts unwatched.
 */
import { type ChangesSeen, type DecisionOf, judgeChanges, type KernelReceipt, launchedRun, type ReceiptDataOf, type ReceiptIntent, type RunSnapshot } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { branchOf } from "./branches.ts";
import type { RuntimeEnv, TickContext } from "./env.ts";
import { RUN_DIR, specFolder, worktreeOf } from "./inputs.ts";
import { unitInFacts } from "./record.ts";
import { skillLinks } from "./skills.ts";

type ReceiptBodyOf<K extends "run.checked"> = Omit<ReceiptDataOf<K>, "step" | "attempt">;

/** The snapshot receipt's id under a launch's intent: derived, so a replayed launch finds it. */
export const snapshotReceiptId = (intentId: string): string => deriveUlid(intentId, 2);

/** The runs a run stands for: itself and every run it retried, back to the visit's first. */
function retryChain(receipts: readonly KernelReceipt[], runId: string): Set<string> {
  const chain = new Set<string>();
  let at: string | undefined = runId;
  while (at !== undefined && !chain.has(at)) {
    chain.add(at);
    const id: string = at;
    const start = receipts.find((r) => r.data.kind === "run.started" && r.data.run_id === id && r.data.retry_of !== undefined);
    at = start?.data.kind === "run.started" ? start.data.retry_of : undefined;
  }
  return chain;
}

/** The snapshot a run is checked against: the first one noted for it or a run it retried, or null. */
export function snapshotOf(receipts: readonly KernelReceipt[], runId: string): RunSnapshot | null {
  const chain = retryChain(receipts, runId);
  for (const r of receipts) if (r.data.kind === "run.snapshot" && chain.has(r.data.run_id) && r.data.snapshot) return r.data.snapshot;
  return null;
}

/** What an agent in `worktree` could change now, with the remote's copy of the unit's branch. */
export async function takeSnapshot(env: RuntimeEnv, unit: string, worktree: string): Promise<PluginResult<RunSnapshot>> {
  const vcs = env.slots.vcs;
  if (!vcs.snapshot) return fail("unavailable", `vcs ${vcs.name} cannot note what an agent changes, so a step that may not keep code cannot be checked`, false);
  const snap = await vcs.snapshot(worktree);
  if (!snap.ok) return snap;
  const remote = vcs.remoteHead ? await vcs.remoteHead(branchOf(unit)) : ok(null);
  if (!remote.ok) return remote;
  return ok({ ...snap.value, remote: remote.value });
}

/**
 * Note the snapshot of the run a launch starts under `intent`, before the agent starts: once per
 * visit, as a retry is checked against its visit's first. A failure is recorded and refuses the launch.
 */
export async function noteSnapshot(env: RuntimeEnv, unit: string, worktree: string, intent: ReceiptIntent): Promise<PluginResult<void>> {
  if (intent.data.kind !== "run.started") return ok(undefined);
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return read;
  if (snapshotOf(read.value.receipts, intent.data.run_id) !== null) return ok(undefined);
  const header = { step: intent.data.step, attempt: intent.data.attempt };
  const taken = await takeSnapshot(env, unit, worktree);
  const data = taken.ok
    ? { kind: "run.snapshot" as const, run_id: intent.data.run_id, ...header, snapshot: taken.value }
    : { kind: "run.snapshot" as const, run_id: intent.data.run_id, ...header, failed: taken.failure.message };
  const wrote = await env.journal.record(unit, { id: snapshotReceiptId(intent.id), data });
  if (!wrote.ok) return wrote;
  return taken.ok ? ok(undefined) : fail("invalid", `run ${intent.data.run_id} of ${unit} was not started: ${taken.failure.message}`, false);
}

/**
 * norn's own files in a unit's worktree, which no step's agent is held to: the run folder (inputs and
 * reports), the story's spec folder, which norn reads back itself, and what it installed for the
 * run's executor (its hooks, its skill links).
 */
export function ownedBy(env: RuntimeEnv, unit: string, executor: string): (path: string) => boolean {
  const folders = [`${RUN_DIR}/`, `${specFolder(unit)}/`];
  const harness = env.slots.executors[executor];
  const installed = new Set([...(harness?.localFiles ?? []), ...skillLinks(harness?.skillsDir, env.slots.pack.skills)]);
  return (p) => installed.has(p) || folders.some((f) => p.startsWith(f));
}

export type ChangesFound = Omit<ChangesSeen, "code" | "passes">;

/** What changed in `worktree` and the repo since `snap`, norn's own files left out. */
export async function changesSince(env: RuntimeEnv, unit: string, worktree: string, snap: RunSnapshot, executor: string): Promise<PluginResult<ChangesFound>> {
  const now = await takeSnapshot(env, unit, worktree);
  if (!now.ok) return now;
  const vcs = env.slots.vcs;
  if (!vcs.changedSince) return fail("unavailable", `vcs ${vcs.name} cannot name the paths an agent changed`, false);
  const changed = await vcs.changedSince(worktree, snap.tree);
  if (!changed.ok) return changed;
  const owned = ownedBy(env, unit, executor);
  return ok({
    changed: changed.value.filter((p) => !owned(p)),
    headMoved: now.value.head !== snap.head,
    remoteMoved: now.value.remote !== snap.remote,
    configChanged: now.value.config !== snap.config,
    hooksChanged: now.value.hooks !== snap.hooks,
    refsChanged: now.value.refs !== snap.refs,
  });
}

/** The run.checked a check records, judged from what changed, with the reset it performed. */
async function checked(env: RuntimeEnv, unit: string, d: DecisionOf<"check_run">, executor: string): Promise<ReceiptBodyOf<"run.checked">> {
  const failed = (why: string): ReceiptBodyOf<"run.checked"> => ({ kind: "run.checked", run_id: d.run_id, verdict: "failed", detail: why });
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return failed(`cannot read the unit's record: ${read.failure.message}`);
  const snap = snapshotOf(read.value.receipts, d.run_id);
  if (snap === null) return failed(`no snapshot of run ${d.run_id} is on the record`);
  const worktree = worktreeOf(env, unit);
  const seen = await changesSince(env, unit, worktree, snap, executor);
  if (!seen.ok) return failed(seen.failure.message);
  const judged = judgeChanges({ code: d.code, passes: d.passes, ...seen.value });
  const detail = [...judged.reasons, ...judged.notes].join("; ");
  const base = { kind: "run.checked" as const, run_id: d.run_id, ...(detail !== "" && { detail }) };
  if (judged.verdict !== "reset") return { ...base, verdict: judged.verdict };
  const vcs = env.slots.vcs;
  if (snap.head === null || !vcs.restore) return failed(`the change cannot be put back: ${snap.head === null ? "the checkout had no commit" : `vcs ${vcs.name} cannot restore a checkout`}`);
  const put = await vcs.restore(worktree, { head: snap.head, tree: snap.tree }, judged.reset);
  if (!put.ok) return failed(`the change could not be put back: ${put.failure.message}`);
  return { ...base, verdict: "reset", ...(judged.reset.length > 0 && { reset: judged.reset }), ...(judged.resetHead && { head: true }) };
}

/**
 * The check of a reported run that may not keep code, under its `run.checking` intent: the run's
 * processes are killed first, so nothing it left running lands after the comparison, then what changed
 * is judged and reset. Each part reads where the checkout is, so a check cut short runs again whole.
 */
export async function checkRun(t: TickContext, d: DecisionOf<"check_run">): Promise<PluginResult<unknown>> {
  const unit = d.unit;
  if (unit === null) return fail("invalid", `${d.rule}: a check without a unit`, false);
  const facts = unitInFacts(t.facts, unit);
  // the run decide checked, which may be a launch not yet applied
  const run = facts?.state ? launchedRun(facts.state, facts.receipts) : null;
  if (run?.id !== d.run_id) return fail("not_found", `run ${d.run_id} of ${unit} is not on the record`, false);
  const acted = await t.env.journal.act(unit, {
    intent: d.intent,
    perform: async (): Promise<PluginResult<ReceiptBodyOf<"run.checked">>> => {
      if (run.session) {
        const stopped = await t.env.launcher.stop(run.session);
        if (!stopped.ok) return ok({ kind: "run.checked", run_id: d.run_id, verdict: "failed", detail: `the run's processes could not be stopped first: ${stopped.failure.message}` });
      }
      return ok(await checked(t.env, unit, d, run.executor));
    },
    outcome: (v) => ({ ...v, ...headerOf(d.intent) }),
    next: () => null,
  });
  return acted.ok ? ok({ performed: acted.value.performed, verdict: acted.value.value?.verdict ?? null }) : acted;
}

function headerOf(intent: ReceiptIntent): { step?: string; attempt?: number } {
  const { step, attempt } = intent.data;
  return { ...(step !== undefined && { step }), ...(attempt !== undefined && { attempt }) };
}

/**
 * A digest of the agent's hook config in `worktree`, as the executor's harness reads it; null when it
 * reads none or cannot say, which leaves the run unpinned rather than refusing every report.
 */
export async function hookDigest(env: RuntimeEnv, executor: string, worktree: string): Promise<string | null> {
  const harness = env.slots.executors[executor];
  if (!harness?.hookConfig) return null;
  try {
    const text = await harness.hookConfig(worktree);
    return text === null ? null : new Bun.CryptoHasher("sha256").update(text).digest("hex");
  } catch {
    return null;
  }
}
