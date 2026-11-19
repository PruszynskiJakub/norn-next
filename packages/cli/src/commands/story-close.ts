/**
 * `norn story close <key>`: close a story and stop its runs.
 * Closes the tracker item; the next tick reads the closed item, stops the story's live runs and
 * ends its units, so stopping goes through the kernel's own rule and its receipts.
 */
import { parseStoryKey } from "@norn/plugin-api";
import { ulid } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { failure, refuse, rendered } from "../output.ts";

export const storyCloseCommand = defineCommand({
  name: "story close",
  acts: true,
  summary: "Close a story and stop its runs",
  usage: "norn story close <key>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const env = await ctx.runtimeEnv();
    const tracker = env.slots.tracker;
    const parsed = parseStoryKey(key, tracker.keyPrefix);
    if (!parsed) throw refuse(`${key} is not a story key of the ${tracker.name} tracker (${tracker.keyPrefix}-<n>)`, "norn story list", "unknown_story");
    if (!tracker.capabilities.close) throw refuse(`the ${tracker.name} tracker cannot close an item`, `close ${key} where the tracker keeps it`, "unsupported");
    const item = await tracker.get(parsed.id);
    if (!item.ok) throw failure(`cannot read ${key}: ${item.failure.message}`, "try again", item.failure.code);
    if (!item.value) throw refuse(`the ${tracker.name} tracker has no ${key}`, "norn story list", "unknown_story");
    const live: string[] = [];
    const units = await env.slots.store.listUnits({ story: key });
    for (const u of units.ok ? units.value : []) {
      const read = await env.journal.readUnit(u);
      if (read.ok && read.value.state?.run && read.value.state.ended === undefined) live.push(u);
    }
    if (item.value.open) {
      // closing twice is harmless, so a fresh id per call costs nothing and needs no record of its own
      const closed = await tracker.perform({ kind: "close", id: parsed.id }, { receipt_id: `close-${ulid()}` });
      if (!closed.ok) throw failure(`cannot close ${key}: ${closed.failure.message}`, `norn story close ${key} again`, closed.failure.code);
    }
    const value = { key, closed: true, was_open: item.value.open, stopping: live };
    const runs = live.length ? ` The next tick stops the live runs of ${live.join(", ")} and ends the story.` : " The next tick ends the story.";
    return rendered(value, `Closed ${key}.${runs}`);
  },
});
