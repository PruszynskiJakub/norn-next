/**
 * Lease liveness for this CLI (K1, K3). Agent leases normally live while the agent process
 * (pid + start time) lives. A runner that reports no process (a Herdr pane) leaves the lease
 * held by the tick that launched it, which exits right away — so such a lease carries the run's
 * worktree as a marker and stays live while that unit's `state.json` still shows the same run
 * running. The cap then holds across ticks until the run ends (apply/classify release it).
 */
import { join } from "node:path";
import { type LeaseFile, STORY_UNIT_DIR } from "@norn/schema";
import { defaultLeaseLiveness, type LeaseLiveness, readState, readUnitMarker } from "@norn/store";
import type { ProcessIdentity } from "@norn/schema";

/** true while the unit run named by an agent lease is still `running` in its worktree. */
function leaseRunActive(lease: LeaseFile): boolean {
  if (lease.kind !== "agent" || !lease.worktree || !lease.run_id) return false;
  const m = readUnitMarker(lease.worktree).marker;
  if (!m || m.story !== lease.story || m.slice !== lease.slice) return false;
  const st = readState(join(lease.worktree, m.spec_dir, "runs", m.unit || STORY_UNIT_DIR));
  return st.ok && st.value.status === "running" && st.value.run?.run_id === lease.run_id;
}

export function leaseLiveness(isAlive: (p: ProcessIdentity) => Promise<boolean> | boolean): LeaseLiveness {
  const base = defaultLeaseLiveness(isAlive);
  return async (lease) => (await base(lease)) || leaseRunActive(lease);
}
