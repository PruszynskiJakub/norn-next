/**
 * The unit a verb acts on (B54–B60). An explicit target wins (B56); without one, the unit of the
 * worktree the verb is typed in (B54); elsewhere a person at a terminal picks from the units the
 * verb applies to, in `norn status` order, the first preselected even when it is the only one (B57,
 * B58). No applicable unit is a refusal with the reason (B59); a script or an agent — `--json`, no
 * TTY, an agent session (D2) — is refused with the candidates and never prompted (B60).
 *
 * Each verb says which units it applies to (`applies`) and why none does (`none`); later verbs reuse this.
 */
import type { ProjectView, SliceView, StoryView } from "@norn/view";
import { inboxItemsInOrder, loadRunView, stepTitle } from "@norn/view";
import { cmd } from "@norn/core";
import type { Context } from "../context.ts";
import { refuse, usageError } from "../output.ts";
import { storyArg } from "./args.ts";
import { projectView } from "./human.ts";
import type { InteractionChoice } from "./interaction.ts";

export interface TargetRule {
  /** the verb as typed, e.g. `run view` */
  verb: string;
  /** whether the verb applies to this unit (its view, when this checkout shows it) */
  applies(key: string, unit: StoryView | SliceView | undefined): boolean;
  /** why no unit applies, e.g. `No unit has a run yet` */
  none: string;
  /** the verb on one unit, as printed (`cmd.runView`) */
  command(key: string): string;
  /** B55: a story-only verb — in a slice worktree it acts on the slice's story */
  story?: boolean;
  /** the units offered, when they are not in the read model (`story reopen`: closed stories); `applies` is then unused */
  candidates?: () => Promise<InteractionChoice[]>;
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

async function fromView(ctx: Context, rule: TargetRule): Promise<InteractionChoice[]> {
  const view = await projectView(ctx);
  const units = new Map<string, StoryView | SliceView>(view.stories.flatMap((s) => [[s.key, s] as const, ...s.slices.map((x) => [x.key, x] as const)]));
  return unitsInStatusOrder(view).filter((c) => rule.applies(c.value, units.get(c.value)));
}

/** The unit key the verb acts on, or a refusal. */
export async function targetKey(ctx: Context, explicit: string | undefined, json: boolean, rule: TargetRule): Promise<string> {
  if (explicit) return explicit;
  if (ctx.unit) return rule.story ? ctx.unit.story : (ctx.unit.slice ?? ctx.unit.story);
  const candidates = rule.candidates ? await rule.candidates() : await fromView(ctx, rule);
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

/** A verb that applies to units in some state (`run cancel`: running; `run rerun`: stuck or parked). */
export function inState(verb: string, command: (key: string) => string, none: string, ok: (u: StoryView | SliceView) => boolean): TargetRule {
  return { verb, command, none, applies: (_key, u) => !!u && ok(u) };
}

/** B55: a story verb (`story view`, `chat`, `checkout`, `handoff`, `close`) applies to every story, never to a slice. */
export function aStory(verb: string, command: (key: string) => string): TargetRule {
  return { verb, command, none: "No story yet", story: true, applies: (key) => !key.includes("/") };
}

/** B55: the story a team verb (`story checkout`, `handoff`, `close`) acts on; a slice key, or a slice worktree, means the slice's story. */
export async function resolveStory(ctx: Context, explicit: string | undefined, json: boolean, rule: TargetRule): Promise<string> {
  return storyArg(await targetKey(ctx, explicit, json, rule), rule.verb);
}

/** A unit parked on a question (`story answer`) or at a gate (`story approve`, `story reject`). */
export function parkedOn(kind: "ask" | "gate", verb: string, none: string, command: (key: string) => string): TargetRule {
  return { verb, command, none, applies: (_key, u) => u?.status === "parked" && u.park?.kind === kind };
}
