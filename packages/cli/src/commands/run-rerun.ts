/**
 * `norn run rerun [<unit>] [--step <step>] [--reset <counter>]… [--reason "…"]`:
 * resume a stuck or parked unit (a gate or an ask included) at its step in a fresh session,
 * optionally at another step of its pinned workflow and with counters reset (journaled in the
 * receipt). A running unit is refused: stopping it is `norn run cancel`, except a rerun at the
 * check whose fail sent the unit to its step: the check runs again on the same code and
 * the next tick stops that step's session. Claim free: acquired here; held elsewhere: mailbox.
 */
import { checkRetryOf, cmd, nextCommand, rerunnable, rerunWarning, stepOf } from "@norn/core";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { at, DELEGATED_HELP, DELEGATED_OPTION, delegatedFields, delegation, humanReceipt, type StepOnlyBuild, stepOnlyReceipt, resolveTarget as resolveUnit, runHumanVerb } from "../runtime/human.ts";
import { inState, targetKey } from "../runtime/target.ts";

export const runRerunCommand = defineCommand({
  name: "run rerun",
  version: "acts",
  summary: "Resume a stuck, parked or gate-waiting unit in a fresh session, optionally --step elsewhere and --reset counters",
  usage: 'norn run rerun [<unit>] [--step <step>] [--reset <counter>]… [--reason "…"] [--delegated]',
  options: { step: { type: "string" }, reset: { type: "string", multiple: true }, reason: { type: "string" }, ...DELEGATED_OPTION },
  optionHelp: {
    "--step <step>": "move the unit to another step of its pinned workflow",
    "--reset <counter>": "reset a workflow counter to 0 (repeatable)",
    '--reason "…"': "why, journaled in the receipt",
    ...DELEGATED_HELP,
  },
  positionals: { max: 1 },
  async run(ctx, args) {
    const to = opt.str(args, "step");
    const reset = [...new Set(opt.list(args, "reset"))];
    const d = delegation(ctx, args, "run rerun");
    const key = await targetKey(ctx, args.positionals[0], args.json === true, inState("run rerun", (k) => cmd.runRerun(k), "Nothing is stuck, parked or at a gate", rerunnable));
    // A `local` story held elsewhere: resume the step its last boundary led to, checked by the
    // holder; --step and --reset are checked against the pinned workflow, which only the holder has
    const stepOnly: StepOnlyBuild = (t, step) => {
      if (to !== undefined || reset.length)
        throw refuse(`${t.key}'s pinned workflow is on the machine that holds it: --step and --reset are checked there`, `${cmd.runRerun(t.key)} without --step and --reset, or ${cmd.storyCheckout(t.story, { force: true })}`, "story_not_local");
      return stepOnlyReceipt(ctx, t, step, "unstick", delegatedFields(d));
    };
    // With --step, a unit whose last outcome is that step's (a failed check) is a target too
    const t = await resolveUnit(ctx, key, (st) => rerunnable(st) || (to !== undefined && st.last_outcome?.step === to), { stepOnly });
    const res = await runHumanVerb(ctx, t, {
      verb: "run rerun",
      mailbox: true,
      check(t, st) {
        const wf = t.workflow;
        // A rerun at the check whose fail sent the unit here retries it on the same code
        const retry = to !== undefined && !!wf && checkRetryOf(wf, st) === to;
        // Otherwise stopping an agent is always its own, explicit act
        if (!retry && st.status === "running") throw refuse(`${t.key} is running ${at(st)}; stop it first`, cmd.runCancel(t.key), "running");
        if (!retry && !rerunnable(st)) throw refuse(`${t.key} is not stuck: it is at ${at(st)}`, nextCommand(t.key, st) ?? cmd.storyView(t.story), "not_stuck");
        if (!wf) throw refuse(`${t.key} has no readable pinned workflow`, cmd.runView(t.key, { why: true }), "workflow_missing");
        const steps = Object.keys(wf.steps);
        if (to !== undefined && !stepOf(wf, to))
          throw refuse(`no step '${to}' in ${t.key}'s pinned workflow ${wf.name}`, cmd.runRerun(t.key, { step: `<${steps.join("|")}>` }), "unknown_step");
        if (to === undefined && !stepOf(wf, st.step))
          throw refuse(`step '${st.step}' no longer exists in workflow ${wf.name}`, cmd.runRerun(t.key, { step: `<${steps.join("|")}>` }), "unknown_step");
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
        humanReceipt(ctx, t, st, "unstick", { ...(to ? { to } : {}), ...(reset.length ? { reset } : {}), ...delegatedFields(d) }),
    });
    // A counter left at its max closes its edge again; say so, with the way out
    const warning = t.state ? rerunWarning(t.key, t.state, { reset }) : null;
    return warning ? { ...res, warning } : res;
  },
});
