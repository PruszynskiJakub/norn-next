/**
 * `norn run rerun <unit> [--step <step>] [--reset <counter>]... [--reason <text>]`: run a unit's
 * current step again, or send it to another step of its pinned workflow, with counters reset.
 * Records the kernel's `step.moved` for the unit's step and attempt; the next tick stops a run that
 * may still be going and then applies the move, taking up a unit that ended stuck. The receipt id
 * carries the round, the visit and what the move asks, so a retried rerun records once.
 */
import type { UnitJournal } from "@norn/kernel";
import { parseUnitId, RUN_ENV } from "@norn/plugin-api";
import { loadPinned } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { corruptError, failure, refuse, rendered } from "../output.ts";
import { roundOf } from "./gate-support.ts";
import { receiptId, refuseFinished, syncStore } from "./person-support.ts";

const USAGE = "norn run rerun <unit> [--step <step>] [--reset <counter>]... [--reason <text>]";

export const runRerunCommand = defineCommand({
  name: "run rerun",
  acts: true,
  summary: "Run a unit's step again, or move it to another step, counters reset",
  usage: USAGE,
  options: {
    step: { type: "string" },
    reset: { type: "string", multiple: true },
    reason: { type: "string" },
  },
  optionHelp: {
    "--step <step>": "the step of the unit's pinned workflow to run (default: the step it is at)",
    "--reset <counter>": "set a counter of the workflow back to 0 (repeatable)",
    "--reason <text>": "why, kept on the record",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const unit = args.positionals[0] as string;
    const reset = [...new Set(opt.list(args, "reset"))];
    const reason = opt.str(args, "reason")?.trim() || undefined;
    // a step agent moving units would take where the work goes next away from the person
    if (ctx.env[RUN_ENV.run]) throw refuse(`a step agent may not rerun a step (run ${ctx.env[RUN_ENV.run]})`, "a person reruns it, outside any norn run", "agent_rerun");
    const ref = parseUnitId(unit);
    if (!ref) throw refuse(`${unit} is not a unit id`, "norn story list", "unknown_unit");
    const env = await ctx.runtimeEnv();
    await syncStore(env, ref.story, `norn run rerun ${unit}`);

    const read = await env.journal.readUnit(unit);
    if (!read.ok) throw failure(`cannot read ${unit}: ${read.failure.message}`, "try again", read.failure.code);
    const u = read.value;
    const repair = `a person repairs the record of ${unit}`;
    if (u.corrupt !== undefined) throw corruptError(`${unit} is corrupt: ${u.corrupt}`, repair, { unit });
    const state = u.state as UnitJournal["state"];
    if (!state) {
      const known = u.receipts.length > 0;
      throw refuse(known ? `${unit} has not started yet` : `${unit} has no run state on this machine`, known ? "norn tick starts it" : "norn story list", known ? "not_started" : "unknown_unit");
    }
    // a corrupt record is a person's repair: moving it would run a step on a record nobody can trust
    if (state.ended === "corrupt") throw corruptError(`${unit} is corrupt: ${state.ended_reason ?? "marked corrupt"}`, repair, { unit });
    if (state.ended === "done") {
      const next = ref.slice === null ? `norn story round ${unit} --workflow <name>, for new work on the story` : `norn story view ${ref.story}`;
      throw refuse(`${unit} ended done at ${state.step}; a rerun takes up only a unit that has not ended done`, next, "unit_done");
    }

    const graph = loadPinned(env, state.workflow)?.graph;
    if (!graph) throw refuse(`${unit}'s pinned workflow ${state.workflow.name} no longer loads`, `norn story round ${ref.story} --workflow <name>`, "workflow_missing");
    const to = opt.str(args, "step") ?? state.step;
    const steps = Object.keys(graph.steps);
    if (!graph.steps[to]) throw refuse(`${unit}'s workflow ${graph.name} has no step ${to}`, `name one of ${steps.join(", ")}`, "unknown_step", { steps });
    const counters = Object.keys(graph.counters);
    const unknown = reset.filter((c) => !graph.counters[c]);
    if (unknown.length)
      throw refuse(
        `${unit}'s workflow ${graph.name} has no counter ${unknown.join(", ")}`,
        counters.length ? `name one of ${counters.join(", ")}` : `norn run rerun ${unit} without --reset`,
        "unknown_counter",
        { counters },
      );

    const claim = await env.slots.store.claims.read(ref.story);
    if (!claim.ok) throw failure(`cannot read the claim of ${ref.story}: ${claim.failure.message}`, "try again", claim.failure.code);
    if (claim.value && claim.value.holder !== env.config.holder)
      throw refuse(`${ref.story} is held by ${claim.value.holder} until ${claim.value.expires_at}`, `rerun it on the machine of ${claim.value.holder}, or norn story take ${ref.story} --force first`, "claim_held");
    await refuseFinished(env, ref.story, "a rerun");

    const where = { step: state.step, attempt: state.attempt };
    const id = receiptId("move", `r${await roundOf(env, u)}`, state.step, String(state.attempt), to, ...[...reset].sort());
    // only this verb's own receipt, from a try cut short, may wait unapplied: anything else changes where the unit stands
    const pending = u.unapplied.filter((r) => r.id !== id);
    if (pending.length)
      throw refuse(`${unit} has receipts the next tick applies first (${pending.map((r) => r.data.kind).join(", ")})`, `norn tick, then norn run rerun ${unit} again`, "pending");

    const data = { kind: "step.moved" as const, to, ...(reset.length > 0 && { reset }), by: env.config.holder, ...(reason && { reason }), ...where };
    const wrote = await env.journal.record(unit, { id, data });
    if (!wrote.ok) throw failure(`cannot record the rerun on ${unit}: ${wrote.failure.message}`, `norn run rerun ${unit} again`, wrote.failure.code);
    const running = state.run !== null && state.ended === undefined;
    const value = { unit, from: state.step, attempt: state.attempt, step: to, reset, stops_run: running ? state.run?.id ?? null : null, receipt_id: id, ...wrote.value };
    const move = to === state.step ? `a rerun of ${to}` : `a move from ${state.step} to ${to}`;
    const counted = reset.length ? `, ${reset.join(", ")} back to 0` : "";
    const stop = running ? ` The next tick stops run ${state.run?.id} first, then applies it.` : " The next tick applies it.";
    return rendered(value, `Recorded ${move} on ${unit}${counted}${wrote.value.replayed ? " (recorded before)" : ""}.${stop}`);
  },
});
