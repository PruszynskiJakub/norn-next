/**
 * `norn story wait <story|slice> --until <condition> [--timeout <d>] [--interval <d>]` (gh-175, P8):
 * blocks until the condition holds on the unit's state as this checkout sees it, then prints that
 * state as JSON — for a supervisor (a person's script or an agent) that guides a story from
 * outside. Conditions are `@norn/view`'s `parseWaitCondition`: `step=<name>`, `gate`, `ask`,
 * `stuck`, `done` (the round ended), `merged`. Read only (X1): it ticks nothing, so something else
 * (`norn watch`, cron) moves the story; the PR state is what the last sync tick saw.
 *
 * Exit codes tell the endings apart, so a caller branches on the code, never on text (P8): 0 the
 * condition holds, `timeout` (7) the time ran out or the wait was stopped (the state is printed all
 * the same), `usage` (2) a bad condition or duration, `refused` (3) an unknown story or slice.
 */
import { cmd } from "@norn/core";
import { ExitCode, parseDuration } from "@norn/schema";
import { formatWaitCondition, parseWaitCondition, WAIT_CONDITIONS, type WaitCondition, waitMet, waitState } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, usageError, withExit } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { projectView } from "../runtime/human.ts";

const DEFAULT_POLL = "5s";

function duration(args: Parameters<typeof opt.str>[0], name: string, fallback: string | undefined, example: string): number | null {
  const raw = opt.str(args, name) ?? fallback;
  if (raw === undefined) return null;
  try {
    const ms = parseDuration(raw);
    if (ms > 0) return ms;
  } catch {}
  throw usageError(`bad --${name} '${raw}' (use e.g. 30s, 10m)`, example);
}

async function stateOf(ctx: Context, key: string) {
  const s = waitState(await projectView(ctx), key);
  if (!s) throw refuse(`unknown story or slice ${key}`, cmd.status(), "unknown_unit");
  return s;
}

export const storyWaitCommand = defineCommand({
  name: "story wait",
  version: "reads",
  summary: "Block until a story reaches a step, a gate, an ask, stuck, done or merged; exit 0 met, 7 timed out",
  usage: "norn story wait <story|slice> --until <step=<name>|gate|ask|stuck|done|merged> [--timeout <d>] [--interval <d>]",
  optionHelp: {
    "--until <condition>": `what to wait for: ${WAIT_CONDITIONS.join(", ")}; gate, ask and stuck on a story also hold for its slices`,
    "--timeout <d>": "give up after this long (e.g. 30m) and exit 7; default: wait until it holds",
    "--interval <d>": `how often to look again (default ${DEFAULT_POLL})`,
  },
  options: { until: { type: "string" }, timeout: { type: "string" }, interval: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { key } = parseUnitKey(args.positionals[0] as string);
    const raw = opt.str(args, "until");
    const until: WaitCondition | null = raw === undefined ? null : parseWaitCondition(raw);
    if (!until) throw usageError(raw === undefined ? "--until is required" : `bad --until '${raw}' (use ${WAIT_CONDITIONS.join(", ")})`, cmd.storyWait(key, "gate"));
    const timeout = duration(args, "timeout", undefined, cmd.storyWait(key, formatWaitCondition(until), { timeout: "30m" }));
    const interval = duration(args, "interval", DEFAULT_POLL, cmd.storyWait(key, formatWaitCondition(until))) as number;
    const signal = ctx.deps.signal;
    const started = ctx.clock.now();
    for (;;) {
      const state = await stateOf(ctx, key);
      const matched = waitMet(state, until);
      const waited_ms = ctx.clock.now() - started;
      const out = { met: matched !== null, until: formatWaitCondition(until), matched, waited_ms, state };
      if (matched !== null) return out;
      const left = timeout === null ? interval : timeout - waited_ms;
      if (left <= 0 || signal?.aborted) return withExit(out, ExitCode.timeout);
      await ctx.sleep(Math.min(interval, left), signal);
    }
  },
});
