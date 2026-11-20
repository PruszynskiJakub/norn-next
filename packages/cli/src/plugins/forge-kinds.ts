/**
 * Which await steps of the loaded workflows wait on ci kinds the configured forge never reports: a
 * forge whose `checks` capability is false reports `ci.none` at once and never a pending, passed or
 * failed CI. One shared ship works on every forge, so this is a warning for doctor, never a refusal;
 * it still tells a person about routes that can never fire. `change.*` kinds are not warned: no
 * capability tells whether a forge reports them.
 */
import type { RuntimeEnv } from "@norn/runtime";

const NEVER_WITHOUT_CHECKS: readonly string[] = ["ci.pending", "ci.passed", "ci.failed"];

export function forgeKindsWarning(env: RuntimeEnv): string | null {
  const forge = env.slots.forge;
  if (forge.capabilities.checks) return null;
  const steps: string[] = [];
  for (const [name, load] of Object.entries(env.workflows).sort(([a], [b]) => a.localeCompare(b))) {
    if (!load.ok) continue;
    for (const step of Object.values(load.workflow.graph.steps)) {
      const never = (step.await?.on ?? []).filter((k) => NEVER_WITHOUT_CHECKS.includes(k));
      if (never.length > 0) steps.push(`${name} step ${step.name} (${never.join(", ")})`);
    }
  }
  if (steps.length === 0) return null;
  return `forge ${forge.name} reports no checks, so these await steps never see the ci kinds they wait on: ${steps.join(", ")}; each takes ci.none at once`;
}
