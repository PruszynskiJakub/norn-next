/**
 * `norn release <story>` (T6): hand a story over. Commits edited handoff.md files, pushes the story
 * and slice branches, then deletes the claim ref by CAS — in that order, so whoever takes it
 * next (T5) finds everything in git. Refused when this heartbeat does not hold the claim.
 */
import { ulid } from "@norn/schema";
import { acquireTickLock } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError, claimHeld, failure, refuse } from "../output.ts";
import { type Observed, observe } from "../runtime/observe/index.ts";
import { heldHere, releaseStory } from "../runtime/release.ts";
import { storyArg } from "../runtime/args.ts";

/** Observe under the tick lock (no remote sync) and find the story, or refuse. */
export async function withStory<T>(ctx: Context, key: string, note: string, f: (obs: Observed, story: Observed["facts"]["stories"][number]) => Promise<T>): Promise<T> {
  const lock = await acquireTickLock(ctx.root, { note, now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: ${note}`, "tick_locked");
  try {
    const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
    const story = obs.facts.stories.find((s) => s.key === key);
    if (!story) throw refuse(`story ${key} is not checked out here`, `norn take ${key}`, "unknown_story");
    return await f(obs, story);
  } finally {
    lock.release();
  }
}

export const releaseCommand = defineCommand({
  name: "release",
  summary: "Hand a story over: push branches and handoff, then delete the claim (T6)",
  usage: "norn release <story>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = storyArg(args.positionals[0] as string, "release");
    return withStory(ctx, key, `norn release ${key}`, async (obs, story) => {
      const c = story.claim;
      if (!heldHere(obs, story)) {
        if (c.state === "other") throw claimHeld(c.blob, `only the holder releases; or norn take ${key} --force`);
        throw refuse(`${key} is not claimed by this machine (claim: ${c.state})`, null, "not_held");
      }
      const r = await releaseStory(obs, story);
      if (!r.ok) throw failure(`release failed: ${r.error}`, `fix the push problem, then norn release ${key} (the claim is kept until the branches are pushed)`, "release_failed", { pushed: r.pushed });
      return { story: key, released: true, pushed: r.pushed, remote: obs.remote, next: `norn take ${key} (on the other machine)` };
    });
  },
});
