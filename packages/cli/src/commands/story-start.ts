/**
 * `norn story start [<unit>] [--print]` (B28, MO5, O1): open an agent on the unit's step for a person — the
 * step a person starts (an attended step, or a ready agent step in manual mode). When this machine's
 * runner opens terminals for a person (`capabilities.open`, e.g. Herdr: a focused tab in the unit
 * worktree) it does that; otherwise, or with `--print`, it prints the start command. The agent's
 * `norn brief` starts the run, as when a person types the command (MO3); start records nothing itself.
 * Without a target a person picks from the units a person can start (B57).
 * gh-195/05 (B3): a story worktree this checkout removed while it holds the story's claim is made again
 * first (as `norn story checkout` makes it): its run state is in the machine dir (S12), so the unit goes
 * on at the same step and attempt.
 */
import { existsSync, readdirSync } from "node:fs";
import { cmd, situationOf, startable, startCommandFor } from "@norn/core";
import { parseSpecDirName } from "@norn/schema";
import { heartbeatId, readLocalClaim } from "@norn/store";
import type { Context } from "../context.ts";
import { checkoutStory } from "../runtime/checkout.ts";
import { waitForTickLock } from "../runtime/tick-lock.ts";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { refuseIfHeldElsewhere, resolveTarget, started } from "../runtime/human.ts";
import { targetKey, type TargetRule } from "../runtime/target.ts";

/** B28: the units a person starts — parked at an attended step, or a ready agent step that waits for a person (manual). */
const startableRule: TargetRule = {
  verb: "story start",
  command: (key) => cmd.storyStart(key),
  none: "Nothing waits for a person to start it",
  applies: (_key, u) => !!u && startable(u),
};

/** B3: whether this heartbeat holds `story`'s claim and no story worktree of it is on disk. */
async function worktreeGone(ctx: Context, story: string): Promise<boolean> {
  // a claim norn cannot read is said, never taken for "no claim" (review F8)
  const claim = await readLocalClaim(ctx.root, story);
  if (claim.state !== "present" || claim.blob.heartbeat_id !== heartbeatId(ctx.root, ctx.clock.now())) return false;
  const parent = `${ctx.root}-worktrees`;
  const names = existsSync(parent) ? readdirSync(parent) : [];
  return !names.some((n) => parseSpecDirName(n)?.story === story);
}

export const storyStartCommand = defineCommand({
  name: "story start",
  version: "acts",
  summary: "Open an agent on the step a person starts: a Herdr tab in the unit worktree, or the command to run (B28, MO5)",
  usage: "norn story start [<story|slice>] [--print]",
  optionHelp: { "--print": "print the start command instead of opening a terminal" },
  options: { print: { type: "boolean" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    const raw = await targetKey(ctx, args.positionals[0], args.json === true, startableRule);
    const story = parseUnitKey(raw).story;
    if (await worktreeGone(ctx, story)) {
      const lock = await waitForTickLock(ctx, "norn story start", `retry: ${cmd.storyStart(raw)}`);
      try {
        // the tick that held the lock may have remade it meanwhile
        if (await worktreeGone(ctx, story)) await checkoutStory(ctx, story, false);
      } finally {
        lock.release();
      }
    }
    const t = await resolveTarget(ctx, parseUnitKey(raw).key);
    const sf = t.story_facts;
    const uf = sf?.units.find((u) => u.unit.key === t.key);
    if (!sf || !uf || !t.obs) throw refuse(`${t.key} is not on this checkout`, cmd.storyCheckout(t.story), "not_local");
    if (!t.state) throw refuse(`${t.key} has not started yet`, `${cmd.tick()} (or keep ${cmd.watch()} running), then ${cmd.storyStart(t.key)} again`, "not_started");
    const st = started(t);
    await refuseIfHeldElsewhere(ctx, t.story, "story start");
    const situation = situationOf(st, t.workflow, sf.mode, t.obs.facts.machine.runner);
    if (!startable(situation)) {
      const why = st.status === "ready" && situation.step_type === "agent" ? "the heartbeat starts it (auto mode)" : `it is ${st.status}${st.park ? ` (${st.park.kind})` : ""}`;
      throw refuse(`${t.key} ${st.step}: nothing for a person to start — ${why}`, cmd.status(), "nothing_to_open");
    }
    const worktree = uf.worktree?.path ?? null;
    if (!worktree) throw refuse(`${t.key} has no worktree on this checkout`, cmd.tidy({ dryRun: true }), "no_worktree");
    const command = startCommandFor(uf, sf, ctx.config);
    const out = { unit: t.key, step: st.step, worktree, command };
    const runner = opt.bool(args, "print") ? null : (await ctx.ports()).runner;
    if (!runner?.capabilities.open || !runner.openForPerson) return { ...out, opened: false };
    try {
      const opened = await runner.openForPerson({ cwd: worktree, title: `${t.key} ${st.step}`, command, env: ctx.env });
      return { ...out, opened: true, runner: runner.name, pane_id: opened.pane_id };
    } catch (e) {
      return { ...out, opened: false, reason: `${runner.name}: ${(e as Error).message}` };
    }
  },
});
