/**
 * `norn approve <unit> [--reject] [--reason "…"]` (O2, W2 gate): decide the gate a unit waits at.
 * Writes an `approve` or `reject` receipt at the cursor. Claim free: acquired here (T8); held
 * elsewhere: posted to the mailbox (T9).
 */
import { nextCommand, stepOf } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";

const atGate = (st: UnitState) => st.status === "parked" && st.park?.kind === "gate";

export const approveCommand = defineCommand({
  name: "approve",
  summary: "Approve (or --reject) the gate a unit waits at (O2)",
  usage: 'norn approve <unit> [--reject] [--reason "…"]',
  options: { reject: { type: "boolean" }, reason: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const kind = opt.bool(args, "reject") ? "reject" : "approve";
    const reason = opt.str(args, "reason")?.trim();
    const t = await resolveTarget(ctx, args.positionals[0] as string, atGate);
    return runHumanVerb(ctx, t, {
      verb: "approve",
      mailbox: true,
      check(t, st) {
        const step = t.workflow ? stepOf(t.workflow, st.step) : null;
        if (step?.type !== "gate" || !atGate(st))
          throw refuse(
            `${t.key} is not waiting at a gate: ${st.step} is ${step ? `a ${step.type} step` : "not in its workflow"}, at ${at(st)}`,
            nextCommand(t.key, st) ?? `norn status ${t.story}`,
            "not_at_gate",
          );
      },
      build: (t, st) => humanReceipt(ctx, t, st, kind, reason ? { comment: reason } : {}),
    });
  },
});
