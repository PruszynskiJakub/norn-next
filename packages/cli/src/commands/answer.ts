/**
 * `norn answer <story|unit> "<text>"` (O2, C3): answer the question a unit is parked on. Writes an
 * `answer` receipt at the unit's cursor; the next tick delivers it into the same session or a
 * fresh one from the handoff (B2). Claim free: acquired here (T8); held elsewhere: mailbox (T9).
 */
import { nextCommand } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";

const asks = (st: UnitState) => st.status === "parked" && st.park?.kind === "ask";

export const answerCommand = defineCommand({
  name: "answer",
  summary: "Answer the question a unit is parked on (O2)",
  usage: 'norn answer <story|unit> "<text>"',
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [unit, raw] = args.positionals as [string, string];
    const text = raw.trim();
    if (!text) throw usageError("the answer is empty", 'norn answer <unit> "<text>"');
    const t = await resolveTarget(ctx, unit, asks);
    return runHumanVerb(ctx, t, {
      verb: "answer",
      mailbox: true,
      check(t, st) {
        if (!asks(st))
          throw refuse(`${t.key} is not waiting for an answer: it is at ${at(st)}`, nextCommand(t.key, st) ?? `norn status ${t.story}`, "not_parked_on_ask");
      },
      build: (t, st) => humanReceipt(ctx, t, st, "answer", { answer: text, ...(st.park?.receipt_id ? { ask_receipt_id: st.park.receipt_id } : {}) }),
    });
  },
});
