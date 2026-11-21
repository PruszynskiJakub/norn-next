/**
 * `norn story round <key> --workflow <name> [--at <step>] [--force] [--reason <text>]`: start a
 * story's next round. Records the kernel's `round.started`, pinning the workflow as it loads now; the
 * next tick takes the claim again (a story released after its round ended) and enters the step.
 * `--force` ends a round still under way first, as a `unit.marked` receipt naming the person, so the
 * record says the round was ended rather than overwritten. The receipt ids carry the round they
 * follow, so a retried start records once.
 */
import type { RunState, UnitJournal, WorkflowGraph } from "@norn/kernel";
import { parseUnitId } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { type CliFailure, corruptError, failure, refuse, rendered, usageError } from "../output.ts";
import { receiptId, refuseFinished, syncStore, workflowRefusal } from "./person-support.ts";

const USAGE = "norn story round <key> --workflow <name> [--at <step>] [--force] [--reason <text>]";

/** The round the unit's committed state is in: the seq of the newest applied `round.started`, which stays the same across retries. */
function roundSeq(u: UnitJournal, state: RunState): number {
  return u.receipts.findLast((r) => r.seq <= state.applied_through && r.data.kind === "round.started")?.seq ?? 0;
}

/**
 * What `--force` may not end: a slice still going, or a run on the record nobody ordered stopped, of
 * whatever kind (an agent, a check, a plugin step), which would act on an ended round.
 */
async function refuseUnstoppable(env: RuntimeEnv, key: string, state: RunState): Promise<void> {
  const run = state.run;
  if (run && run.stopped_at === undefined)
    throw refuse(`run ${run.id} of ${run.step} (${run.executor}) is on the record of ${key} and was never stopped; stop it first`, `norn run stop ${key}`, "run_going", { run: run.id });
  const listed = await env.slots.store.listUnits({ story: key });
  if (!listed.ok) throw failure(`cannot list the units of ${key}: ${listed.failure.message}`, "try again", listed.failure.code);
  const open: string[] = [];
  for (const id of listed.value) {
    if ((parseUnitId(id)?.slice ?? null) === null) continue;
    const read = await env.journal.readUnit(id);
    if (!read.ok) throw failure(`cannot read ${id}: ${read.failure.message}`, "try again", read.failure.code);
    if (read.value.corrupt !== undefined || (read.value.state !== null && read.value.state.ended === undefined)) open.push(id);
  }
  if (open.length) throw refuse(`slices of ${key} are not finished: ${open.join(", ")}`, `let them end, or norn story close ${key} and create a new story`, "slices_unfinished", { units: open });
}

/** The steps a unit entering `from` can come to, `from` included, by the routes of the graph. */
function reachable(graph: WorkflowGraph, from: string): Set<string> {
  const seen = new Set<string>();
  const todo = [from];
  for (let step = todo.pop(); step !== undefined; step = todo.pop()) {
    if (seen.has(step) || !graph.steps[step]) continue;
    seen.add(step);
    for (const route of Object.values(graph.steps[step]?.routes ?? {})) todo.push(route.to);
  }
  return seen;
}

/**
 * A slices step reads the story's slice units by id and not by round, so slices an earlier round left
 * would count as this round's: all done ends the step done before the new slices run, one stuck ends
 * it stuck. A round that can come to a slices step is refused while the story has slice units.
 */
async function refuseOldSlices(env: RuntimeEnv, key: string, graph: WorkflowGraph, name: string, step: string): Promise<void> {
  const slicesAt = [...reachable(graph, step)].filter((s) => graph.steps[s]?.kind === "slices");
  if (!slicesAt.length) return;
  const listed = await env.slots.store.listUnits({ story: key });
  if (!listed.ok) throw failure(`cannot list the units of ${key}: ${listed.failure.message}`, "try again", listed.failure.code);
  const slices = listed.value.filter((id) => (parseUnitId(id)?.slice ?? null) !== null);
  if (!slices.length) return;
  throw refuse(
    `a ${name} round of ${key} from ${step} can come to its slices step (${slicesAt.join(", ")}), which would count the slices an earlier round left (${slices.join(", ")}) as its own`,
    `start the round at a step no slices step follows, or norn story close ${key} and create a new story for the new slices`,
    "slices_from_earlier_round",
    { units: slices, steps: slicesAt },
  );
}

