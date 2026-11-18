/**
 * What every decide rule reads, and the one source of ids in a tick. Ids are derived from the tick's
 * id in the order rules ask for them, so the same facts give the same decisions, ids included.
 */
import { deriveUlid } from "@norn/schema";
import type { Decision } from "../model/actions.ts";
import type { KernelConfig } from "../model/config.ts";
import type { KernelFacts } from "../model/facts.ts";
import type { KernelWorkflows } from "../workflow/graph.ts";

export interface DecideContext {
  readonly facts: KernelFacts;
  readonly workflows: KernelWorkflows;
  readonly config: KernelConfig;
  /** the next id of this tick (a run id, a receipt id) */
  nextId(): string;
}

export function decideContext(facts: KernelFacts, workflows: KernelWorkflows, config: KernelConfig): DecideContext {
  let i = 0;
  return { facts, workflows, config, nextId: () => deriveUlid(facts.tick_id, i++) };
}

/**
 * The decisions of one tick. A second action for a unit is a defect in decide's rules, not a case to
 * resolve by picking one, so it throws and the rule tests catch it.
 */
export class Decisions {
  private readonly list: Decision[] = [];
  private readonly taken = new Set<string>();

  has(unit: string): boolean {
    return this.taken.has(unit);
  }

  add(d: Decision): void {
    if (d.unit !== null) {
      if (this.taken.has(d.unit)) throw new Error(`decide: second action for ${d.unit} (${d.rule})`);
      this.taken.add(d.unit);
    }
    this.list.push(d);
  }

  all(): Decision[] {
    return [...this.list];
  }
}
