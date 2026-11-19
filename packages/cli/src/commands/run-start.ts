/**
 * `norn run start <unit>`: start the agent of a step manual mode holds, or of an attended step.
 * Records the kernel's `run.requested` for the unit's step and attempt; the next tick lifts the
 * `agent.ready.manual` or `agent.ready.attended` park and starts the agent, for this visit only, so
 * manual mode still holds every later step. The receipt id carries the round, step and attempt, so a retried start records
 * once and a stale one is refused by the kernel rather than starting a later visit.
 */
import type { UnitJournal } from "@norn/kernel";
import { RUN_ENV } from "@norn/plugin-api";
import { defineCommand } from "../command.ts";
import { failure, refuse, rendered } from "../output.ts";
import { roundOf } from "./gate-support.ts";
import { ambiguous, readable, receiptId, unitsOf } from "./person-support.ts";

/** The park decide derives in manual mode at a ready agent step, by the rule that parks. */
export const MANUAL_PARK = "agent.ready.manual";
/** The park decide derives at an attended step, in either mode, until a person starts it. */
export const ATTENDED_PARK = "agent.ready.attended";

function heldByManual(u: UnitJournal): boolean {
  const s = u.state;
  return !!s && s.ended === undefined && s.run === null && (s.parked?.reason === MANUAL_PARK || s.parked?.reason === ATTENDED_PARK);
}

function whereAre(units: readonly UnitJournal[]): string {
  return units
    .map((u) => {
      const s = u.state;
      if (!s) return `${u.unit} has no run state`;
      if (s.ended !== undefined) return `${u.unit} ended ${s.ended}`;
      if (s.run) return `${u.unit} runs ${s.run.id} at ${s.step}`;
      return `${u.unit} at ${s.step}${s.parked ? ` parked (${s.parked.reason})` : ""}`;
    })
    .join(", ");
}

export const runStartCommand = defineCommand({
  name: "run start",
  acts: true,
  summary: "Start the agent of a step manual mode holds, or of an attended step",
  usage: "norn run start <unit>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    // a step agent starting runs would be the loop manual mode exists to keep a person in
    if (ctx.env[RUN_ENV.run]) throw refuse(`a step agent may not start a run (run ${ctx.env[RUN_ENV.run]})`, "a person starts it, outside any norn run", "agent_start");
    const env = await ctx.runtimeEnv();
    const units = readable(await unitsOf(env, key), key);
    const held = units.filter(heldByManual);
    if (held.length === 0)
      throw refuse(
        `${key} has no agent step waiting for a person to start it (${MANUAL_PARK} or ${ATTENDED_PARK}): ${whereAre(units)}`,
        `norn story view ${key.split("/")[0]}; a step not parked yet is parked or started by the next tick (norn tick)`,
        "not_manual_parked",
      );
    if (held.length > 1) ambiguous(`${key} has more than one agent step waiting to be started`, held.map((u) => u.unit), (u) => `norn run start ${u}`);
    const u = held[0] as UnitJournal;
    const state = u.state as NonNullable<UnitJournal["state"]>;
    const id = receiptId("start", `r${await roundOf(env, u)}`, state.step, String(state.attempt));
    const wrote = await env.journal.record(u.unit, { id, data: { kind: "run.requested", by: env.config.holder, step: state.step, attempt: state.attempt } });
    if (!wrote.ok) throw failure(`cannot record the start on ${u.unit}: ${wrote.failure.message}`, `norn run start ${u.unit} again`, wrote.failure.code);
    const value = { unit: u.unit, step: state.step, attempt: state.attempt, receipt_id: id, ...wrote.value };
    return rendered(value, `Recorded the start of ${state.step} on ${u.unit}${wrote.value.replayed ? " (recorded before)" : ""}. The next tick starts its agent; manual mode still holds the steps after it.`);
  },
});
