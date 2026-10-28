/**
 * `norn run attach [<unit>] [--next]` (B46, B47, HC6, HC10): focus the Herdr agent pane of a unit's live
 * run. A unit with no live pane (or no Herdr) is refused `nothing_to_attach`, with the unit's start
 * command when it has one. Without a target it resolves as every verb does (B54–B60), offering only the
 * units with a live pane. `--next` focuses the oldest Your turn item with a run, without prompting.
 * Presentation only — never a fact for decide (HC13).
 */
import { herdr } from "@norn/adapters";
import { cmd } from "@norn/core";
import { inboxItemsInOrder, type InboxEntry } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { cockpitHerdr, oldestYourTurn } from "../runtime/cockpit.ts";
import { projectView } from "../runtime/human.ts";
import { targetKey } from "../runtime/target.ts";

const unitOf = (i: InboxEntry) => i.slice ?? i.story;

/** HC10: one shot — the oldest Your turn item with a run; never starts an agent. */
async function next(items: readonly InboxEntry[], cockpit: herdr.HerdrCockpit | null, agents: readonly herdr.HerdrAgent[]) {
  const oldest = oldestYourTurn(items, true);
  if (!oldest) throw refuse("No agent waits for you", cmd.status(), "nothing_to_attach");
  const pane = herdr.findAgentPane(agents, oldest.reach);
  if (!cockpit || !pane) throw refuse(`no live agent pane for ${unitOf(oldest)}${cockpit ? "" : " (not inside Herdr)"}`, oldest.command, "nothing_to_attach");
  await cockpit.focus(pane);
  return { focused: pane, item: oldest.id };
}

export const runAttachCommand = defineCommand({
  name: "run attach",
  summary: "Focus the Herdr agent pane of a unit's live run; --next: the oldest one waiting for you (B46, B47)",
  usage: "norn run attach [<unit>] | norn run attach --next",
  optionHelp: { "--next": "the agent pane of the oldest Your turn item, without prompting" },
  options: { next: { type: "boolean" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    const cockpit = cockpitHerdr(ctx);
    const agents = cockpit ? await cockpit.listAgents().catch(() => []) : [];
    const items = inboxItemsInOrder(await projectView(ctx));
    if (opt.bool(args, "next")) {
      if (args.positionals[0]) throw usageError("--next picks the unit itself: leave the unit out", cmd.runAttach(undefined, { next: true }));
      return next(items, cockpit, agents);
    }
    // HC6: the live pane of each unit, from the reach its inbox items carry
    const paneOf = new Map<string, string>();
    for (const i of items) {
      const pane = herdr.findAgentPane(agents, i.reach);
      if (pane && !paneOf.has(unitOf(i))) paneOf.set(unitOf(i), pane);
    }
    const target = await targetKey(ctx, args.positionals[0], args.json === true, {
      verb: "run attach",
      applies: (key) => paneOf.has(key),
      none: "No unit has a live agent pane",
      command: (key) => cmd.runAttach(key),
    });
    const key = parseUnitKey(target).key;
    const pane = paneOf.get(key);
    if (!cockpit || !pane) {
      // B46: the unit's start command, when it has one (a Your turn item carries it)
      const start = items.find((i) => unitOf(i) === key && i.group === "your_turn")?.command;
      throw refuse(`${key} has no live agent pane${cockpit ? "" : " (not inside Herdr)"}`, start ?? cmd.status(), "nothing_to_attach");
    }
    await cockpit.focus(pane);
    return { unit: key, focused: pane };
  },
});
