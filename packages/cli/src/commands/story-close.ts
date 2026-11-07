/**
 * `norn story close [<story>] [--yes]`: stop working on a story and clean up this
 * machine, keeping the record; the remote issue and PR are left alone.
 *
 * Refused first, before anything changes: a story already closed — its pushed `spec.md` says
 * `dropped`; a claim another machine holds. Then consent: `--yes`, or y at the
 * terminal; without a terminal (no TTY, `--json`, an agent session) it is refused.
 *
 * Then claim it if free (only the holder pushes) and run `closeStory` (runtime/close.ts):
 * commit and mark `spec.md` `status: dropped` → push story and slice branches → only then remove
 * worktrees, local branches, leases and the claim ref.
 * The spec folder with `runs/` and `handoff.md` stays on the pushed story branch. Without a git
 * remote the local branches are the only copy, so they are kept.
 */
import { type ClaimState, cmd } from "@norn/core";
import { acquireClaim, newClaimBlob, scanWorktrees, writtenHere } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { failure, refuse } from "../output.ts";
import { closeStory, recordPushError, recordPushRefused } from "../runtime/close.ts";
import { isClosed, pushedStory } from "../runtime/closed.ts";
import { claimFor } from "../runtime/human.ts";
import type { Observed } from "../runtime/observe/index.ts";
import { withStory } from "../runtime/release.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

/** The refusal for a claim another machine holds (exit 3, unlike checkout's busy `claim_held`). */
function heldElsewhere(key: string, holder: { holder: string; acquired_at: string }) {
  return refuse(`${key} is held by ${holder.holder} since ${holder.acquired_at}`, cmd.storyCheckout(key), "claim_held");
}

/** The remote's claim now — another machine's (or an unreadable one) is refused, never taken over here. */
export async function refuseOthers(ctx: Context, key: string, remote?: string | null): Promise<ClaimState> {
  const c = await claimFor(ctx, key, remote !== undefined ? { remote } : {});
  if (c.state === "other") throw heldElsewhere(key, c.blob);
  if (c.state === "corrupt") throw claimCorrupt(key);
  return c;
}

const claimCorrupt = (key: string) => refuse(`claim ref of ${key} is unreadable`, cmd.storyCheckout(key, { force: true }), "claim_corrupt");

/**
 * Under the tick lock: read the remote claim again — the prompt may have stayed open while
 * another machine ran `story checkout --force`, and the local claim ref can be stale — then keep
 * this heartbeat's claim or take a free one (only the holder pushes).
 */
export async function claimIfFree(ctx: Context, obs: Observed, key: string): Promise<string> {
  const c = await refuseOthers(ctx, key, obs.remote);
  if ((c.state === "mine" || c.state === "expired") && writtenHere(c, obs.heartbeat_id)) return c.sha;
  const now = obs.facts.now;
  const blob = newClaimBlob({ story: key, holder: obs.facts.machine.holder, heartbeat_id: obs.heartbeat_id, now, lease: obs.config.claim.lease });
  const r = await acquireClaim(obs.root, obs.remote, blob, { now });
  if (!r.ok) {
    if (r.reason === "held") throw heldElsewhere(key, r.holder);
    if (r.reason === "corrupt") throw claimCorrupt(key);
    throw failure(`cannot claim ${key}: ${r.message}`, `retry: ${cmd.storyClose(key)}`, "claim_failed");
  }
  return r.sha;
}

export const storyCloseCommand = defineCommand({
  name: "story close",
  version: "acts",
  summary: "Close a story: push its branches, then remove worktrees, local branches and the claim; the record, issue and PR stay",
  usage: "norn story close [<story>] [--yes]",
  options: { yes: { type: "boolean" } },
  optionHelp: { "--yes": "close without asking (needed under --json or without a terminal)" },
  positionals: { max: 1 },
  async run(ctx, args) {
    const json = args.json === true;
    const key = await resolveStory(ctx, args.positionals[0], json, aStory("story close", cmd.storyClose));
    if (isClosed(await pushedStory(ctx, key, cmd.storyClose(key)))) throw refuse(`${key} is already closed`, null, "already_closed");
    await refuseOthers(ctx, key);
    // Ask before taking the tick lock, so an open prompt never blocks tick or watch
    if (!opt.bool(args, "yes")) {
      const terminal = ctx.terminal(json);
      if (!terminal) throw refuse(`closing ${key} removes its worktrees; there is no terminal to ask in`, "pass --yes", "confirm_required");
      const wts = scanWorktrees(ctx.root);
      const count = (wts.stories.has(key) ? 1 : 0) + [...wts.slices.keys()].filter((s) => s.startsWith(`${key}/`)).length;
      if (!(await terminal.confirm(`Close ${key}? Worktrees for ${count} units will be removed [y/N]`))) return { story: key, dropped: false };
    }
    return withStory(ctx, key, cmd.storyClose(key), async (obs, story) => {
      const claimSha = await claimIfFree(ctx, obs, key);
      const r = await closeStory(obs, story, { home: ctx.home, claimSha });
      if (!r.ok && r.reason === "spec_corrupt") throw failure(`cannot mark ${r.file} dropped: ${r.message}`, `fix spec.md, then ${cmd.storyClose(key)} again`, "story_corrupt");
      if (!r.ok && r.reason === "record_push_failed")
        throw recordPushRefused(recordPushError(key, r.push_reason, r.message), cmd.storyClose(key, { yes: true }), r.pushed);
      if (!r.ok)
        throw failure(`push ${r.branch} failed (${r.push_reason}): ${r.message}`, `fix the push problem, then ${cmd.storyClose(key, { yes: true })} again; nothing was removed`, "push_failed", { pushed: r.pushed });
      const { ok: _ok, story: _story, branches_kept, record, ...effects } = r;
      // the output keeps its key order: `branches_kept` only when a branch was kept, `record` last
      const { leases_released, claim_deleted, claim_error, ...done } = effects;
      return {
        story: key,
        dropped: true,
        ...done,
        ...(branches_kept.length ? { branches_kept } : {}),
        leases_released,
        claim_deleted,
        ...(claim_error !== undefined ? { claim_error } : {}),
        record,
      };
    });
  },
});
