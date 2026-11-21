/**
 * `norn run stop <unit>`: stop a unit's live run, on the machine that holds its story's claim.
 * The unit is parked first, so the stopped session is not read as died and retried; an answer
 * (`norn story answer <unit> <text>`) lifts the park and sends the text into the session.
 */
import type { UnitJournal } from "@norn/kernel";
import { deriveUlid, isUlid, ulid } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { corruptError, failure, refuse, rendered } from "../output.ts";
import { stopParkId } from "./person-support.ts";

/** Apart from the indexes the kernel derives from an id, so a person's stop never takes a receipt id of its own. */
const STOP_INDEX = 5709;

/** The stop's intent id: the journal derives its outcome's id from it, so it is a ULID; for a run norn minted, the same on every retry. */
const stopIntentId = (runId: string): string => (isUlid(runId) ? deriveUlid(runId, STOP_INDEX) : ulid());

export const runStopCommand = defineCommand({
  name: "run stop",
  acts: true,
  personOnly: true,
  summary: "Stop a unit's live run",
  usage: "norn run stop <unit>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const unit = args.positionals[0] as string;
    const env = await ctx.runtimeEnv();
    const read = await env.journal.readUnit(unit);
    if (!read.ok) throw failure(`cannot read ${unit}: ${read.failure.message}`, "try again", read.failure.code);
    if (read.value.corrupt !== undefined) throw corruptError(`${unit} is corrupt: ${read.value.corrupt}`, `a person repairs the record of ${unit}`, { unit });
    const state = read.value.state as UnitJournal["state"];
    if (!state) throw refuse(`${unit} has no run state on this machine`, "norn story list", "unknown_unit");
    const run = state.run;
    if (state.ended !== undefined || !run) throw refuse(`${unit} has no run in progress`, `norn story view ${unit.split("/")[0]}`, "no_run");
    if (!run.session)
      throw refuse(`run ${run.id} of ${unit} at ${state.step} has no agent session to stop`, `a ${run.executor} run ends on its own; norn story close ${unit.split("/")[0]} ends the story`, "not_agent");
    const story = unit.split("/")[0] as string;
    // the run is the holder's: its session lives on the holder's machine, and a park written here sits on a record only the holder publishes
    const claim = await env.slots.store.claims.read(story);
    if (!claim.ok) throw failure(`cannot read the claim of ${story}: ${claim.failure.message}`, "try again", claim.failure.code);
    if (claim.value && claim.value.holder !== env.config.holder)
      throw refuse(`${story} is held by ${claim.value.holder} until ${claim.value.expires_at}`, `stop it on the machine of ${claim.value.holder}, or norn story take ${story} --force first`, "claim_held");
    const step = { step: state.step, attempt: state.attempt };
    const reason = `run ${run.id} stopped by ${env.config.holder}`;
    // the park is on the record before the stop: a stop alone reads as a died session, which decide retries
    const parked = await env.journal.record(unit, { id: stopParkId(run.id), data: { kind: "unit.parked", reason, ...step } });
    if (!parked.ok) throw failure(`cannot record the stop on ${unit}: ${parked.failure.message}`, `norn run stop ${unit} again`, parked.failure.code);
    const session = run.session;
    const acted = await env.journal.act(unit, {
      intent: { id: stopIntentId(run.id), data: { kind: "stop.sent", run_id: run.id, reason, ...step } },
      perform: () => env.launcher.stop(session),
      outcome: null,
      next: () => null,
    });
    if (!acted.ok) throw failure(`cannot stop run ${run.id}: ${acted.failure.message}`, `norn run stop ${unit} again`, acted.failure.code);
    const value = { unit, run_id: run.id, step: state.step, attempt: state.attempt, stopped: acted.value.performed };
    return rendered(value, `Stopped run ${run.id} of ${unit} at ${state.step}; the unit is parked. To set it going again: \`norn story answer ${unit} "<what to do>"\`.`);
  },
});
