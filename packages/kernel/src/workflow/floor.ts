/**
 * The floor a workflow stands on: every path to a step whose kind has an effect a person must stand
 * before (`KIND_EFFECTS`) passes a person's step that no policy grant delegates. Paths start where a
 * round can start without a person choosing the step: `start`, and the entry `norn story update-branch`
 * re-enters. A person who starts a round at a step (`--at`) has chosen to stand there themselves.
 */
import type { KindEffect } from "@norn/plugin-api";
import type { CompiledRoute, WorkflowError } from "./graph.ts";

export interface FloorStep {
  /** the head key the step runs: `gate` is a person's step */
  kind: string;
  /** what a workflow file names the step's actor (`forge.await-merge`) */
  actor: string;
  effects: readonly KindEffect[];
  routes: Readonly<Record<string, CompiledRoute>>;
}

const EFFECT_WORDS: Record<KindEffect, string> = { outward: "reaches outside the repo", cost: "spends money", "forge-write": "writes to the forge" };

const said = (effects: readonly KindEffect[]): string => {
  const words = effects.map((e) => EFFECT_WORDS[e]);
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
};

/**
 * `origins`: each place a round starts by itself, with how the refusal names it. `delegated`: the
 * gates a policy grant lets a stand-in decide, which are no person's step here. A refusal is marked
 * `granted` only when the workflow stands on the floor with nothing delegated: a shortest path may pass
 * a granted gate while another path skips every gate, and that file is broken whatever the policy says.
 */
export function floorErrors(steps: Readonly<Record<string, FloorStep>>, origins: ReadonlyArray<{ step: string; named: string }>, delegated: ReadonlySet<string>): WorkflowError[] {
  const errors = pathErrors(steps, origins, delegated);
  if (errors.length === 0 || delegated.size === 0 || pathErrors(steps, origins, new Set()).length === 0) return errors;
  return errors.map(({ granted: _, ...e }) => e);
}

function pathErrors(steps: Readonly<Record<string, FloorStep>>, origins: ReadonlyArray<{ step: string; named: string }>, delegated: ReadonlySet<string>): WorkflowError[] {
  const errors: WorkflowError[] = [];
  const refused = new Set<string>();
  const stands = (name: string): boolean => steps[name]?.kind === "gate" && !delegated.has(name);
  for (const origin of origins) {
    // breadth first, so the path a refusal shows is a shortest one
    const parent = new Map<string, string | null>([[origin.step, null]]);
    const queue = [origin.step];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      const step = steps[at];
      if (!step || stands(at)) continue;
      if (step.effects.length > 0 && !refused.has(at)) {
        refused.add(at);
        const path: string[] = [];
        for (let s: string | null | undefined = at; s; s = parent.get(s)) path.unshift(s);
        const granted = path.filter((s) => steps[s]?.kind === "gate" && delegated.has(s));
        const why = granted.length > 0 ? `; the policy grants ${granted.join(", ")} to a stand-in (policy.stand_in.gates)` : "";
        errors.push({
          ...(granted.length > 0 && { granted }),
          path: `/steps/${at}`,
          message: `step ${at} (${step.actor}) ${said(step.effects)}, and ${origin.named} reaches it through ${path.join(" → ")} with no \`by: person\` step on the way${why}: put a person's step no policy grant delegates on every path to it`,
        });
      }
      for (const { to } of Object.values(step.routes)) {
        if (to.startsWith("$") || parent.has(to)) continue;
        parent.set(to, at);
        queue.push(to);
      }
    }
  }
  return errors;
}
