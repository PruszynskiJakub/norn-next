/**
 * `norn watch [--interval 30s]` (H5): ticks in a loop until SIGINT/SIGTERM (or `--max-ticks`).
 * Per-tick progress goes to stderr as JSON lines; stdout gets one summary at exit (P8).
 * A clean exit releases the claims this heartbeat holds (T6) unless `--keep-claims`.
 * `--human` is for a person at the terminal: a line per action instead of JSON (quiet ticks print
 * nothing; the cockpit shows the last tick) and a sentence instead of the summary. `--json` wins.
 */
import { git as gitAdapter } from "@norn/adapters";
import { ExitCode, parseDuration } from "@norn/schema";
import { git as rawGit } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { CliFailure, refuse, rendered, usageError, withExit } from "../output.ts";
import { type ReleaseResult, releaseHeldClaims } from "../runtime/release.ts";
import { runTick, type TickReport } from "../runtime/tick.ts";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

const clockTime = (at: string | number) => new Date(at).toTimeString().slice(0, 8);

/** One line per action of a tick, `HH:MM:SS  gh-12/03  agent.start → start_run`; none for a quiet tick. */
export function humanTickLines(decisions: TickReport["decisions"], at: string): string[] {
  return decisions.map((d) => `${clockTime(at)}  ${d.unit}  ${d.rule} → ${d.kind}${d.ok ? "" : `  FAILED: ${d.error ?? "no detail"}`}`);
}

export function humanSummary(s: { ticks: number; failed_actions: number; skipped_busy: number; released: ReleaseResult[] }, kept: boolean): string {
  const counts = [`${s.failed_actions} failed action${s.failed_actions === 1 ? "" : "s"}`, ...(s.skipped_busy ? [`${s.skipped_busy} skipped while another tick ran`] : [])];
  const lines = [`Stopped after ${s.ticks} tick${s.ticks === 1 ? "" : "s"} (${counts.join(", ")}).`];
  for (const r of s.released)
    lines.push(r.ok ? `Released ${r.story}${r.pushed.length ? ` (pushed ${r.pushed.join(", ")})` : ""}.` : `Could not release ${r.story}: ${r.error ?? "no detail"}.`);
  if (!s.released.length) lines.push(kept ? "Kept the claims this checkout holds (--keep-claims)." : "No claims to release.");
  return lines.join("\n");
}

export const watchCommand = defineCommand({
  name: "watch",
  summary: "Run ticks in a loop (H5); a clean exit releases held claims (T6)",
  usage: "norn watch [--interval 30s] [--max-ticks N] [--keep-claims] [--human]",
  options: { interval: { type: "string" }, "max-ticks": { type: "string" }, "keep-claims": { type: "boolean" }, human: { type: "boolean" } },
  async run(ctx, args) {
    const raw = opt.str(args, "interval") ?? ctx.config.watch_interval;
    let interval: number;
    try {
      interval = parseDuration(raw);
    } catch {
      throw usageError(`bad --interval '${raw}' (use e.g. 30s, 2m)`, "norn watch --interval 30s");
    }
    const maxRaw = opt.str(args, "max-ticks");
    const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : Number(maxRaw);
    if (!(max > 0)) throw usageError(`bad --max-ticks '${maxRaw}'`, "norn watch --max-ticks 10");
    // BS2: no heartbeat without `git merge-tree --write-tree` (git ≥ 2.38) — base conflicts would go unseen
    const v = await rawGit(ctx.root, ["--version"]);
    if (v.code !== 0 || !gitAdapter.gitVersionOk(v.stdout))
      throw refuse(`git ≥ ${gitAdapter.MIN_GIT_VERSION.join(".")} is required to run a heartbeat (found: ${v.stdout.trim() || "no git"}) (BS2)`, "upgrade git, then norn doctor", "git_too_old");
    const human = opt.bool(args, "human");
    if (human) ctx.log(`norn watch: a tick every ${raw}, one line per action; Ctrl-C finishes the tick and releases claims`);
    const signal = ctx.deps.signal;
    let ticks = 0;
    let failed = 0;
    let busy = 0;
    while (ticks < max && !signal?.aborted) {
      const started = ctx.clock.now();
      try {
        const r = await runTick(ctx);
        failed += r.failed;
        const decisions = r.decisions.filter((d) => d.kind !== "noop");
        if (human) for (const line of humanTickLines(decisions, r.at)) ctx.log(line);
        else ctx.log(JSON.stringify({ tick_id: r.tick_id, at: r.at, duration_ms: r.duration_ms, decisions, failed: r.failed }));
      } catch (e) {
        if (e instanceof CliFailure && e.exit === ExitCode.busy) busy++;
        else ctx.log(human ? `${clockTime(started)}  tick failed: ${(e as Error).message}` : JSON.stringify({ error: (e as Error).message }));
      }
      ticks++;
      if (ticks >= max || signal?.aborted) break;
      await sleep(Math.max(0, interval - (ctx.clock.now() - started)), signal);
    }
    const kept = opt.bool(args, "keep-claims");
    const released = kept ? [] : await releaseHeldClaims(ctx);
    const summary = { ticks, failed_actions: failed, skipped_busy: busy, interval: raw, released };
    const out = human ? rendered(summary, humanSummary(summary, kept), { asked: true }) : summary;
    return released.some((r) => !r.ok) ? withExit(out, ExitCode.error) : out;
  },
});
