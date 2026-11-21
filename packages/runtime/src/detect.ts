/**
 * Detection for an agent step that may not keep code (`code:read`, `code:scratch`): what its agent
 * could change is noted before it starts, as a receipt, so the check once it reports compares against
 * a record rather than a guess. A snapshot that cannot be taken is recorded as failed, which parks the
 * unit; the run never starts unwatched.
 */
import type { KernelReceipt, ReceiptIntent, RunSnapshot } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";

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
