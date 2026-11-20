/**
 * The built-in clock signal source: `timeout` once the story's visit to its waiting step is older
 * than the `on:` entry's `after:`. The occurrence is the visit (`ready#3`), so it fires once per
 * visit, and coming back to the step is a new visit with a fresh `after:`. The time is the host's
 * clock, read through the context, never the process's.
 */
import { BUILTIN_SIGNALS, fail, ok, type SignalSourceDefinition } from "@norn/plugin-api";
import { parseDuration } from "@norn/schema";
import type { TSchema } from "@sinclair/typebox";

const CLOCK = "clock";

export const clockSignalSource: SignalSourceDefinition<TSchema> = {
  params: BUILTIN_SIGNALS.timeout?.params as TSchema,
  read: async (input, params, ctx) => {
    const after = (params as { after?: unknown } | undefined)?.after;
    if (typeof after !== "string") return fail("invalid", "timeout needs after:", false);
    let ms: number;
    try {
      ms = parseDuration(after);
    } catch (e) {
      return fail("invalid", `timeout after: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    const since = Date.parse(input.since);
    const now = Date.parse(ctx.now());
    if (Number.isNaN(since) || Number.isNaN(now)) return fail("invalid", `timeout cannot measure from ${input.since} to ${ctx.now()}`, false);
    // `at` is the moment it fell due, the same on every tick and machine, never the moment it was seen
    return ok(now - since >= ms ? { type: "timeout", source: CLOCK, id: input.visit, at: new Date(since + ms).toISOString() } : null);
  },
};
