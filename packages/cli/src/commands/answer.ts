/**
 * `norn answer <story|unit> "<text>"` (O2, C3): answer the question a unit is parked on. Writes an
 * `answer` receipt at the unit's cursor; the next tick delivers it into the same session or a
 * fresh one from the handoff (B2). Claim free: acquired here (T8); held elsewhere: mailbox (T9).
 *
 * R6.2/R6.3 (H3, A4): an implicit ask from a pane prompt (permission or trust dialog) of a session
 * on this machine is answered here and now, with the keystrokes the prompt expects — the option
 * number + enter (arrows + enter for unnumbered menus), else the text + enter. The receipt is
 * written only after the keys went in (`delivered: true`, so the tick does not type them again).
 * A failed delivery writes no receipt, keeps the unit parked, is kept as the unit's act failure
 * (R4.3) and names how to reach the pane.
 */
import { cmd, nextCommand, optionIndex, optionsLine, promptKeys, type SessionRef } from "@norn/core";
import { type Receipt, ulid, type UnitState } from "@norn/schema";
import { machineHolder, readActFailures, writeActFailures } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { failure, refuse, usageError } from "../output.ts";
import { at, humanReceipt, resolveTarget, type Route, runHumanVerb, type Target } from "../runtime/human.ts";

const asks = (st: UnitState) => st.status === "parked" && st.park?.kind === "ask";

export const answerCommand = defineCommand({
  name: "answer",
  summary: "Answer the question a unit is parked on (O2); a prompt in an agent's pane gets the keys it expects (R6.2)",
  usage: 'norn answer <story|unit> "<text>"   (a choice prompt: the option number, e.g. "1")',
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [unit, raw] = args.positionals as [string, string];
    const text = raw.trim();
    if (!text) throw usageError("the answer is empty", 'norn answer <unit> "<text>"');
    const t = await resolveTarget(ctx, unit, asks);
    const out = await runHumanVerb(ctx, t, {
      verb: "answer",
      mailbox: true,
      check(t, st) {
        if (!asks(st))
          throw refuse(`${t.key} is not waiting for an answer: it is at ${at(st)}`, nextCommand(t.key, st) ?? cmd.status(t.story), "not_parked_on_ask");
      },
      build: (t, st) => humanReceipt(ctx, t, st, "answer", { answer: text, ...(st.park?.receipt_id ? { ask_receipt_id: st.park.receipt_id } : {}) }),
      before: (t, st, route, receipt) => typeIntoPrompt(ctx, t, st, route, receipt, text),
    });
    return out;
  },
});

/** R6.2/R6.3: type the answer into the pane prompt the unit is parked on, when its session is here. */
async function typeIntoPrompt(ctx: Context, t: Target, st: UnitState, route: Route, receipt: Receipt, text: string): Promise<Receipt> {
  const park = st.park;
  const run = st.run;
  // a mailbox answer is typed by the holder's tick (SessionInput keys); a hook-only ask takes text from the tick (B2)
  if (route.via !== "local" || park?.kind !== "ask" || park.implicit !== "pane" || !run?.session) return receipt;
  if (run.machine && run.machine !== machineHolder(ctx.env)) return receipt;
  const runner = (await ctx.ports()).runner;
  if (!runner || runner.name !== run.session.runner) return receipt;
  const session: SessionRef = { runner: run.session.runner, session_id: run.session.session_id, ...(run.session.pane_id ? { pane_id: run.session.pane_id } : {}), ...(run.process ? { process: run.process } : {}) };
  const reach = runner.reach?.(session) ?? null;
  const fail = (reason: string) => {
    // R4.3/R6.3: the unit stays parked; the failure is the unit's, shown on its Answer item
    const failures = readActFailures(ctx.root);
    failures[t.key] = { effect: "answer", rule: "answer.keys", reason: `answer to ${t.key} not delivered: ${reason}`, at: ctx.clock.iso(), tick_id: ulid(ctx.clock.now()), step: st.step, attempt: st.attempt, session: { runner: session.runner, session_id: session.session_id, ...(session.pane_id ? { pane_id: session.pane_id } : {}) } };
    writeActFailures(ctx.root, failures);
    return failure(`answer to ${t.key} not delivered: ${reason}`, reach ? `answer it in the pane: ${reach}` : `answer it in the agent's ${session.runner} session ${session.pane_id ?? session.session_id}`, "answer_not_delivered");
  };
  if (!runner.sendKeys) throw fail(`runner ${runner.name} cannot type into a prompt`);
  // the prompt as it is now: the agent may have moved on, or the menu may differ from the parked one
  const pane = await runner.paneState(session).catch(() => null);
  if (pane && pane.alive && pane.state !== "waiting_input" && pane.state !== "unknown")
    throw refuse(`${t.key}'s agent no longer waits on the prompt (pane is ${pane.state})`, `${cmd.tick()} (it records that the agent moved on, R6.1)`, "prompt_gone");
  const prompt = pane?.state === "waiting_input" && pane.prompt ? pane.prompt : { options: park.options ?? [], choice: park.choice ?? null };
  if (prompt.options.length && optionIndex(prompt.options, text) === null)
    throw usageError(`'${text}' is not one of the prompt's options: ${optionsLine(prompt.options)}`, cmd.answer(t.key, "1"), "not_an_option");
  try {
    await runner.sendKeys(session, promptKeys(prompt, text).keys);
  } catch (e) {
    throw fail((e as Error).message);
  }
  const failures = readActFailures(ctx.root);
  if (failures[t.key]?.effect === "answer") {
    delete failures[t.key];
    writeActFailures(ctx.root, failures);
  }
  return { ...receipt, delivered: true } as Receipt;
}
