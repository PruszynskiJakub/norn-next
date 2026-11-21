/**
 * Deciding a gate (`story approve`, `story reject`): the one unit of the story waiting at a gate,
 * and the `gate.decided` receipt for its step and attempt. The receipt id carries the round, step,
 * attempt and outcome, so a retried decision records once and a stale one is refused by the kernel,
 * never routed. The round is in it because a new round starts the attempt count over on the same
 * record: without it a later round's decision would read as the earlier one's, recorded before.
 * While another machine holds the story, the receipt goes to it through the mailbox (decision-route).
 */
import type { GateOutcome, UnitJournal } from "@norn/kernel";
import type { RuntimeEnv } from "@norn/runtime";
import { type ParsedArgs, opt } from "../command.ts";
import type { CliContext } from "../context.ts";
import { failure, refuse, rendered } from "../output.ts";
import { deliverDecision, deliveredLine, routeDecision } from "./decision-route.ts";
import { ambiguous, readable, receiptId, syncStore, unitsOf } from "./person-support.ts";

function gateStep(u: UnitJournal): string | null {
  const s = u.state;
  if (!s || s.ended !== undefined) return null;
  return typeof s.workflow.doc.steps[s.step]?.gate === "string" ? s.step : null;
}

function whereAre(units: readonly UnitJournal[]): string {
  return units.map((u) => `${u.unit} ${u.state?.ended !== undefined ? `ended ${u.state.ended}` : `at ${u.state?.step ?? "no step"}`}`).join(", ");
}

const newestRound = (u: UnitJournal): number => u.receipts.findLast((r) => r.data.kind === "round.started")?.seq ?? 0;

/** The round a unit is in: the seq of the newest `round.started` on its story's own unit, which slices share. */
export async function roundOf(env: RuntimeEnv, u: UnitJournal): Promise<number> {
  const story = u.unit.split("/")[0] as string;
  if (story === u.unit) return newestRound(u);
  const read = await env.journal.readUnit(story);
  // a guessed round could match an earlier round's id and drop this decision as recorded before
  if (!read.ok) throw failure(`cannot read ${story}: ${read.failure.message}`, "try again", read.failure.code);
  return newestRound(read.value);
}

export async function decideGate(ctx: CliContext, args: ParsedArgs, outcome: GateOutcome) {
  const key = args.positionals[0] as string;
  const verb = `story ${outcome}`;
  const reason = opt.str(args, "reason")?.trim();
  if (outcome === "reject" && !reason) throw refuse("a reject needs the reason the next attempt gets", `norn story reject ${key} --reason "<what to change>"`, "reason");
  const want = opt.str(args, "gate");
  const env = await ctx.runtimeEnv();
  const retry = `norn ${verb} ${key}`;
  await syncStore(env, key, retry);
  const units = readable(await unitsOf(env, key), key);
  const at = units.filter((u) => {
    const g = gateStep(u);
    return g !== null && (want === undefined || g === want);
  });
  if (at.length === 0) {
    const gate = want ? `gate ${want}` : "a gate";
    throw refuse(`${key} is not at ${gate}: ${whereAre(units)}`, `norn story view ${key}`, "not_at_gate");
  }
  if (at.length > 1) {
    const steps = new Set(at.map((u) => gateStep(u)));
    ambiguous(`${key} waits at more than one gate`, at.map((u) => u.unit), (u) =>
      steps.size === at.length ? `norn story ${outcome} ${key} --gate ${gateStep(at.find((x) => x.unit === u) as UnitJournal)}` : `norn story ${outcome} ${u}`,
    );
  }
  const u = at[0] as UnitJournal;
  const state = u.state as NonNullable<UnitJournal["state"]>;
  const id = receiptId("gate", `r${await roundOf(env, u)}`, state.step, String(state.attempt), outcome);
  const route = await routeDecision(env, key.split("/")[0] as string, retry);
  const data = { kind: "gate.decided" as const, outcome, by: env.config.holder, step: state.step, attempt: state.attempt, ...(reason && { reason }) };
  const sent = await deliverDecision(env, route, u.unit, { id, data }, retry);
  // a replayed decision keeps the reason sent first, so this call's reason would misstate the record
  const value = { unit: u.unit, step: state.step, attempt: state.attempt, outcome, ...(reason && !sent.replayed && { reason }), receipt_id: id, ...sent };
  const line = deliveredLine(sent, `\`${outcome}\` at gate ${state.step} of ${u.unit}`);
  return rendered(value, sent.via === "local" ? `${line} The next tick routes it.` : line);
}