export const storyRoundCommand = defineCommand({
  name: "story round",
  acts: true,
  personOnly: true,
  summary: "Start a story's next round on a workflow",
  usage: USAGE,
  options: {
    workflow: { type: "string" },
    at: { type: "string" },
    force: { type: "boolean" },
    reason: { type: "string" },
  },
  optionHelp: {
    "--workflow <name>": "the workflow the round runs, pinned as it loads now",
    "--at <step>": "the step the round starts at (default: the workflow's start)",
    "--force": "end the round still under way first",
    "--reason <text>": "why, kept on the record",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const name = opt.str(args, "workflow");
    if (!name) throw usageError("a round needs the workflow it runs", USAGE);
    const at = opt.str(args, "at");
    const force = opt.bool(args, "force");
    const reason = opt.str(args, "reason")?.trim() || undefined;
    const ref = parseUnitId(key);
    if (!ref) throw refuse(`${key} is not a story key`, "norn story list", "unknown_story");
    if (ref.slice !== null) throw refuse(`a round is a story's, not a slice's (${key})`, `norn story round ${ref.story} --workflow ${name}`, "not_a_story");
    const env = await ctx.runtimeEnv();
    await syncStore(env, key, `norn story round ${key} --workflow ${name}`);

    const load = env.workflows[name];
    const refused = workflowRefusal(env, name);
    // a workflow that is missing, does not load or is held always has a refusal
    if (refused || !load?.ok) throw refused as CliFailure;
    const graph = load.workflow.graph;
    if (at !== undefined && !graph.steps[at]) {
      throw refuse(`workflow ${name} has no step ${at}`, `name one of ${Object.keys(graph.steps).join(", ")}`, "unknown_step");
    }

    const read = await env.journal.readUnit(key);
    if (!read.ok) throw failure(`cannot read ${key}: ${read.failure.message}`, "try again", read.failure.code);
    const u = read.value;
    if (u.corrupt !== undefined) throw corruptError(`${key} is corrupt: ${u.corrupt}`, `a person repairs the record of ${key}`, { unit: key });
    const state = u.state;
    if (!state) {
      const known = u.receipts.length > 0;
      throw refuse(known ? `${key} has not started its first round yet` : `${key} has no run state on this machine`, known ? "norn tick starts it" : "norn story list", known ? "not_started" : "unknown_story");
    }

    const claim = await env.slots.store.claims.read(key);
    if (!claim.ok) throw failure(`cannot read the claim of ${key}: ${claim.failure.message}`, "try again", claim.failure.code);
    if (claim.value && claim.value.holder !== env.config.holder)
      throw refuse(`${key} is held by ${claim.value.holder} until ${claim.value.expires_at}`, `start the round on the machine of ${claim.value.holder}, or norn story take ${key} --force first`, "claim_held");
    await refuseFinished(env, key);

    const underWay = state.ended === undefined;
    if (underWay && !force)
      throw refuse(`${key}'s ${state.workflow.name} round is still under way at ${state.step}`, `norn story round ${key} --workflow ${name}${at ? ` --at ${at}` : ""} --force, to end it`, "round_unfinished");
    if (underWay) await refuseUnstoppable(env, key, state);
    await refuseOldSlices(env, key, graph, name, at ?? graph.start);

    const round = roundSeq(u, state);
    const by = env.config.holder;
    const where = { step: state.step, attempt: state.attempt };
    const endId = receiptId("round-end", `r${round}`, state.step, String(state.attempt));
    const startId = receiptId("round", `r${round}`, name, at ?? graph.start);
    // only this verb's own receipts, from a try cut short, may wait unapplied: anything else changes where the round stands
    const pending = u.unapplied.filter((r) => r.id !== endId && r.id !== startId);
    if (pending.length)
      throw refuse(`${key} has receipts the next tick applies first (${pending.map((r) => r.data.kind).join(", ")})`, `norn tick, then norn story round ${key} again`, "pending");

    // the end goes on the record before the round, so the round is never applied over a run it did not end
    if (underWay) {
      const ended = await env.journal.record(key, { id: endId, data: { kind: "unit.marked", ended: "stuck", reason: `ended by ${by} for a new ${name} round`, ...where } });
      if (!ended.ok) throw failure(`cannot end the round of ${key}: ${ended.failure.message}`, `norn story round ${key} --workflow ${name} --force again`, ended.failure.code);
    }
    const data = { kind: "round.started" as const, workflow: structuredClone(load.workflow.pinned), ...(at !== undefined && { at }), by, ...(reason && { reason }), ...where };
    const wrote = await env.journal.record(key, { id: startId, data });
    if (!wrote.ok) throw failure(`cannot record the round on ${key}: ${wrote.failure.message}`, `norn story round ${key} --workflow ${name} again`, wrote.failure.code);
    const step = at ?? graph.start;
    const value = { story: key, workflow: name, hash: load.workflow.pinned.hash, at: step, ended_round: underWay, receipt_id: startId, ...wrote.value };
    const ended = underWay ? ` The ${state.workflow.name} round at ${state.step} is ended.` : "";
    return rendered(value, `Recorded a ${name} round of ${key}, starting at ${step}${wrote.value.replayed ? " (recorded before)" : ""}.${ended} The next tick starts it.`);
  },
});
