/**
 * decide: KernelFacts in, decisions out. Pure; the host performs each decision under the act
 * protocol, in the order given. Story rules run first because they can end or hold every unit of a
 * story (a merged change, a closed item, a claim not held here); unit rules then decide each unit
 * story rules left alone; a held story's flush and claim release come last, after everything it
 * wrote this tick. At most one action per unit per tick, and every decision names the rule that fired.
 */
import type { Decision } from "../model/actions.ts";
import type { KernelConfig } from "../model/config.ts";
import type { KernelFacts } from "../model/facts.ts";
import type { KernelWorkflows } from "../workflow/graph.ts";
import { decideContext, Decisions } from "./context.ts";
import { decideIntake, decideStory, decideStoryTail, storyFinishedHere } from "./story.ts";
import { decideUnit } from "./unit.ts";

export function decide(facts: KernelFacts, workflows: KernelWorkflows, config: KernelConfig): Decision[] {
  const ctx = decideContext(facts, workflows, config);
  const out = new Decisions();
  // facts come in queue order (the host sorts stories oldest first), so decisions come out in an order the facts fix
  for (const story of facts.stories) {
    for (const d of decideStory(story, ctx)) out.add(d);
    const finished = storyFinishedHere(story, ctx);
    for (const unit of finished ? [] : story.units) {
      if (out.has(unit.id)) continue;
      const d = decideUnit(story, unit, ctx);
      if (d) out.add(d);
    }
    for (const d of decideStoryTail(story, ctx)) out.add(d);
  }
  for (const d of decideIntake(facts.intake, ctx)) out.add(d);
  return out.all();
}
