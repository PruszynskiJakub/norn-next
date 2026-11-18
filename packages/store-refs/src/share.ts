/**
 * Run data is written in this clone and published per story by flush, under a lease on what this
 * clone last fetched of the remote's ref (its tracking ref). A clone that never fetched the
 * remote's newer run data cannot overwrite it: its push is refused as conflict and its own commits
 * stay where they are.
 */
import { isStoryUnit, ok, type PluginResult, type SyncOutcome } from "@norn/plugin-api";
import { conflict, invalid, type RefsContext } from "./context.ts";
import { fetchRefs, isAncestor, listRefs, pushLeased, refHead, updateRef } from "./git.ts";
import { RUNS_PREFIX, runRef, TRACKING_RUNS_PREFIX, trackingRunRef } from "./layout.ts";

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
