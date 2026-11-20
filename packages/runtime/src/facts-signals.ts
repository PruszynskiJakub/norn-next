/**
 * The signals the forge gives a story waiting at an await step: the checks on its change's head as
 * `ci.*`, and the change's merge onto the story's base or its closing as `change.*`. Gathered only for
 * a story whose own unit waits at such a step, neither ended nor parked, so a story elsewhere costs
 * the forge no call; the change comes from the tick's one batched lookup, checks are asked once per
 * waiting story, and the failed checks only once the checks say failure.
 *
 * A forge that cannot answer leaves the story with no signals and the reason why: decide keeps the
 * step waiting, and an outage never reads as a red CI.
 */
import type { RunState, StoryFacts, WorkflowGraph } from "@norn/kernel";
import type { ChangeRequest } from "@norn/plugin-api";
import { CI_SIGNAL_KINDS, type Signal, type SignalKind } from "@norn/schema";
import type { RuntimeEnv } from "./env.ts";

export type SignalFacts = Pick<StoryFacts, "signals" | "signals_error">;

export async function signalFacts(
  env: RuntimeEnv,
  key: string,
  own: RunState | null,
  graph: WorkflowGraph | undefined,
  change: ChangeRequest | null,
  changesError: string | undefined,
  problems: string[],
): Promise<SignalFacts> {
  const spec = own && own.ended === undefined && own.parked === undefined ? graph?.steps[own.step]?.await : undefined;
  if (!spec) return {};
  // the lookup's own failure is already a problem of the tick
  if (changesError !== undefined) return { signals: [], signals_error: changesError };
  const at = env.ctx.now();
  const subject = change ? `change/${change.id}` : `branch/${key}`;
  const signal = (kind: SignalKind, data?: unknown): Signal => ({ source: "forge", kind, subject, at, ...(data !== undefined && { data }) });
  const signals: Signal[] = [];
  if (change?.state === "merged" && change.base_branch === env.config.base) signals.push(signal("change.merged"));
  if (change?.state === "closed") signals.push(signal("change.closed"));
  if (!spec.on.some((k) => (CI_SIGNAL_KINDS as readonly string[]).includes(k))) return { signals };

  const forge = env.slots.forge;
  if (!forge.capabilities.checks) return { signals: [...signals, signal("ci.none")] };
  if (change?.state !== "open") return { signals };
  const failed = (what: string, message: string): SignalFacts => {
    problems.push(`${key}: ${what}: ${message}`);
    return { signals: [], signals_error: `${what}: ${message}` };
  };
  const checks = await forge.checks(change.id);
  if (!checks.ok) return failed("forge checks", checks.failure.message);
  if (checks.value === "pending") return { signals: [...signals, signal("ci.pending")] };
  if (checks.value === "success") return { signals: [...signals, signal("ci.passed")] };
  if (checks.value === "none") return { signals: [...signals, signal("ci.none")] };
  const detail = forge.failures ? await forge.failures(change.id) : undefined;
  if (detail && !detail.ok) return failed("forge failures", detail.failure.message);
  return { signals: [...signals, signal("ci.failed", { failed: detail?.value ?? [] })] };
}
