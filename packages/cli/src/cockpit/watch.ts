/**
 * `norn status --watch`: the cockpit model drawn full screen in the person's terminal, with raw keys.
 * It writes only through norn commands run in-process, the ones a person would type, and stays open
 * until q or Esc, or until the terminal's input ends (one frame for a stdin that is not a terminal).
 * Frames go to stderr; one JSON summary goes to stdout at the end.
 *
 * What a frame shows is read from this machine's record every interval; the item, change and intake
 * reads that call the code host are made at start, on `r`, after a command, and every `REMOTE_EVERY_MS`,
 * so a cockpit left open does not call the code host for every story every few seconds.
 */
import type { RuntimeEnv } from "@norn/runtime";
import { opt, type ParsedArgs } from "../command.ts";
import type { CliContext } from "../context.ts";
import { gateNotes, type OpenNote } from "../notes.ts";
import { refuse, toFailure } from "../output.ts";
import { loadProjectView, type ProjectView } from "../views.ts";
import { attachUnit } from "./attach.ts";
import { insideHerdr, labelStories } from "./labels.ts";
import { type CockpitModel, cockpitModel, withInput } from "./model.ts";
import { clampScroll, handleKey, initialState, type Look, parseKeys, renderCockpit, type TuiEffect, type TuiState } from "./tui.ts";

const CLEAR = "\x1b[H\x1b[2J";
/** The code host is asked about items, changes and intake at most this often, besides `r` and after a command. */
export const REMOTE_EVERY_MS = 60_000;

/** Whether a run's pane can be brought in front, by its executor. */
export const placesOf =
  (env: RuntimeEnv) =>
  (executor: string): boolean =>
    env.launcher.modesOf?.(executor)?.focus === true;

/** The local view with what the last full read learned from the code host laid over it. */
export function withRemote(local: ProjectView, full: ProjectView | null): ProjectView {
  if (!full) return local;
  const remote = new Map(full.stories.map((s) => [s.key, s]));
  const stories = local.stories.map((s) => {
    const r = remote.get(s.key);
    return r ? { ...s, title: r.title, url: r.url, open: r.open, change: r.change } : s;
  });
  return { ...local, stories, intake: full.intake.filter((i) => !local.stories.some((s) => s.key === i.key)) };
}

async function notesOf(env: RuntimeEnv, view: ProjectView): Promise<OpenNote[]> {
  const out: OpenNote[] = [];
  for (const s of view.stories) out.push(...(await gateNotes(env, s).catch(() => [])));
  return out;
}

/** A norn command in-process, as a person would type it (loaded lazily: the dispatcher imports this module's command). */
async function runVerb(ctx: CliContext, argv: string[], json: boolean): Promise<{ exit: number; value: unknown; stdout: string }> {
  const { runCli } = await import("../cli.ts");
  const { terminal: _, log: __, ...io } = ctx.io;
  return runCli(json ? [...argv, "--json"] : argv, io);
}

/** One line for a command's outcome on the footer. */
export function verbMessage(argv: readonly string[], exit: number, value: unknown): string {
  const what = `norn ${argv.filter((a) => !a.startsWith("-")).slice(0, 3).join(" ")}`;
  if (exit === 0) return `ok: ${what}`;
  const v = value as { error?: string; do_instead?: string } | null;
  return `refused: ${what} — ${v?.error ?? `exit ${exit}`}${v?.do_instead ? ` (${v.do_instead})` : ""}`;
}

const localClock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve(null);
    };
    const timer = setTimeout(done, ms);
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface WatchSummary {
  frames: number;
  last: { action: string; unit: string; ok: boolean } | null;
}

