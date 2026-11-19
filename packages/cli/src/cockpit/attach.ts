/**
 * Bringing a unit's live run in front of a person: the pane its runner opened, through the launcher,
 * which knows each run's runner and whether this machine launched it. Presentation only: nothing is
 * recorded, and a unit with nothing to attach to is refused `nothing_to_attach` with what to do instead.
 */
import { liveStepOf, type RuntimeEnv } from "@norn/runtime";
import { refuse } from "../output.ts";
import type { ProjectView, UnitView } from "../views.ts";

export const NOTHING_TO_ATTACH = "nothing_to_attach";

/** The unit an agent waits on the person in for longest: a question or prompt in its pane, or an attended run. */
export function nextToAttach(view: ProjectView): UnitView | null {
  const waiting = view.stories.flatMap((s) => s.units).filter((u) => u.run && u.ended === undefined && (u.waiting?.for === "answer" || u.waiting?.for === "permission" || (!u.waiting && u.run.attended)));
  return waiting.sort((a, b) => (a.run?.started_at ?? "").localeCompare(b.run?.started_at ?? ""))[0] ?? null;
}

/** Focus the pane of `unit`'s live run; `instead` is what resolves the unit when it has no run. */
export async function attachUnit(env: RuntimeEnv, unit: string, instead?: string): Promise<{ unit: string; run: string; focused: true }> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) throw refuse(`${unit}: its record could not be read: ${read.failure.message}`, "norn doctor", NOTHING_TO_ATTACH);
  const live = liveStepOf(read.value.state, read.value.unapplied);
  const story = unit.split("/")[0] as string;
  if (!live?.run.session) throw refuse(`${unit} has no live run`, instead ?? "norn status", NOTHING_TO_ATTACH);
  if (!env.launcher.focus) throw refuse(`${unit}: this launcher brings no pane in front`, `norn story view ${story}`, NOTHING_TO_ATTACH);
  const focused = await env.launcher.focus(live.run.session);
  if (!focused.ok) throw refuse(focused.failure.message, `norn story view ${story}`, NOTHING_TO_ATTACH);
  if (!focused.value) throw refuse(`${unit} run ${live.run.id}: its pane is gone`, `norn story view ${story}`, NOTHING_TO_ATTACH);
  return { unit, run: live.run.id, focused: true };
}
