/**
 * `norn watch [--interval 30s]` (H5): ticks in a loop until SIGINT/SIGTERM (or `--max-ticks`).
 * Per-tick progress goes to stderr as JSON lines; stdout gets one summary at exit (P8).
 * A clean exit releases the claims this heartbeat holds (T6) unless `--keep-claims`.
 */
import { git as gitAdapter } from "@norn/adapters";
import { ExitCode, parseDuration } from "@norn/schema";
import { git as rawGit } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { CliFailure, refuse, usageError, withExit } from "../output.ts";
import { releaseHeldClaims } from "../runtime/release.ts";
import { runTick } from "../runtime/tick.ts";

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

export const watchCommand = defineCommand({
  name: "watch",
  summary: "Run ticks in a loop (H5); a clean exit releases held claims (T6)",
  usage: "norn watch [--interval 30s] [--max-ticks N] [--keep-claims]",
  options: { interval: { type: "string" }, "max-ticks": { type: "string" }, "keep-claims": { type: "boolean" } },
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
    const signal = ctx.deps.signal;
    let ticks = 0;
    let failed = 0;
    let busy = 0;
    while (ticks < max && !signal?.aborted) {
      const started = ctx.clock.now();
      try {
        const r = await runTick(ctx);
        failed += r.failed;
        ctx.log(JSON.stringify({ tick_id: r.tick_id, at: r.at, duration_ms: r.duration_ms, decisions: r.decisions.filter((d) => d.kind !== "noop"), failed: r.failed }));
      } catch (e) {
        if (e instanceof CliFailure && e.exit === ExitCode.busy) busy++;
        else ctx.log(JSON.stringify({ error: (e as Error).message }));
      }
      ticks++;
      if (ticks >= max || signal?.aborted) break;
      await sleep(Math.max(0, interval - (ctx.clock.now() - started)), signal);
    }
    const released = opt.bool(args, "keep-claims") ? [] : await releaseHeldClaims(ctx);
    const summary = { ticks, failed_actions: failed, skipped_busy: busy, interval: raw, released };
    return released.some((r) => !r.ok) ? withExit(summary, ExitCode.error) : summary;
  },
});
