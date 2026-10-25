/**
 * `norn pane [--interval 5s] [--max-frames N] [--open]` (O1 "a Herdr status pane"): redraws the
 * inbox (@norn/view formatInbox) every interval until SIGINT/SIGTERM, for a terminal pane.
 * Read only (X1): it never ticks, claims or writes. Frames go to the log stream (stderr), so
 * stdout still carries one JSON summary at exit (P8). `--open` instead splits a Herdr pane next
 * to the caller and runs `norn pane` there.
 */
import { herdr } from "@norn/adapters";
import { parseDuration } from "@norn/schema";
import { formatInbox } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { usageError } from "../output.ts";
import { projectView } from "../runtime/human.ts";

const CLEAR = "\x1b[H\x1b[2J";
const DEFAULT_INTERVAL = "5s";

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

export const paneCommand = defineCommand({
  name: "pane",
  summary: "Live inbox for a terminal/Herdr pane, refreshed every interval; read only (O1)",
  usage: "norn pane [--interval 5s] [--max-frames N] [--open]",
  options: { interval: { type: "string" }, "max-frames": { type: "string" }, open: { type: "boolean" } },
  async run(ctx, args) {
    const raw = opt.str(args, "interval") ?? DEFAULT_INTERVAL;
    let interval: number;
    try {
      interval = parseDuration(raw);
    } catch {
      throw usageError(`bad --interval '${raw}' (use e.g. 5s, 1m)`, "norn pane --interval 5s");
    }
    const maxRaw = opt.str(args, "max-frames");
    const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : Number(maxRaw);
    if (!(max > 0)) throw usageError(`bad --max-frames '${maxRaw}'`, "norn pane --max-frames 10");

    if (opt.bool(args, "open")) {
      const opened = await herdr.openStatusPane(ctx.cwd, { env: ctx.env, ...(opt.str(args, "interval") ? { interval: raw } : {}) });
      return { opened: true, runner: "herdr", pane_id: opened.pane_id };
    }

    const signal = ctx.deps.signal;
    let frames = 0;
    while (frames < max && !signal?.aborted) {
      const started = ctx.clock.now();
      let body: string;
      try {
        body = formatInbox(await projectView(ctx), { home: ctx.env.HOME });
      } catch (e) {
        body = `cannot read the inbox: ${(e as Error).message}\n`;
      }
      ctx.log(`${CLEAR}norn inbox · ${ctx.clock.iso()} · every ${raw}\n\n${body.trimEnd()}`);
      frames++;
      if (frames >= max || signal?.aborted) break;
      await sleep(Math.max(0, interval - (ctx.clock.now() - started)), signal);
    }
    return { frames, interval: raw };
  },
});
