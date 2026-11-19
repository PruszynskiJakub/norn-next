/**
 * Run data is written in this clone and published per story by flush, under a lease on what this
 * clone last fetched of the remote's ref (its tracking ref). A clone that never fetched the
 * remote's newer run data cannot overwrite it: its push is refused as conflict and its own commits
 * stay where they are.
 */
import { isStoryUnit, ok, type PluginResult, type SyncOutcome } from "@norn/plugin-api";
import { conflict, invalid, type RefsContext } from "./context.ts";
import { fetchRefs, isAncestor, listRefs, pushLeased, refHead, updateRef } from "./git.ts";
import { droppedRunRef, RUNS_PREFIX, runRef, TRACKING_RUNS_PREFIX, trackingRunRef } from "./layout.ts";

/**
 * Fetch the remote's run refs into the tracking refs, then move each local run ref that is missing
 * or behind up to it. A local ref with commits of its own is left alone: flush, not sync, is
 * where a clone learns its run data diverged.
 */
export async function sync(rc: RefsContext): Promise<PluginResult<SyncOutcome>> {
  const before = await listRefs(rc.git, TRACKING_RUNS_PREFIX);
  if (!before.ok) return before;
  const fetched = await fetchRefs(rc.git, rc.remote, [`+${RUNS_PREFIX}*:${TRACKING_RUNS_PREFIX}*`], true);
  if (!fetched.ok) return fetched;
  const after = await listRefs(rc.git, TRACKING_RUNS_PREFIX);
  if (!after.ok) return after;
  const seen = new Map(before.value);
  let changed = 0;
  for (const [name, remoteHead] of after.value) {
    if (seen.get(name) !== remoteHead) changed++;
    const story = name.slice(TRACKING_RUNS_PREFIX.length);
    if (!isStoryUnit(story)) continue;
    const local = await refHead(rc.git, runRef(story));
    if (!local.ok) return local;
    if (local.value === remoteHead) continue;
    if (local.value !== null) {
      const behind = await isAncestor(rc.git, local.value, remoteHead);
      if (!behind.ok) return behind;
      if (!behind.value) continue;
    }
    // a write that lands in between makes this swap fail, which is right: that write is newer than the fetch
    await updateRef(rc.git, runRef(story), remoteHead, local.value);
  }
  return ok({ fetched: changed });
}

export async function flush(rc: RefsContext, story: string): Promise<PluginResult<{ pushed: boolean }>> {
  if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
  const local = await refHead(rc.git, runRef(story));
  if (!local.ok) return local;
  const seen = await refHead(rc.git, trackingRunRef(story));
  if (!seen.ok) return seen;
  if (local.value === null || local.value === seen.value) return ok({ pushed: false });
  if (seen.value !== null) {
    const behind = await isAncestor(rc.git, local.value, seen.value);
    if (!behind.ok) return behind;
    if (behind.value) return ok({ pushed: false });
    // the lease alone would let a clone that synced after diverging replace the remote's commits with its own
    const builtOn = await isAncestor(rc.git, seen.value, local.value);
    if (!builtOn.ok) return builtOn;
    if (!builtOn.value) return conflict(`${story}: this clone's run data and the remote's have diverged; neither is pushed over the other`);
  }
  const pushed = await pushLeased(rc.git, rc.remote, local.value, runRef(story), seen.value);
  if (!pushed.ok) return pushed;
  if (pushed.value === "rejected") return conflict(`${story}: the remote's run data moved since this clone last synced; sync, then flush again`);
  // the tracking ref only ever records what the remote is known to hold; a racing flush that moved it further wins
  await updateRef(rc.git, trackingRunRef(story), local.value, seen.value);
  return ok({ pushed: true });
}

interface Heads {
  local: string;
  seen: string;
}

/** This clone's run ref and its tracking ref when each holds commits the other lacks; null otherwise. */
async function divergedHeads(rc: RefsContext, story: string): Promise<PluginResult<Heads | null>> {
  const local = await refHead(rc.git, runRef(story));
  if (!local.ok) return local;
  const seen = await refHead(rc.git, trackingRunRef(story));
  if (!seen.ok) return seen;
  if (local.value === null || seen.value === null || local.value === seen.value) return ok(null);
  for (const [older, newer] of [
    [local.value, seen.value],
    [seen.value, local.value],
  ] as const) {
    const contained = await isAncestor(rc.git, older, newer);
    if (!contained.ok) return contained;
    if (contained.value) return ok(null);
  }
  return ok({ local: local.value, seen: seen.value });
}

export async function diverged(rc: RefsContext, story: string): Promise<PluginResult<boolean>> {
  if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
  const heads = await divergedHeads(rc, story);
  return heads.ok ? ok(heads.value !== null) : heads;
}

/**
 * Move this clone's run ref of a diverged story to what it last fetched of the remote's. The commits
 * dropped stay under a ref of their own first, so nothing is lost before the run ref moves; the move
 * is a compare-and-swap, so a write that lands in between makes it fail rather than vanish.
 */
export async function adoptRemote(rc: RefsContext, story: string): Promise<PluginResult<{ dropped: string | null; kept_at?: string }>> {
  if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
  const heads = await divergedHeads(rc, story);
  if (!heads.ok) return heads;
  if (heads.value === null) return ok({ dropped: null });
  const { local, seen } = heads.value;
  const kept = droppedRunRef(story, local);
  if (!(await updateRef(rc.git, kept, local, null))) {
    // named by the commit it keeps, so one already there from an attempt that stopped half-way holds the same
    const there = await refHead(rc.git, kept);
    if (!there.ok) return there;
    if (there.value !== local) return conflict(`${story}: cannot keep this clone's run data at ${kept}`);
  }
  if (!(await updateRef(rc.git, runRef(story), seen, local))) return conflict(`${story}: this clone's run data moved while it was replaced; try again`);
  return ok({ dropped: local, kept_at: kept });
}
