/**
 * `norn pane [--interval 5s] [--max-frames N] [--open] [--interactive] [--next]` (O1 "a Herdr status
 * pane"): redraws the inbox (@norn/view formatInbox) every interval until SIGINT/SIGTERM, for a
 * terminal pane. Frames go to the log stream (stderr), so stdout still carries one JSON summary at
 * exit (P8). `--open` instead splits a Herdr pane next to the caller and runs the interactive
 * cockpit there (HC10).
 *
 * `--interactive` (HC4–HC8) numbers the items and reads one command per line between redraws; it
 * writes only through CLI verbs run by the dispatcher (HC7, X1). Inside Herdr it also focuses agent
 * panes (HC6) and labels them in the sidebar (HC12). `--next` (HC10) focuses the agent pane of the
 * oldest Your turn item once and exits.
 */
import { createInterface } from "node:readline";
import { herdr } from "@norn/adapters";
import { parseDuration } from "@norn/schema";
import { formatInbox, inboxItemsInOrder, type ProjectView } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { usageError } from "../output.ts";
import { goTo, goToWorkspace, labelPanes, oldestYourTurn, parseCockpitLine, planCockpit, toneOf, verbMessage } from "../runtime/cockpit.ts";
import { renderFrame, type Tone } from "../runtime/cockpit-view.ts";
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

/** HC6/HC8: the Herdr the cockpit talks to — injected, or the real one inside Herdr, else none. */
function cockpitHerdr(ctx: Context): herdr.HerdrCockpit | null {
  if (ctx.deps.herdr !== undefined) return ctx.deps.herdr;
  if (ctx.env.HERDR_ENV !== "1") return null;
  const o = ctx.config.runner?.adapter === "herdr" ? (ctx.config.runner.options ?? {}) : {};
  return herdr.createHerdrCockpit({ env: ctx.env, ...(typeof o.bin === "string" ? { bin: o.bin } : {}), ...(typeof o.session === "string" ? { session: o.session } : {}) });
}

/** HC4: command lines from the injected input, else stdin. */
function inputLines(ctx: Context): AsyncIterator<string> {
  const src = ctx.deps.input ?? createInterface({ input: process.stdin, terminal: false });
  return src[Symbol.asyncIterator]();
}

async function cockpitView(ctx: Context): Promise<{ view: ProjectView | null; error: string | null }> {
  try {
    return { view: await projectView(ctx), error: null };
  } catch (e) {
    return { view: null, error: `cannot read the inbox: ${(e as Error).message}` };
  }
}

/** The frame's look: the pane's width, colour only on a terminal without NO_COLOR. */
function frameLook(ctx: Context): { width: number; color: boolean } {
  const cols = Number(ctx.env.COLUMNS) || process.stderr.columns || 100;
  const color = !!process.stderr.isTTY && ctx.env.NO_COLOR === undefined && ctx.env.TERM !== "dumb";
  return { width: cols, color };
}

const localClock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** HC7: a verb in-process through the dispatcher (loaded lazily: the dispatcher imports this command). */
async function runVerb(ctx: Context, argv: string[]): Promise<{ exit: number; value: unknown; stdout: string }> {
  const { runCli } = await import("../cli.ts");
  return runCli(argv, { ...ctx.deps, cwd: ctx.cwd, env: ctx.env, log: () => {} });
}

async function interactive(ctx: Context, raw: string, interval: number, max: number) {
  const signal = ctx.deps.signal;
  const cockpit = cockpitHerdr(ctx);
  const lines = inputLines(ctx);
  let pending: Promise<IteratorResult<string>> | null = null;
  let message: { text: string; tone: Tone } | null = null;
  let output = "";
  let frames = 0;
  let commands = 0;
  while (frames < max && !signal?.aborted) {
    const { view, error } = await cockpitView(ctx);
    const items = view ? inboxItemsInOrder(view) : [];
    if (cockpit && view) await labelPanes(cockpit, items, 3 * interval);
    const look = frameLook(ctx);
    const frame = view
      ? renderFrame(view, items, { ...look, clock: localClock(ctx.clock.now()), interval: raw, message, output, herdr: !!cockpit })
      : `${error}\n› `;
    ctx.log(`${CLEAR}${frame}`);
    frames++;
    output = "";
    if (frames >= max) break;
    pending ??= lines.next();
    const got = await Promise.race([pending, sleep(interval, signal).then(() => null)]);
    if (got === null) continue; // redraw on the interval; the read stays pending
    pending = null;
    if (got.done) break;
    commands++;
    const step = planCockpit(parseCockpitLine(got.value), items);
    if (step.kind === "quit") break;
    let text: string | null = null;
    if (step.kind === "refresh") text = null;
    else if (step.kind === "message") text = step.text;
    else if (step.kind === "output") output = step.text;
    else if (step.kind === "go") text = await goTo(cockpit, step.item, ctx.cwd).catch((e: Error) => `could not go there: ${e.message}`);
    else if (step.kind === "workspace") text = await goToWorkspace(cockpit, step.item).catch((e: Error) => `could not go there: ${e.message}`);
    else {
      const r = await runVerb(ctx, step.argv);
      text = verbMessage(step.argv, r.exit, r.value);
      if (step.argv[0] === "trace" && r.exit === 0) output = r.stdout;
    }
    message = text === null ? null : { text, tone: toneOf(text) };
  }
  return { frames, interval: raw, interactive: true, commands };
}

export const paneCommand = defineCommand({
  name: "pane",
  summary: "Live inbox for a terminal/Herdr pane, refreshed every interval; --interactive acts on its items (O1, HC4)",
  usage: "norn pane [--interval 5s] [--max-frames N] [--open] [--interactive] [--next]",
  options: {
    interval: { type: "string" },
    "max-frames": { type: "string" },
    open: { type: "boolean" },
    interactive: { type: "boolean" },
    next: { type: "boolean" },
  },
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
      const opened = await herdr.openStatusPane(ctx.cwd, { env: ctx.env, interactive: true, ...(opt.str(args, "interval") ? { interval: raw } : {}) });
      return { opened: true, runner: "herdr", pane_id: opened.pane_id };
    }

    if (opt.bool(args, "next")) {
      // HC10: one shot — focus the agent pane of the oldest Your turn item with a run; never starts an agent
      const cockpit = cockpitHerdr(ctx);
      const oldest = oldestYourTurn(inboxItemsInOrder(await projectView(ctx)), true);
      if (!cockpit || !oldest) return { focused: null, item: oldest?.id ?? null };
      const pane = herdr.findAgentPane(await cockpit.listAgents(), oldest.reach);
      if (pane) await cockpit.focus(pane);
      return { focused: pane, item: oldest.id, ...(pane ? {} : { command: oldest.command }) };
    }

    if (opt.bool(args, "interactive")) return interactive(ctx, raw, interval, max);

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
