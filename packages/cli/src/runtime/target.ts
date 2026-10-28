/**
 * The unit a verb acts on (B54–B60). An explicit target wins (B56); without one, the unit of the
 * worktree the verb is typed in (B54); elsewhere a person at a terminal picks from the units the
 * verb applies to, in `norn status` order, the first preselected even when it is the only one (B57,
 * B58). No applicable unit is a refusal with the reason (B59); a script or an agent — `--json`, no
 * TTY, an agent session (D2) — is refused with the candidates and never prompted (B60).
 *
 * Each verb says which units it applies to (`applies`) and why none does (`none`); later verbs reuse this.
 */
import type { ProjectView } from "@norn/view";
import { inboxItemsInOrder, loadRunView, stepTitle } from "@norn/view";
import { cmd } from "@norn/core";
import type { Context } from "../context.ts";
import { refuse, usageError } from "../output.ts";
import { projectView } from "./human.ts";
import type { InteractionChoice } from "./interaction.ts";

export interface TargetRule {
  /** the verb as typed, e.g. `run view` */
  verb: string;
  /** whether the verb applies to this unit */
  applies(key: string): boolean;
  /** why no unit applies, e.g. `No unit has a run yet` */
  none: string;
  /** the verb on one unit, as printed (`cmd.runView`) */
  command(key: string): string;
}

/** `norn status` order: what needs the person first (inbox order), then every story with its slices. */
function unitsInStatusOrder(view: ProjectView): InteractionChoice[] {
  const out = new Map<string, string>();
  for (const i of inboxItemsInOrder(view)) {
    const key = i.slice ?? i.story;
    if (!out.has(key)) out.set(key, `${key}  ${stepTitle(i.step, i.title)}`);
  }
  for (const s of view.stories)
    for (const u of [{ key: s.key, step: s.step, title: s.title }, ...s.slices.map((x) => ({ key: x.slice, step: x.step, title: x.title }))])
      if (!out.has(u.key)) out.set(u.key, `${u.key}  ${stepTitle(u.step, u.title)}`);
  return [...out].map(([value, label]) => ({ value, label }));
}

/** The unit key the verb acts on, or a refusal. */
export async function resolveTarget(ctx: Context, explicit: string | undefined, json: boolean, rule: TargetRule): Promise<string> {
  if (explicit) return explicit;
  if (ctx.unit) return ctx.unit.slice ?? ctx.unit.story;
  const candidates = unitsInStatusOrder(await projectView(ctx)).filter((c) => rule.applies(c.value));
  if (!candidates.length) throw refuse(rule.none, cmd.status(), "no_target");
  const terminal = ctx.terminal(json);
  if (!terminal)
    throw usageError(`norn ${rule.verb}: name the unit (no terminal to ask in)`, candidates.map((c) => rule.command(c.value)).join(" | "), "target_required");
  const picked = await terminal.pick(`norn ${rule.verb}: which unit?`, candidates, 0);
  if (!picked) throw refuse("Nothing picked", null, "cancelled");
  return picked;
}

/** The run verbs (`run view`, `run list`) apply to a unit that has a run. */
export function hasRun(ctx: Context, verb: string, command: (key: string) => string): TargetRule {
  return {
    verb,
    command: (key) => command(key),
    none: "No unit has a run yet",
    applies: (key) => loadRunView({ repoRoot: ctx.root, home: ctx.home, env: ctx.env, now: ctx.clock.now(), target: key }) !== null,
  };
}
