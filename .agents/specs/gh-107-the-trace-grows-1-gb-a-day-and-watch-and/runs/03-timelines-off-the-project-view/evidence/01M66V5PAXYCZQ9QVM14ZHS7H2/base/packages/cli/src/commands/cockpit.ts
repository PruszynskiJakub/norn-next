/**
 * `norn cockpit [--interval 5s] [--json] [--next] [--open]` (SPEC-cockpit CP5–CP13): the cockpit
 * model (@norn/view cockpitModel) drawn full screen with raw keys — what needs you, then every
 * story, the selected row's preview, its actions by key. It writes only through CLI verbs run by the
 * dispatcher (X1, HC7) and stays open until q or Esc. Frames go to stderr, one JSON summary to
 * stdout at exit (P8).
 *
 * - `--json`: print the model once (CP5), for a front end outside TypeScript.
 * - `--next` (HC10): focus the agent pane of the oldest Your turn item with a run, once.
 * - `--open`: split a Herdr pane below the caller and run the cockpit there.
 *
 * CP13: outside a norn repository — no repository, or one norn was never set up in (a Herdr popup over
 * any workspace) — it shows the repository the last cockpit ran in on this machine (`~/.norn/cockpit.json`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { herdr } from "@norn/adapters";
import { parseDuration } from "@norn/schema";
import { readCockpitFile, spawnBounded, writeCockpitFile } from "@norn/store";
import { type CockpitModel, cockpitModel, inboxItemsInOrder, type ProjectView, withInput } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { Context } from "../context.ts";
import { usageError } from "../output.ts";
import { cockpitHerdr, labelPanes, oldestYourTurn, placeAgent, verbMessage } from "../runtime/cockpit.ts";
import { clampScroll, handleKey, initialState, parseKeys, renderCockpit, type TuiEffect, type TuiState } from "../runtime/cockpit-tui.ts";
import { projectView } from "../runtime/human.ts";

const CLEAR = "\x1b[H\x1b[2J";
/** The alternate screen (frames leave no scrollback), no cursor, SGR mouse reporting for the wheel. */
const SCREEN_ON = "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h";
const SCREEN_OFF = "\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l";

/** Raw key chunks: the injected input, else stdin in raw mode (restored on `close`). */
function keyChunks(ctx: Context): { chunks: AsyncIterator<string>; close: () => void } {
  if (ctx.deps.input) return { chunks: ctx.deps.input[Symbol.asyncIterator](), close: () => {} };
  const stdin = process.stdin;
  const raw = !!stdin.isTTY;
  if (raw) stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  if (process.stderr.isTTY) process.stderr.write(SCREEN_ON);
  return {
    chunks: (stdin as AsyncIterable<string>)[Symbol.asyncIterator](),
    close: () => {
      if (raw) stdin.setRawMode(false);
      if (process.stderr.isTTY) process.stderr.write(SCREEN_OFF);
      stdin.pause();
    },
  };
}

/** CP8: a link with the platform opener (`open` on macOS, `xdg-open` elsewhere), or the injected shell. */
async function openLink(ctx: Context, url: string): Promise<{ code: number; stderr: string }> {
  const argv = [process.platform === "darwin" ? "open" : "xdg-open", url];
  if (ctx.deps.shell) return ctx.deps.shell(argv, ctx.root);
  // H11 seam: store's bounded spawn (a missing opener is exit 127, never a throw)
  const r = await spawnBounded(argv, {});
  return { code: r.code, stderr: r.stderr };
}

/** HC7: a verb in-process through the dispatcher (loaded lazily: the dispatcher imports this command). */
async function runVerb(ctx: Context, argv: string[], json: boolean): Promise<{ exit: number; value: unknown; stdout: string }> {
  const { runCli } = await import("../cli.ts");
  return runCli(json ? [...argv, "--json"] : argv, { ...ctx.deps, cwd: ctx.cwd, env: ctx.env, log: () => {} });
}