/** The cockpit until the person quits; `interval` is how often a frame is read again. */
export async function watchCockpit(ctx: CliContext, env: RuntimeEnv, interval: number): Promise<WatchSummary> {
  const term = ctx.io.terminal?.();
  if (!term) throw refuse("no terminal to draw the cockpit in", "norn status --watch --json", "no_terminal");
  const repo = env.ctx.repo.root;
  const places = placesOf(env);
  const herdr = insideHerdr(ctx.env);
  const log = ctx.io.log ?? (() => {});
  const keys = term.keys[Symbol.asyncIterator]();
  let state: TuiState = initialState();
  let full: ProjectView | null = null;
  let fullAt = Number.NEGATIVE_INFINITY;
  let model: CockpitModel | null = null;
  let stale = true;
  let pending: Promise<IteratorResult<string>> | null = null;
  let last: WatchSummary["last"] = null;
  let frames = 0;
  const nowMs = () => Date.parse(env.ctx.now());
  const look = (): Look => ({ width: term.columns, height: term.rows, color: term.color, clock: localClock(nowMs()), version: ctx.version });

  async function read(): Promise<void> {
    try {
      if (nowMs() - fullAt >= REMOTE_EVERY_MS) {
        full = await loadProjectView(env);
        fullAt = nowMs();
      }
      const view = withRemote(await loadProjectView(env, { local: true }), full);
      model = cockpitModel(view, { repo, places, notes: await notesOf(env, view) });
      if (herdr) await labelStories(env, view, 3 * interval);
    } catch (e) {
      state = { ...state, message: { text: `cannot read the stories: ${toFailure(e).body.error}`, tone: "error" } };
    }
  }

  /** One effect; true when the cockpit is done. */
  async function act(e: TuiEffect): Promise<boolean> {
    if (e.kind === "quit") return true;
    if (e.kind === "refresh") {
      fullAt = Number.NEGATIVE_INFINITY;
      stale = true;
      return false;
    }
    const fx = e.action.effect;
    let text: string;
    let ok: boolean;
    if (fx.kind === "verb") {
      const argv = withInput(fx.argv, e.input ?? "");
      const r = await runVerb(ctx, argv, !fx.show);
      ok = r.exit === 0;
      if (fx.show && ok) state = { ...state, shown: r.stdout, scroll: 0 };
      text = fx.show && ok ? `norn ${argv.join(" ")} — esc closes it` : verbMessage(argv, r.exit, r.value);
      if (!fx.show) {
        // a command changed what needs the person, and may have changed what the code host knows
        fullAt = Number.NEGATIVE_INFINITY;
        stale = true;
      }
    } else if (fx.kind === "link") {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      const r = await env.ctx.exec([opener, fx.url]).catch((err: Error) => ({ code: 1, stderr: err.message }));
      ok = r.code === 0;
      text = ok ? `opened ${fx.url}` : `could not open ${fx.url}: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`;
    } else {
      try {
        await attachUnit(env, fx.unit);
        ok = true;
        text = `focused the pane of ${fx.unit}`;
      } catch (err) {
        ok = false;
        const f = toFailure(err).body;
        text = `cannot go to ${fx.unit}'s pane: ${f.error}`;
      }
    }
    last = { action: e.action.id, unit: e.row.unit, ok };
    state = { ...state, message: { text, tone: ok ? "ok" : "error" } };
    return false;
  }

  const signal = ctx.io.signal;
  try {
    while (!signal?.aborted) {
      if (stale) {
        await read();
        stale = false;
      }
      if (model) log(`${CLEAR}${renderCockpit(model, state, look())}`);
      frames++;
      pending ??= keys.next();
      const got = await Promise.race([pending, pause(interval, signal)]);
      if (signal?.aborted) break;
      if (got === null) {
        stale = true;
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
    term.close();
  }
  return { frames, last };
}

/** `--pane`: the cockpit in a pane below the asking one, through the first runner that opens panes. */
export async function openCockpitPane(ctx: CliContext, env: RuntimeEnv, args: ParsedArgs): Promise<{ opened: true; pane: string }> {
  if (!env.launcher.split) throw refuse("this launcher opens no pane", "norn status --watch", "no_pane_runner");
  const interval = opt.str(args, "interval");
  const argv = [...ctx.io.self, "status", "--watch", ...(interval ? ["--interval", interval] : [])];
  const beside = ctx.env.HERDR_PANE_ID;
  const home = ctx.env.NORN_HOME_DIR;
  const opened = await env.launcher.split({ argv, cwd: env.ctx.repo.root, title: "norn", ...(home ? { env: { NORN_HOME_DIR: home } } : {}), ...(beside ? { beside } : {}) });
  if (!opened.ok) throw refuse(opened.failure.message, "norn status --watch", opened.failure.code === "invalid" ? "no_pane_runner" : "pane_failed");
  return { opened: true, pane: opened.value.handle };
}
