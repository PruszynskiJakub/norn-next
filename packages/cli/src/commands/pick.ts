/**
 * `norn pick [--interval 5s]`: a raw-key picker for a Herdr overlay (`plugins/herdr`, action
 * `norn.pick`). Rows: the inbox items that need you, then one per story; type to filter, ↑↓ to move,
 * the right side previews the story. enter → `norn orient <story> --open`; ⌃o opens the PR in the
 * browser (`gh pr view <branch> --web` / `glab mr view <branch> --web`); ⌃y approves a gate; ⌃g goes
 * to the item's agent pane; ⌃t takes an unclaimed story; ⌃r refreshes; esc quits. Every action keeps
 * the picker open with its outcome on the last line; only esc closes it. Writes only through CLI
 * verbs (X1). Frames go to stderr, one JSON summary (the last action) to stdout at exit (P8).
 */
import { parseDuration } from "@norn/schema";
import type { ProjectView } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { usageError } from "../output.ts";
import { cockpitHerdr, goTo, verbMessage } from "../runtime/cockpit.ts";
import { projectView } from "../runtime/human.ts";
import { parseKeys, type PickEffect, type PickState, pickKey, pickRows, renderPick } from "../runtime/pick.ts";

const CLEAR = "\x1b[H\x1b[2J";

/** Raw key chunks: the injected input, else stdin in raw mode (restored on `close`). */
function keyChunks(ctx: Context): { chunks: AsyncIterator<string>; close: () => void } {
  if (ctx.deps.input) return { chunks: ctx.deps.input[Symbol.asyncIterator](), close: () => {} };
  const stdin = process.stdin;
  const raw = stdin.isTTY;
  if (raw) stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  const it = (stdin as AsyncIterable<string>)[Symbol.asyncIterator]();
  return {
    chunks: it,
    close: () => {
      if (raw) stdin.setRawMode(false);
      stdin.pause();
    },
  };
}

async function spawnShell(argv: string[], cwd: string): Promise<{ code: number; stderr: string }> {
  try {
    const child = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    return { code, stderr };
  } catch (e) {
    return { code: 127, stderr: (e as Error).message };
  }
}

async function runVerb(ctx: Context, argv: string[]): Promise<{ exit: number; value: unknown }> {
  const { runCli } = await import("../cli.ts");
  return runCli([...argv, "--json"], { ...ctx.deps, cwd: ctx.cwd, env: ctx.env, log: () => {} });
}

function sleep(ms: number): Promise<null> {
  return new Promise((r) => {
    const t = setTimeout(() => r(null), ms);
    (t as { unref?: () => void }).unref?.();
  });
}

export const pickCommand = defineCommand({
  name: "pick",
  summary: "Pick a story or an item that needs you, in a Herdr popup: orient, open the PR, approve, go to the agent",
  usage: "norn pick [--interval 5s]",
  options: { interval: { type: "string" } },
  async run(ctx, args) {
    const raw = opt.str(args, "interval") ?? "5s";
    let interval: number;
    try {
      interval = parseDuration(raw);
    } catch {
      throw usageError(`bad --interval '${raw}' (use e.g. 5s, 1m)`, "norn pick --interval 5s");
    }
    const provider = ctx.config.remote.provider;
    const cockpit = cockpitHerdr(ctx);
    const { chunks, close } = keyChunks(ctx);
    let state: PickState = { query: "", cursor: 0, message: null };
    let view: ProjectView | null = null;
    let picked: { action: string; story?: string; ok: boolean } | null = null;
    let pending: Promise<IteratorResult<string>> | null = null;
    let frames = 0;
    const look = () => ({
      width: Number(ctx.env.COLUMNS) || process.stderr.columns || 100,
      height: Number(ctx.env.LINES) || process.stderr.rows || 30,
      color: !!process.stderr.isTTY && ctx.env.NO_COLOR === undefined && ctx.env.TERM !== "dumb",
    });

    /** The effect of a key; true = the picker is done. */
    async function act(effect: PickEffect): Promise<boolean> {
      switch (effect.kind) {
        case "quit":
          return true;
        case "refresh":
          view = null;
          return false;
        case "orient": {
          const r = await runVerb(ctx, ["orient", effect.story, "--open"]);
          const opened = r.value as { created?: boolean; workspace_id?: string } | null;
          picked = { action: "orient", story: effect.story, ok: r.exit === 0 };
          state = {
            ...state,
            message: r.exit !== 0 ? verbMessage(["orient", effect.story], r.exit, r.value) : opened?.workspace_id ? `${opened.created ? "opened" : "focused"} ${effect.story} orient (${opened.workspace_id})` : `$ ${(r.value as { command?: string }).command ?? ""}`,
          };
          return false;
        }
        case "pr": {
          const r = await (ctx.deps.shell ?? spawnShell)(effect.argv, ctx.root);
          picked = { action: "pr", story: effect.story, ok: r.code === 0 };
          state = { ...state, message: r.code === 0 ? `opened the PR of ${effect.story} in the browser` : `could not open the PR: ${effect.argv.join(" ")} — ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}` };
          return false;
        }
        case "go": {
          const text = await goTo(cockpit, effect.item, ctx.cwd).catch((e: Error) => `could not go there: ${e.message}`);
          picked = { action: "go", story: effect.item.story, ok: /^(focused|started)\b/.test(text) };
          state = { ...state, message: text };
          return false;
        }
        case "verb": {
          const r = await runVerb(ctx, effect.argv);
          picked = { action: effect.argv[0] as string, story: effect.argv[1], ok: r.exit === 0 };
          state = { ...state, message: verbMessage(effect.argv, r.exit, r.value) };
          view = null; // the verb changed what needs you
          return false;
        }
      }
    }

    try {
      for (;;) {
        if (!view) {
          try {
            view = await projectView(ctx);
          } catch (e) {
            state = { ...state, message: `cannot read the inbox: ${(e as Error).message}` };
          }
        }
        const rows = view ? pickRows(view) : [];
        if (view) ctx.log(`${CLEAR}${renderPick(view, rows, state, { ...look(), provider, now: ctx.clock.now() })}`);
        frames++;
        pending ??= chunks.next();
        const got = await Promise.race([pending, sleep(interval)]);
        if (got === null) {
          view = null; // redraw on the interval with fresh data; the read stays pending
          continue;
        }
        pending = null;
        if (got.done) break;
        let finished = false;
        for (const key of parseKeys(got.value)) {
          const step = pickKey(state, key, rows, { provider, branchOf: (s) => view?.stories.find((x) => x.key === s)?.branch ?? null });
          state = step.state;
          if (step.effect && (await act(step.effect))) {
            finished = true;
            break;
          }
        }
        if (finished) break;
      }
    } finally {
      close();
    }
    return { frames, ...(picked ?? { action: "none", ok: true }) };
  },
});
