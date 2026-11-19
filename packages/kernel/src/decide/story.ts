/**
 * Story rules: what holds or ends a story's units as a whole, and what is decided per story rather
 * than per unit. Claims (take, renew, reacquire, expiry, release), slices (start, blocked, stuck), a
 * new round, a person moving a unit to a step, a merged change ending the story, a closed item closing it (a live run stopped before
 * either mark), corrupt units, a pinned
 * workflow missing or invalid, importing the mailbox, and flushing a shared store. A tracker or forge
 * is read for facts only, never as a record of where a story stands.
 */
import type { TrackerItem } from "@norn/plugin-api";
import type { Decision } from "../model/actions.ts";
import { DEFAULT_WORKFLOW_LABEL_PREFIX } from "../model/config.ts";
import type { StoryFacts, UnitFacts } from "../model/facts.ts";
import type { DecideContext } from "./context.ts";
import { hasPendingUnitWork, held, isOpen, mailboxDecisions, unitIds } from "./story-claim.ts";
import { decideSlices } from "./story-slices.ts";
import { applyWith, corruptRule, endedRule, liveRun, moveRule, park, roundRule, startRule } from "./story-unit.ts";

/** How a story's unit ends when its item closes: a rerun or a round would only end it again, so status names neither. */
export const ITEM_CLOSED_REASON = "the item closed";

const CHANGE_CLOSED = /^the change( \S+)? closed without merging$/;

/** Why a held story whose run data diverged from the remote's waits, and the command that carries it on. */
export function unsyncedReason(story: string): string {
  return `this clone's run data of ${story} and the remote's diverged, so no flush can publish it; norn story take ${story} --force carries the story on from the remote's record, keeping this clone's part under a ref`;
}

/** The park a closed change holds: a rerun clears it, and the next tick parks again while the change stays closed. */
export function changeClosedReason(url: string | undefined): string {
  return `the change${url ? ` ${url}` : ""} closed without merging`;
}

export function isChangeClosedReason(reason: string): boolean {
  return CHANGE_CLOSED.test(reason);
}

/**
 * The story's decisions: story-wide ones (`unit: null`) and at most one per unit. A unit given a
 * decision here is not passed to the unit rules this tick.
 */
export function decideStory(story: StoryFacts, ctx: DecideContext): Decision[] {
  const { facts, config } = ctx;
  const claim = story.claim;
  const now = Date.parse(facts.now);
  const out: Decision[] = [];

  if (!isOpen(story)) return unitIds(story).flatMap((id) => endedNoop(story, id));

  if (claim === null) {
    // a story nobody holds is taken only when no round of it is under way; one in progress was released on purpose
    if (story.units.some((u) => u.corrupt !== undefined || (u.state !== null && u.state.ended === undefined)))
      return held(story, "claim.none", `in progress and unclaimed; a person takes it over (norn story take ${story.key})`);
    out.push({ kind: "claim", unit: null, rule: "claim.take", story: story.key, expect_version: null });
    return [...out, ...held(story, "claim.pending", "waiting for the claim taken this tick")];
  }
  const expired = now >= Date.parse(claim.expires_at);
  if (claim.holder !== facts.holder) {
    // another holder's expired claim is left to it: taking it over could split the story's record across two machines
    const why = expired ? `the claim of ${claim.holder} expired at ${claim.expires_at}; a person takes it over (norn story take ${story.key} --force)` : `held by ${claim.holder} until ${claim.expires_at}`;
    return held(story, "claim.held_elsewhere", why);
  }
  if (expired) {
    out.push({ kind: "claim", unit: null, rule: "claim.reacquire", story: story.key, expect_version: claim.version });
    return [...out, ...held(story, "claim.pending", "this machine's claim expired; reacquiring it")];
  }
  // renewing is a story action: it leaves every unit its one action of the tick
  if (now >= Date.parse(claim.expires_at) - config.claimRenewBeforeMs) out.push({ kind: "renew_claim", unit: null, rule: "claim.renew", story: story.key });
  // every write on a diverged record deepens the split no flush can publish; the claim is kept, so the story waits here for a person
  if (story.unsynced === true) return [...out, ...held(story, "store.diverged", unsyncedReason(story.key))];

  out.push(...mailboxDecisions(story, ctx));
  for (const id of unitIds(story)) {
    const d = unitRule(story, id, story.units.find((x) => x.id === id) ?? null, ctx);
    if (d) out.push(d);
  }
  return out;
}

/**
 * What a held story does after its units' decisions, so the host performs it last: publish a shared
 * store's run data, then give the claim up once nothing of the story is left to do.
 */
export function decideStoryTail(story: StoryFacts, ctx: DecideContext): Decision[] {
  const { facts } = ctx;
  const claim = story.claim;
  if (!claim || claim.holder !== facts.holder) return [];
  const out: Decision[] = [];
  const live = Date.parse(facts.now) < Date.parse(claim.expires_at);
  if (live && facts.capabilities.store.shared && story.unsynced !== true) out.push({ kind: "flush", unit: null, rule: "store.flush", story: story.key });
  if (!isOpen(story)) {
    const finish = finishRule(story, ctx);
    if (finish) out.push(finish);
    out.push({ kind: "release_claim", unit: null, rule: "claim.release", story: story.key });
  }
  return out;
}

