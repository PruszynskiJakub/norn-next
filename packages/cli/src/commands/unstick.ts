/**
 * `norn unstick <unit> [--to <step>] [--reset <counter>]…` (O2, W4, W7, GR7): resume a stuck or
 * parked unit, optionally at another step of its pinned workflow and with counters reset
 * (journaled in the receipt). Claim free: acquired here (T8); held elsewhere: mailbox (T9).
 */
import { cmd, nextCommand, stepOf } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";

const blocked = (st: UnitState) => st.status === "stuck" || st.status === "parked";

export const unstickCommand = defineCommand({
  name: "unstick",
  summary: "Resume a stuck unit, optionally --to a step and --reset counters (O2, W4)",
  usage: 'norn unstick <unit> [--to <step>] [--reset <counter>]… [--reason "…"]',
  options: { to: { type: "string" }, reset: { type: "string", multiple: true }, reason: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const to = opt.str(args, "to");
    const reset = [...new Set(opt.list(args, "reset"))];
    const reason = opt.str(args, "reason")?.trim();
    const t = await resolveTarget(ctx, args.positionals[0] as string, (st) => st.status === "stuck");
    return runHumanVerb(ctx, t, {
      verb: "unstick",
      mailbox: true,
      check(t, st) {
        if (!blocked(st)) throw refuse(`${t.key} is not stuck: it is at ${at(st)}`, nextCommand(t.key, st) ?? cmd.status(t.story), "not_stuck");
        const wf = t.workflow;
        if (!wf) throw refuse(`${t.key} has no readable pinned workflow`, cmd.why(t.key), "workflow_missing");
        const steps = Object.keys(wf.steps);
        if (to !== undefined && !stepOf(wf, to))
          throw refuse(`no step '${to}' in ${t.key}'s pinned workflow ${wf.name}`, cmd.unstick(t.key, { to: `<${steps.join("|")}>` }), "unknown_step");
        if (to === undefined && !stepOf(wf, st.step))
          throw refuse(`step '${st.step}' no longer exists in workflow ${wf.name} (S7)`, cmd.unstick(t.key, { to: `<${steps.join("|")}>` }), "unknown_step");
        const declared = Object.keys(wf.counters ?? {});
        const unknown = reset.filter((c) => !declared.includes(c));
        if (unknown.length)
          throw refuse(
            `unknown counter(s) ${unknown.join(", ")} in workflow ${wf.name}`,
            declared.length ? cmd.unstick(t.key, { reset: `<${declared.join("|")}>` }) : cmd.unstick(t.key),
            "unknown_counter",
          );
      },
      build: (t, st) =>
        humanReceipt(ctx, t, st, "unstick", { ...(to ? { to } : {}), ...(reset.length ? { reset } : {}), ...(reason ? { comment: reason } : {}) }),
    });
  },
});
