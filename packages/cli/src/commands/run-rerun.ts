/**
 * `norn run rerun [<unit>] [--step <step>] [--reset <counter>]… [--reason "…"]` (B48, B49, O2, W4, W7,
 * GR7): resume a stuck or parked unit (a gate or an ask included) at its step in a fresh session,
 * optionally at another step of its pinned workflow and with counters reset (journaled in the
 * receipt). A running unit is refused: stopping it is `norn run cancel` (B50). Claim free: acquired
 * here (T8); held elsewhere: mailbox (T9).
 */
import { cmd, nextCommand, stepOf } from "@norn/core";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget as resolveUnit, runHumanVerb } from "../runtime/human.ts";
import { inState, targetKey } from "../runtime/target.ts";

const blocked = (st: { status: string }) => st.status === "stuck" || st.status === "parked";

export const runRerunCommand = defineCommand({
  name: "run rerun",
  summary: "Resume a stuck, parked or gate-waiting unit in a fresh session, optionally --step elsewhere and --reset counters",
  usage: 'norn run rerun [<unit>] [--step <step>] [--reset <counter>]… [--reason "…"]',
  options: { step: { type: "string" }, reset: { type: "string", multiple: true }, reason: { type: "string" } },
  optionHelp: {
    "--step <step>": "move the unit to another step of its pinned workflow",
    "--reset <counter>": "reset a workflow counter to 0 (repeatable)",
    '--reason "…"': "why, journaled in the receipt",
  },
  positionals: { max: 1 },
  async run(ctx, args) {
    const to = opt.str(args, "step");
    const reset = [...new Set(opt.list(args, "reset"))];
    const reason = opt.str(args, "reason")?.trim();
    const key = await targetKey(ctx, args.positionals[0], args.json === true, inState("run rerun", (k) => cmd.runRerun(k), "Nothing is stuck, parked or at a gate", blocked));
    const t = await resolveUnit(ctx, key, blocked);
    return runHumanVerb(ctx, t, {
      verb: "run rerun",
      mailbox: true,
      check(t, st) {
        // B50: stopping an agent is always its own, explicit act
        if (st.status === "running") throw refuse(`${t.key} is running ${at(st)}; stop it first`, cmd.runCancel(t.key), "running");
        if (!blocked(st)) throw refuse(`${t.key} is not stuck: it is at ${at(st)}`, nextCommand(t.key, st) ?? cmd.storyView(t.story), "not_stuck");
        const wf = t.workflow;
        if (!wf) throw refuse(`${t.key} has no readable pinned workflow`, cmd.runView(t.key, { why: true }), "workflow_missing");
        const steps = Object.keys(wf.steps);
        if (to !== undefined && !stepOf(wf, to))
          throw refuse(`no step '${to}' in ${t.key}'s pinned workflow ${wf.name}`, cmd.runRerun(t.key, { step: `<${steps.join("|")}>` }), "unknown_step");
        if (to === undefined && !stepOf(wf, st.step))
          throw refuse(`step '${st.step}' no longer exists in workflow ${wf.name} (S7)`, cmd.runRerun(t.key, { step: `<${steps.join("|")}>` }), "unknown_step");
        const declared = Object.keys(wf.counters ?? {});
        const unknown = reset.filter((c) => !declared.includes(c));
        if (unknown.length)
          throw refuse(
            `unknown counter(s) ${unknown.join(", ")} in workflow ${wf.name}`,
            declared.length ? cmd.runRerun(t.key, { reset: `<${declared.join("|")}>` }) : cmd.runRerun(t.key),
            "unknown_counter",
          );
      },
      build: (t, st) =>
        humanReceipt(ctx, t, st, "unstick", { ...(to ? { to } : {}), ...(reset.length ? { reset } : {}), ...(reason ? { comment: reason } : {}) }),
    });
  },
});
