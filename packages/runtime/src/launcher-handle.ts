/**
 * The handle a HarnessLauncher hands back from `start`, which the run's record keeps as its
 * session: the executor (to find its harness and runner again), the unit and run (to queue a hook
 * delivery when the runner has no pane), and the runner's own handle, opaque to everything here.
 * `<executor>|<unit>|<run_id>|<runner handle>`; the first three may not hold `|`, the runner's may.
 */
export interface LaunchHandle {
  executor: string;
  unit: string;
  run_id: string;
  runner: string;
}

const SEP = "|";

export function encodeLaunchHandle(h: LaunchHandle): string {
  for (const [field, v] of [
    ["executor", h.executor],
    ["unit", h.unit],
    ["run_id", h.run_id],
  ] as const)
    if (v === "" || v.includes(SEP)) throw new RangeError(`launch handle: ${field} ${JSON.stringify(v)} is empty or holds ${SEP}`);
  if (h.runner === "") throw new RangeError("launch handle: an empty runner handle");
  return [h.executor, h.unit, h.run_id, h.runner].join(SEP);
}

/** The handle's parts, or null for a string this launcher did not make (a handle from another host). */
export function decodeLaunchHandle(handle: string): LaunchHandle | null {
  const parts = handle.split(SEP);
  if (parts.length < 4) return null;
  const [executor, unit, run_id] = parts as [string, string, string];
  const runner = parts.slice(3).join(SEP);
  if (!executor || !unit || !run_id || !runner) return null;
  return { executor, unit, run_id, runner };
}
