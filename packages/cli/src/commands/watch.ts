/**
 * `norn watch [--interval 30s]`: ticks in a loop until SIGINT/SIGTERM (or `--max-ticks`).
 * Per-tick progress goes to stderr as JSON lines; stdout gets one summary at exit.
 * A clean exit releases the claims this heartbeat holds unless `--keep-claims`.
 * `--human` is for a person at the terminal: a line per action instead of JSON (quiet ticks print
 * nothing; the cockpit shows the last tick) and a sentence instead of the summary. `--json` wins.
 * A tick that left the next one something to do (`follow_up`) is followed at once, up to
 * `SETTLE_TICKS` in a row, then the interval; `--max-ticks` counts every tick. A receipt another
 * process appends during the pause (a report, a finished check) wakes it within about a second.
 */
import { git as gitAdapter } from "@norn/adapters";
import { DEFAULT_INTERVAL, ExitCode, parseDuration } from "@norn/schema";
import { recordInterval } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { CliFailure, refuse, rendered, usageError, withExit } from "../output.ts";
import { type ReleaseResult, releaseHeldClaims } from "../runtime/release.ts";
import { runTick, type TickReport } from "../runtime/tick.ts";
import { versionRefusal } from "../runtime/version-guard.ts";
import { pauseUntilWake, wakeStamp } from "../runtime/wake.ts";
import { cmd, type InboxItem, ticksPausedTitle } from "@norn/core";
import type { Context } from "../context.ts";

/** At most this many ticks in a row run at once after a tick that left a follow-up, so a unit that keeps changing never spins. */
export const SETTLE_TICKS = 3;

/** After a tick, whether the next one runs at once, and how many have run at once in a row since the last pause. */
export function settleStep(followUp: boolean, settling: number): { now: boolean; settling: number } {
  return followUp && settling < SETTLE_TICKS ? { now: true, settling: settling + 1 } : { now: false, settling: 0 };
}

const clockTime = (at: string | number) => new Date(at).toTimeString().slice(0, 8);

/** One line per action of a tick, `HH:MM:SS  gh-12/03  agent.start → start_run`; none for a quiet tick. */
export function humanTickLines(decisions: TickReport["decisions"], at: string): string[] {
  return decisions.map((d) => `${clockTime(at)}  ${d.unit}  ${d.rule} → ${d.kind}${d.ok ? "" : `  FAILED: ${d.error ?? "no detail"}`}${(d.warnings ?? []).map((w) => `  WARNING: ${w}`).join("")}`);
}

export function humanSummary(s: { ticks: number; failed_actions: number; skipped_busy: number; skipped_version?: number; released: ReleaseResult[] }, kept: boolean): string {
  const counts = [
    `${s.failed_actions} failed action${s.failed_actions === 1 ? "" : "s"}`,
    ...(s.skipped_busy ? [`${s.skipped_busy} skipped while another tick ran`] : []),
    ...(s.skipped_version ? [`${s.skipped_version} skipped on a norn version mismatch`] : []),
  ];
  const lines = [`Stopped after ${s.ticks} tick${s.ticks === 1 ? "" : "s"} (${counts.join(", ")}).`];
  for (const r of s.released)
    lines.push(r.ok ? `Released ${r.story}${r.pushed.length ? ` (pushed ${r.pushed.join(", ")})` : ""}.` : `Could not release ${r.story}: ${r.error ?? "no detail"}.`);
  if (!s.released.length) lines.push(kept ? "Kept the claims this checkout holds (--keep-claims)." : "No claims to release.");
  return lines.join("\n");
}

/**
 * The version guard again before a tick, with the config reloaded so a pull mid-watch
 * is seen. A mismatch skips the tick and notifies once per repo version it pauses on; a match clears
 * that memory, so the same mismatch coming back notifies again. The memory lives in this watch
 * process only, and watch never exits for a mismatch (a cron tick just exits 3).
 */
async function pausedOnVersion(ctx: Context, state: { notified: string | null }) {
  ctx.reload();
  const refusal = versionRefusal(ctx);
  if (!refusal) {
    state.notified = null;
    return null;
  }
  if (state.notified !== refusal.repo) {
    state.notified = refusal.repo;
    const item: InboxItem = {
      id: `watch-paused:${refusal.repo}:${ctx.version}`,
      group: "unblock",
      story: "*",
      slice: null,
      step: null,
      title: ticksPausedTitle(refusal.needs),
      detail: refusal.failure.body.error,
      command: cmd.doctor(),
      since: new Date(ctx.clock.now()).toISOString(),
    };
    for (const n of (await ctx.ports()).notifiers) {
      try {
        await n.notify(item);
      } catch (e) {
        ctx.log(JSON.stringify({ error: (e as Error).message })); // best-effort, like the inbox's notifications
      }
    }
  }
  return refusal.failure;
}