/** Resolves after `ms`, or at once when `signal` aborts (SIGINT/SIGTERM end the cockpit, CP6). */
function sleep(ms: number, signal?: AbortSignal): Promise<null> {
  return new Promise((r) => {
    if (signal?.aborted) return r(null);
    const t = setTimeout(done, ms);
    (t as { unref?: () => void }).unref?.();
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      r(null);
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** CP13: this norn repository, else (no repository, or one without norn) the one the last cockpit ran in. */
async function located(ctx: Context): Promise<Context> {
  const last = readCockpitFile(ctx.home).last_repo;
  const elsewhere = async (e: unknown) => {
    if (!last || !existsSync(last)) throw e;
    const there = new Context({ ...ctx.deps, cwd: last });
    await there.locate();
    return there;
  };
  try {
    await ctx.locate();
  } catch (e) {
    return elsewhere(e);
  }
  if (existsSync(join(ctx.root, ".agents", "norn")) || !last) return ctx;
  return elsewhere(null);
}

const localClock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

async function interactive(ctx: Context, interval: number) {
  const cockpit = cockpitHerdr(ctx);
  const options = { places: !!cockpit, provider: ctx.config.remote.provider };
  const { chunks, close } = keyChunks(ctx);
  let state: TuiState = initialState();
  let view: ProjectView | null = null;
  let model: CockpitModel | null = null;
  let last: { action: string; unit: string; ok: boolean } | null = null;
  let pending: Promise<IteratorResult<string>> | null = null;
  let frames = 0;
  const look = () => ({
    width: Number(ctx.env.COLUMNS) || process.stderr.columns || 100,
    height: Number(ctx.env.LINES) || process.stderr.rows || 30,
    color: !!process.stderr.isTTY && ctx.env.NO_COLOR === undefined && ctx.env.TERM !== "dumb",
    now: ctx.clock.now(),
    clock: localClock(ctx.clock.now()),
  });

  /** One effect; true = the cockpit is done. */
  async function act(e: TuiEffect): Promise<boolean> {
    if (e.kind === "quit") return true;
    if (e.kind === "refresh") {
      view = null;
      return false;
    }
    const { row, action } = e;
    const fx = action.effect;
    let text: string;
    let ok = true;
    if (fx.kind === "verb") {
      const argv = withInput(fx.argv, e.input ?? "");
      const r = await runVerb(ctx, argv, !fx.show);
      ok = r.exit === 0;
      if (fx.show && ok) state = { ...state, shown: r.stdout, scroll: 0 };
      text = fx.show && ok ? `norn ${argv.join(" ")} — esc to close` : verbMessage(argv, r.exit, r.value);
      if (!fx.show) view = null; // a verb changed what needs you
    } else if (fx.kind === "link") {
      const r = await openLink(ctx, fx.url);
      ok = r.code === 0;
      text = ok ? `opened ${fx.url}` : `could not open ${fx.url}: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`;
    } else if (fx.place === "orient") {
      const r = await runVerb(ctx, ["orient", fx.story, "--open"], true);
      ok = r.exit === 0;
      const v = r.value as { created?: boolean; workspace_id?: string } | null;
      text = ok ? `${v?.created ? "opened" : "focused"} ${fx.story} orient${v?.workspace_id ? ` (${v.workspace_id})` : ""}` : verbMessage(["orient", fx.story], r.exit, r.value);
    } else {
      text = cockpit ? await placeAgent(cockpit, fx.reach, row.unit).catch((err: Error) => `could not go there: ${err.message}`) : "outside Herdr: no pane to go to";
      ok = /^focused\b/.test(text);
    }
    last = { action: action.id, unit: row.unit, ok };
    state = { ...state, message: { text, tone: ok ? (text.startsWith("ok") || /^(opened|focused)\b/.test(text) ? "ok" : "info") : "error" } };
    return false;
  }

  const signal = ctx.deps.signal;
  try {
    while (!signal?.aborted) {
      if (!view) {
        try {
          view = await projectView(ctx);
          model = cockpitModel(view, options);
          if (cockpit) await labelPanes(cockpit, inboxItemsInOrder(view), 3 * interval);
        } catch (err) {
          state = { ...state, message: { text: `cannot read the inbox: ${(err as Error).message}`, tone: "error" } };
        }
      }
      if (model) ctx.log(`${CLEAR}${renderCockpit(model, state, look())}`);
      frames++;
      pending ??= chunks.next();
      const got = await Promise.race([pending, sleep(interval, signal)]);
      if (signal?.aborted) break;
      if (got === null) {
        view = null; // fresh data on the interval; the read stays pending
        continue;
      }
      pending = null;
      if (got.done || !model) break;
      let quit = false;
      for (const key of parseKeys(got.value)) {
        const step = handleKey(state, key, model, look());
        state = clampScroll(model, step.state, look());
        if (step.effect && (await act(step.effect))) {
          quit = true;
          break;
        }
      }
      if (quit) break;
    }
  } finally {
    close();
  }
  return { frames, last };
}

export const cockpitCommand = defineCommand({
  name: "cockpit",
  summary: "What needs you and every story, with the actions each offers: approve, answer, orient, go to the agent",
  usage: "norn cockpit [--interval 5s] [--json] [--next] [--open]",
  options: { interval: { type: "string" }, next: { type: "boolean" }, open: { type: "boolean" } },
  // CP13: located below, falling back to the last repository a cockpit ran in
  repo: false,
  async run(raw, args) {
    const intervalRaw = opt.str(args, "interval") ?? "5s";
    let interval: number;
    try {
      interval = parseDuration(intervalRaw);
    } catch {
      throw usageError(`bad --interval '${intervalRaw}' (use e.g. 5s, 1m)`, "norn cockpit --interval 5s");
    }
    const ctx = await located(raw);
    writeCockpitFile(ctx.home, { last_repo: ctx.root });

    if (opt.bool(args, "open")) {
      const opened = await herdr.openCockpitPane(ctx.cwd, { env: ctx.env, ...(opt.str(args, "interval") ? { interval: intervalRaw } : {}) });
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
    if (args.json) return cockpitModel(await projectView(ctx), { places: !!cockpitHerdr(ctx), provider: ctx.config.remote.provider });
    return interactive(ctx, interval);
  },
});
