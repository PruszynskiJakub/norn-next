/**
 * `norn run attach <unit> | --next`: bring the pane of a unit's live run in front (its herdr tab and
 * workspace). `--next` picks the agent that has waited on the person longest whose pane can be brought
 * in front here: a question or a prompt in its pane, or an attended run. Nothing to attach to (no live
 * run, a runner with no pane, a run launched on another machine, a pane gone, a unit not on the record)
 * is refused `nothing_to_attach`, with what to do instead.
 * Presentation only: nothing is recorded.
 */
import { attachNext, attachUnit, NOTHING_TO_ATTACH } from "../cockpit/attach.ts";
import { defineCommand, opt } from "../command.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { loadProjectView } from "../views.ts";

const USAGE = "norn run attach <unit> | norn run attach --next";

export const runAttachCommand = defineCommand({
  name: "run attach",
  summary: "Bring the pane of a unit's live run in front; --next: the agent waiting for you longest",
  usage: USAGE,
  options: { next: { type: "boolean" } },
  optionHelp: { "--next": "the agent that has waited on you longest, without naming it" },
  positionals: { max: 1 },
  async run(ctx, args) {
    const next = opt.bool(args, "next");
    const named = args.positionals[0];
    if (next === (named !== undefined)) throw usageError(next ? "--next picks the unit itself: leave the unit out" : "name the unit, or pass --next", USAGE);
    const env = await ctx.runtimeEnv();
    const view = await loadProjectView(env, { local: true });
    if (named === undefined) {
      const done = await attachNext(env, view);
      return rendered(done, `Focused the pane of ${done.unit} run ${done.run}.`);
    }
    const unit = named;
    const known = view.stories.flatMap((s) => s.units).find((u) => u.id === unit);
    if (!known) throw refuse(`${unit} is not a unit on this machine's record`, "norn status", NOTHING_TO_ATTACH);
    const done = await attachUnit(env, unit, known.waiting?.next);
    return rendered(done, `Focused the pane of ${done.unit} run ${done.run}.`);
  },
});