export const watchCommand = defineCommand({
  name: "watch",
  version: "acts",
  summary: "Run ticks in a loop; a clean exit releases held claims",
  usage: "norn watch [--interval 30s] [--max-ticks N] [--keep-claims] [--human]",
  options: { interval: { type: "string" }, "max-ticks": { type: "string" }, "keep-claims": { type: "boolean" }, human: { type: "boolean" } },
  textFlag: "human",
  async run(ctx, args) {
    const raw = opt.str(args, "interval") ?? DEFAULT_INTERVAL;
    let interval: number;
    try {
      interval = parseDuration(raw);
    } catch {
      throw usageError(`bad --interval '${raw}' (use e.g. 30s, 2m)`, cmd.watch({ interval: "30s" }));
    }
    // Watch always records the interval it runs at (liveness, claim timing)
    recordInterval(ctx.root, raw);
    ctx.reload();
    const maxRaw = opt.str(args, "max-ticks");
    const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : Number(maxRaw);
    if (!(max > 0)) throw usageError(`bad --max-ticks '${maxRaw}'`, cmd.watch({ maxTicks: 10 }));
    // No heartbeat without `git merge-tree --write-tree` (git ≥ 2.38) — base conflicts would go unseen
    const v = await ctx.git.version(ctx.root);
    if (!v || !gitAdapter.gitVersionOk(v))
      throw refuse(`git ≥ ${gitAdapter.MIN_GIT_VERSION.join(".")} is required to run a heartbeat (found: ${v || "no git"})`, `upgrade git, then ${cmd.doctor()}`, "git_too_old");
    const human = opt.bool(args, "human");
    if (human) ctx.log(`norn watch: a tick every ${raw}, one line per action; Ctrl-C finishes the tick and releases claims`);
    const signal = ctx.deps.signal;
    let ticks = 0;
    let failed = 0;
    let busy = 0;
    let skippedVersion = 0;
    let settling = 0;
    const version = { notified: null as string | null };
    while (ticks < max && !signal?.aborted) {
      const started = ctx.clock.now();
      const since = wakeStamp(ctx.root); // Receipts written from here on by another process wake the pause
      let followUp = false;
      try {
        const refused = await pausedOnVersion(ctx, version);
        if (refused) {
          skippedVersion++;
          if (human) ctx.log(`${clockTime(started)}  tick skipped: ${refused.body.error}`);
          else ctx.log(JSON.stringify({ at: new Date(started).toISOString(), ...refused.body }));
        } else {
          const r = await runTick(ctx);
          failed += r.failed;
          followUp = r.follow_up === true;
          const decisions = r.decisions.filter((d) => d.kind !== "noop");
          if (human) for (const line of humanTickLines(decisions, r.at)) ctx.log(line);
          else ctx.log(JSON.stringify({ tick_id: r.tick_id, at: r.at, duration_ms: r.duration_ms, decisions, failed: r.failed, ...(r.follow_up ? { follow_up: true } : {}) }));
        }
      } catch (e) {
        if (e instanceof CliFailure && e.exit === ExitCode.busy) busy++;
        else ctx.log(human ? `${clockTime(started)}  tick failed: ${(e as Error).message}` : JSON.stringify({ error: (e as Error).message }));
      }
      ticks++;
      if (ticks >= max || signal?.aborted) break;
      // The follow-up a tick left (a receipt to apply, a step to start) runs now, not an interval later
      const next = settleStep(followUp, settling);
      settling = next.settling;
      if (next.now) continue;
      // A receipt another process writes (an agent report, a finished check) ends the pause early
      await pauseUntilWake(ctx, Math.max(0, interval - (ctx.clock.now() - started)), since, signal);
    }
    const kept = opt.bool(args, "keep-claims");
    const released = kept ? [] : await releaseHeldClaims(ctx);
    const summary = { ticks, failed_actions: failed, skipped_busy: busy, skipped_version: skippedVersion, interval: raw, released };
    const out = human ? rendered(summary, humanSummary(summary, kept), { asked: true }) : summary;
    return released.some((r) => !r.ok) ? withExit(out, ExitCode.error) : out;
  },
});
