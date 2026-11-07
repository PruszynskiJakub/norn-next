/**
 * `norn story answer [<story|unit>] "<text>"`: answer the question a unit is parked on. Without
 * a unit: the worktree's, else a pick of the units parked on a question. Writes an
 * `answer` receipt at the unit's cursor; the next tick delivers it into the same session or a
 * fresh one from the handoff. Claim free: acquired here; held elsewhere: mailbox.
 *
 * An implicit ask from a pane prompt (permission or trust dialog) of a session
 * on this machine is answered here and now, with the keystrokes the prompt expects — the option
 * number + enter (arrows + enter for unnumbered menus), else the text + enter. The receipt is
 * written only after the keys went in (`delivered: true`, so the tick does not type them again).
 * A failed delivery writes no receipt, keeps the unit parked, is kept as the unit's act failure
 * and names how to reach the pane.
 */
import { cmd, isParked, nextCommand, optionIndex, optionsLine, promptKeys, type SessionRef } from "@norn/core";
import { type Receipt, ulid, type UnitState } from "@norn/schema";
import { machineHolder, readActFailures, writeActFailures } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { failure, refuse, usageError } from "../output.ts";
import { at, DELEGATED_HELP, DELEGATED_OPTION, delegatedFields, delegation, humanReceipt, stepOnlyReceipt, resolveTarget, type Route, runHumanVerb, type Target } from "../runtime/human.ts";
import { parkedOn, targetKey } from "../runtime/target.ts";
import { runnerFor } from "../wiring.ts";

const asks = (st: UnitState) => isParked(st, "ask");

export const storyAnswerCommand = defineCommand({
  name: "story answer",
  version: "acts",
  summary: "Answer the question a unit is parked on; a prompt in an agent's pane gets the keys it expects",
  usage: 'norn story answer [<story|unit>] "<text>" [--reason "…" --delegated]   (a choice prompt: the option number, e.g. "1")',
  options: { reason: { type: "string" }, ...DELEGATED_OPTION },
  optionHelp: { '--reason "…"': "why this answer, kept on the answer receipt", ...DELEGATED_HELP },
  positionals: { min: 1, max: 2 },
  async run(ctx, args) {
    const [unit, raw] = args.positionals.length === 2 ? (args.positionals as [string, string]) : [undefined, args.positionals[0] as string];
    const text = raw.trim();
    if (!text) throw usageError("the answer is empty", 'norn story answer <unit> "<text>"');
    const d = delegation(ctx, args, "story answer");
    const key = await targetKey(ctx, unit, args.json === true, parkedOn("ask", "story answer", "Nothing waits for an answer", (k) => cmd.storyAnswer(k)));
    // A `local` story held elsewhere: the step its last boundary led to, checked by the holder
    const t = await resolveTarget(ctx, key, asks, { stepOnly: (t, step) => stepOnlyReceipt(ctx, t, step, "answer", { answer: text, ...delegatedFields(d) }) });
    const out = await runHumanVerb(ctx, t, {
      verb: "story answer",
      mailbox: true,
      check(t, st) {
        if (!asks(st))
          throw refuse(`${t.key} is not waiting for an answer: it is at ${at(st)}`, nextCommand(t.key, st) ?? cmd.storyView(t.story), "not_parked_on_ask");
      },
      build: (t, st) => humanReceipt(ctx, t, st, "answer", { answer: text, ...delegatedFields(d), ...(st.park?.receipt_id ? { ask_receipt_id: st.park.receipt_id } : {}) }),
      before: (t, st, route, receipt) => typeIntoPrompt(ctx, t, st, route, receipt, text),
    });
    return out;
  },
});

/** Type the answer into the pane prompt the unit is parked on, when its session is here. */
async function typeIntoPrompt(ctx: Context, t: Target, st: UnitState, route: Route, receipt: Receipt, text: string): Promise<Receipt> {
  const park = st.park;
  const run = st.run;
  // a mailbox answer is typed by the holder's tick (SessionInput keys); a hook-only ask takes text from the tick
  if (route.via !== "local" || park?.kind !== "ask" || park.implicit !== "pane" || !run?.session) return receipt;
  if (run.machine && run.machine !== machineHolder(ctx.env)) return receipt;
  const runner = runnerFor(await ctx.ports(), run.session);
  if (!runner) return receipt;
  const session: SessionRef = { runner: run.session.runner, session_id: run.session.session_id, ...(run.session.pane_id ? { pane_id: run.session.pane_id } : {}), ...(run.process ? { process: run.process } : {}) };
  const reach = runner.reach?.(session) ?? null;
  const fail = (reason: string) => {
    // The unit stays parked; the failure is the unit's, shown on its Answer item
    const failures = readActFailures(ctx.root);
    failures[t.key] = { effect: "answer", rule: "answer.keys", reason: `answer to ${t.key} not delivered: ${reason}`, at: ctx.clock.iso(), tick_id: ulid(ctx.clock.now()), step: st.step, attempt: st.attempt, session: { runner: session.runner, session_id: session.session_id, ...(session.pane_id ? { pane_id: session.pane_id } : {}) } };
    writeActFailures(ctx.root, failures);
    return failure(`answer to ${t.key} not delivered: ${reason}`, reach ? `answer it in the pane: ${reach}` : `answer it in the agent's ${session.runner} session ${session.pane_id ?? session.session_id}`, "answer_not_delivered");
  };
  if (!runner.sendKeys) throw fail(`runner ${runner.name} cannot type into a prompt`);
  // the prompt as it is now: the agent may have moved on, or the menu may differ from the parked one
  const pane = await runner.paneState(session).catch(() => null);
  if (pane && pane.alive && pane.state !== "waiting_input" && pane.state !== "unknown")
    throw refuse(`${t.key}'s agent no longer waits on the prompt (pane is ${pane.state})`, `${cmd.tick()} (it records that the agent moved on)`, "prompt_gone");
  const prompt = pane?.state === "waiting_input" && pane.prompt ? pane.prompt : { options: park.options ?? [], choice: park.choice ?? null };
  if (prompt.options.length && optionIndex(prompt.options, text) === null)
    throw usageError(`'${text}' is not one of the prompt's options: ${optionsLine(prompt.options)}`, cmd.storyAnswer(t.key, "1"), "not_an_option");
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