/**
 * What an ended story leaves to tidy, decided once, as its claim is given up. Only work that ended
 * done is tidied: a stuck unit keeps its worktree for the person to look into, and a stuck story's
 * item stays open as the record that it is unfinished. The item closes only once the story's change
 * merged: a round that ends done without one (a triage, a refinement) leaves the item open for the
 * person's next round, which a closed item would end at once. With no tracker that can close, the
 * item is left to the person.
 */
function finishRule(story: StoryFacts, ctx: DecideContext): Decision | null {
  const worktrees = story.units.filter((u) => u.state?.ended === "done").map((u) => u.id);
  const own = story.units.find((u) => u.id === story.key);
  const landed = story.change?.state === "merged";
  const closeItem = own?.state?.ended === "done" && landed && story.item?.open === true && ctx.facts.capabilities.tracker?.close === true;
  if (worktrees.length === 0 && !closeItem) return null;
  return { kind: "finish_story", unit: null, rule: "story.finish", story: story.key, worktrees, close_item: closeItem, effect_id: ctx.nextId() };
}

/** One `intake_story` per open item that is not a story yet, when a tracker is configured. */
export function decideIntake(items: readonly TrackerItem[], ctx: DecideContext): Decision[] {
  const { facts, config } = ctx;
  if (!facts.capabilities.tracker) return [];
  const known = new Set(facts.stories.map((s) => s.key));
  const out: Decision[] = [];
  for (const item of items) {
    if (!item.open || known.has(item.key)) continue;
    known.add(item.key);
    out.push({ kind: "intake_story", unit: null, rule: "intake.story", item: structuredClone(item), workflow: intakeWorkflow(item, ctx) ?? config.workflow });
  }
  return out;
}

/**
 * The workflow an item names by label, read once at intake as the person's choice (`norn new
 * --workflow` writes it); from then on the pinned workflow in the run state rules, and the label is
 * never read again. A label naming no workflow that loads is ignored rather than guessed at.
 */
function intakeWorkflow(item: TrackerItem, ctx: DecideContext): string | null {
  const prefix = ctx.config.intakeWorkflowLabelPrefix ?? DEFAULT_WORKFLOW_LABEL_PREFIX;
  for (const label of item.labels) {
    if (!label.startsWith(prefix)) continue;
    const name = label.slice(prefix.length);
    if (ctx.workflows.byName[name]?.ok) return name;
  }
  return null;
}

function endedNoop(story: StoryFacts, id: string): Decision[] {
  const u = story.units.find((x) => x.id === id);
  if (!u) return [];
  return [endedRule(u) ?? { kind: "noop", unit: id, rule: "story.ended", reason: "the story ended; nothing to start" }];
}

/** The story rule for one unit of a held story, or null to leave it to the unit rules. */
function unitRule(story: StoryFacts, id: string, u: UnitFacts | null, ctx: DecideContext): Decision | null {
  const corrupt = corruptRule(u, ctx);
  if (corrupt) return corrupt;
  const isStory = id === story.key;
  const merged = story.change?.state === "merged";
  const itemClosed = story.item !== null && !story.item.open;
  const state = u?.state ?? null;

  if (!u || !state) {
    if (!isStory) return { kind: "noop", unit: id, rule: "slice.not_started", reason: "started by the story's slices step" };
    if (merged || itemClosed) return { kind: "noop", unit: id, rule: "story.ended", reason: merged ? "the change merged before the story started" : "the item closed before the story started" };
    return startRule(story, u, ctx);
  }
  const round = roundRule(u, state, ctx);
  if (round) return round;
  const move = moveRule(story, u, state, ctx);
  if (move) return move;
  if (state.ended) return endedRule(u);

  if (merged || itemClosed) {
    // a mark already on the record is applied by the unit rules; marking again would write it twice
    if (u.receipts.some((r) => r.data.kind === "unit.marked")) return null;
    // the run is stopped before the mark, which takes it off the record: a session left running would act on an ended unit
    const live = liveRun(u, state, ctx);
    if (live) {
      const why = merged ? "the change merged" : "the item closed";
      const rule = merged ? "story.change_merged.stop" : "story.item_closed.stop";
      return { kind: "stop_run", unit: id, rule, run_id: live.id, reason: why, intent: { id: ctx.nextId(), data: { kind: "stop.sent", run_id: live.id, reason: why, step: state.step, attempt: state.attempt } } };
    }
  }
  if (merged) {
    return {
      kind: "mark_done",
      unit: id,
      rule: "story.change_merged",
      intent: { id: ctx.nextId(), data: { kind: "unit.marked", ended: "done", reason: "the change merged", step: state.step, attempt: state.attempt } },
    };
  }
  if (itemClosed) return applyWith(u, state, { kind: "unit.marked", ended: "stuck", reason: ITEM_CLOSED_REASON, step: state.step, attempt: state.attempt }, "story.item_closed", ctx);
  // a closed change parks at any step once nothing is waiting on the record: a wait or check run
  // stays on the record between polls, and would otherwise poll a change a person closed forever
  if (isStory && story.change?.state === "closed" && u.receipts.length === 0 && state.parked === undefined && !liveRun(u, state, ctx)) {
    return park(u.id, u, state, "story.change_closed", "stuck", changeClosedReason(story.change.url), ctx);
  }
  // the unit rules apply what is on the record, and settle a run, before anything here reads the step
  if (hasPendingUnitWork(u, state)) return null;
  if (isStory && ctx.workflows.byHash[state.workflow.hash]?.graph.steps[state.step]?.kind === "slices") return decideSlices(story, u, state, ctx);
  return null;
}
