/**
 * The cap on turn ends a run's Stop hooks refuse. The traced count of refusals is read before a
 * hook appends its own line, so two hooks firing together could both read one below the cap and
 * both refuse; an exclusive create per refusal is what makes the cap hold across processes.
 */
import { createExclusive } from "./fsx.ts";
import { stopBlockPath } from "./paths.ts";

/**
 * Take one of a run's `max` turn-end refusals; true when this caller now holds one.
 * Each refusal is a file created exclusively under its own index below `max`, so concurrent hooks
 * can never refuse more than `max` turn ends between them, whatever count they read.
 * Taking starts at `from`, the refusals already traced: a run that refused turn ends before these
 * files existed keeps those counted, since `from` never reads lower than them. A caller that takes
 * one and dies before tracing it leaves the run with fewer refusals, never more.
 */
export function claimStopBlock(root: string, runId: string, from: number, max: number): boolean {
  for (let i = Math.max(0, from); i < max; i++) if (createExclusive(stopBlockPath(root, runId, i), `${runId}\n`)) return true;
  return false;
}
