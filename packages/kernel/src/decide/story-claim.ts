/**
 * Whether a story still needs a holder, holding its units while a claim is not this machine's, and
 * importing its mailbox. Read from norn's own record only: a tracker's labels or a forge's title
 * never say whether a story is open.
 */
import type { Decision } from "../model/actions.ts";
import type { StoryFacts, UnitFacts } from "../model/facts.ts";
import type { RunState } from "../model/run-state.ts";
import { validateMailboxLetter } from "../model/validate.ts";
import type { DecideContext } from "./context.ts";

/** The story's own unit first, whether or not it has a record yet, then the others in facts order. */
export function unitIds(story: StoryFacts): string[] {
  return [story.key, ...story.units.map((u) => u.id).filter((id) => id !== story.key)];
}

/** The story's change merged into the story's base; one merged into another branch landed nothing the story is for. */
export function changeLanded(story: StoryFacts, base: string | undefined): boolean {
  return story.change?.state === "merged" && (base === undefined || story.change.base_branch === base);
}

/** The story's change merged, but into a branch other than its base: a person must say what happens next. */
export function mergedElsewhere(story: StoryFacts, base: string | undefined): boolean {
  return story.change?.state === "merged" && !changeLanded(story, base);
}

/** The story ended by its change landing on its base or its item closing, which no unit of it can undo. */
export function storyFinished(story: StoryFacts, base: string | undefined): boolean {
  return changeLanded(story, base) || (story.item !== null && !story.item.open);
}

/**
 * Something of the story is left to do, so it needs a holder: a unit not ended, a corrupt one, a
 * receipt not applied, a letter not imported, or a story not started that nothing finished. A slice
 * not started is the slices step's to start and keeps nothing open by itself.
 */
export function isOpen(story: StoryFacts, base: string | undefined): boolean {
  if (story.mailbox.length > 0) return true;
  if (story.units.some((u) => u.corrupt !== undefined || u.receipts.length > 0 || (u.state !== null && u.state.ended === undefined))) return true;
  const own = story.units.find((u) => u.id === story.key);
  return !own?.state && !storyFinished(story, base);
}

/** One noop per unit: nothing of the story is decided while the claim is not this machine's to act on. */
export function held(story: StoryFacts, rule: string, reason: string): Decision[] {
  return unitIds(story).map((id) => ({ kind: "noop", unit: id, rule, reason }));
}

/** Receipts to apply, a park a person lifts, or a run to settle: the unit rules' business first. */
export function hasPendingUnitWork(u: UnitFacts, state: RunState): boolean {
  return u.receipts.length > 0 || state.parked !== undefined || state.run !== null;
}

/**
 * Import the letters other machines sent: the ones that validate and name a unit of the story as
 * `mailbox.import`, the rest as `mailbox.reject`, which the host acknowledges and records refused
 * rather than guessing what they meant.
 */
export function mailboxDecisions(story: StoryFacts, ctx: DecideContext): Decision[] {
  if (!story.mailbox.length || !ctx.facts.capabilities.store.mailbox) return [];
  const units = new Set(unitIds(story));
  const good: string[] = [];
  const bad: string[] = [];
  for (const m of story.mailbox) {
    const letter = validateMailboxLetter(m.data);
    (letter.ok && units.has(letter.value.unit) ? good : bad).push(m.id);
  }
  const out: Decision[] = [];
  if (good.length) out.push({ kind: "import_mailbox", unit: null, rule: "mailbox.import", story: story.key, ids: good });
  if (bad.length) out.push({ kind: "import_mailbox", unit: null, rule: "mailbox.reject", story: story.key, ids: bad });
  return out;
}
