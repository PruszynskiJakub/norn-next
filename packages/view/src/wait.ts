/**
 * `norn story wait <story|slice> --until <condition>` (gh-175, P8): what a supervisor waits for, and
 * whether the read model shows it. Pure: a ProjectView in, the unit's state and a verdict out (X1).
 *
 * Conditions: `step=<name>` (the unit's cursor is at that step), `gate` (parked at a gate), `ask`
 * (parked on a question), `stuck`, `done` (the round ended: `$done`), `merged` (the story PR merged,
 * or the story is done). On a story, `gate`, `ask` and `stuck` also hold when one of its slices is
 * so; `step=` and `done` look at the unit asked for only.
 */
import type { ParkKind, StoryStatus } from "@norn/schema";
import type { ProjectView, SliceView, StoryView, UnitView } from "./types.ts";

export type WaitCondition = { kind: "step"; step: string } | { kind: "gate" | "ask" | "stuck" | "done" | "merged" };

export const WAIT_CONDITIONS = ["step=<name>", "gate", "ask", "stuck", "done", "merged"] as const;

/** The condition as typed, or null when it is none of {@link WAIT_CONDITIONS}. */
export function parseWaitCondition(raw: string): WaitCondition | null {
  const s = raw.trim();
  const step = /^step=(\S+)$/.exec(s);
  if (step) return { kind: "step", step: step[1] as string };
  return s === "gate" || s === "ask" || s === "stuck" || s === "done" || s === "merged" ? { kind: s } : null;
}

export const formatWaitCondition = (c: WaitCondition): string => (c.kind === "step" ? `step=${c.step}` : c.kind);

/** One unit as `story wait` prints it. */
export interface WaitUnit {
  key: string;
  status: UnitView["status"];
  step: string | null;
  attempt: number | null;
  park: { kind: ParkKind; reason: string; since: string } | null;
  last_outcome: UnitView["last_outcome"];
  next: string | null;
}

/** The state `story wait` checks and prints (P8: data only). */
export interface WaitState {
  /** the key asked for (story or slice) */
  key: string;
  story: string;
  story_status: StoryStatus | null;
  pr_state: "draft" | "open" | "closed" | "merged" | null;
  pr_url: string | null;
  unit: WaitUnit;
  /** a story's slices; [] for a slice */
  slices: WaitUnit[];
}

const waitUnit = (u: UnitView): WaitUnit => ({ key: u.key, status: u.status, step: u.step, attempt: u.attempt, park: u.park, last_outcome: u.last_outcome, next: u.next });

/** The state of `key` (a story or slice key); null when the view has no such unit. */
export function waitState(view: ProjectView, key: string): WaitState | null {
  const storyKey = key.split("/")[0] as string;
  const story: StoryView | undefined = view.stories.find((s) => s.key === storyKey);
  if (!story) return null;
  const slice: SliceView | undefined = key === storyKey ? undefined : story.slices.find((s) => s.key === key);
  if (key !== storyKey && !slice) return null;
  const pr = story.pr;
  return {
    key,
    story: storyKey,
    story_status: story.story_status,
    pr_state: !pr ? null : pr.state === "open" && pr.is_draft ? "draft" : pr.state,
    pr_url: pr?.url ?? null,
    unit: waitUnit(slice ?? story),
    slices: slice ? [] : story.slices.map(waitUnit),
  };
}

const parkedAt = (u: WaitUnit, kind: ParkKind) => u.status === "parked" && u.park?.kind === kind;

/** The key of the unit that meets `c` in `s` (the unit itself or, on a story, a slice); null when none does. */
export function waitMet(s: WaitState, c: WaitCondition): string | null {
  const own = (test: (u: WaitUnit) => boolean) => (test(s.unit) ? s.unit.key : null);
  const any = (test: (u: WaitUnit) => boolean) => own(test) ?? s.slices.find(test)?.key ?? null;
  switch (c.kind) {
    case "step":
      return own((u) => u.step === c.step && u.status !== "not_started");
    case "gate":
      return any((u) => parkedAt(u, "gate"));
    case "ask":
      return any((u) => parkedAt(u, "ask"));
    case "stuck":
      return any((u) => u.status === "stuck");
    case "done":
      return own((u) => u.status === "done");
    case "merged":
      return s.pr_state === "merged" || s.story_status === "done" ? s.story : null;
  }
}
