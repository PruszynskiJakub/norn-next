/**
 * `norn why <unit> [--tick <id>]` (O5, H3): explain the latest (or a given) tick's decision for a
 * unit by replaying the pure `decide` on the facts snapshot, workflows and config recorded in the
 * trace, showing the rule that fired, and verifying the replay equals the recorded decision.
 * A mismatch exits 1 (decide was not pure, or the trace was edited).
 */
import { decide, type Decision } from "@norn/core";
import { ExitCode, type TickTrace } from "@norn/schema";
import { findTick, readTrace } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { refuse, withExit } from "../output.ts";
import { parseUnitKey } from "../runtime/human.ts";
import { replayInputs } from "../runtime/tick.ts";

const canon = (v: unknown) => JSON.stringify(JSON.parse(JSON.stringify(v ?? null)));

function lastTickWith(root: string, unit: string): TickTrace | null {
  const { events } = readTrace(root, { unit, types: ["tick"] });
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] as TickTrace;
    if (ev.decisions.some((d) => d.unit === unit)) return ev;
  }
  return null;
}

export const whyCommand = defineCommand({
  name: "why",
  summary: "Replay decide on a recorded tick and show the rule that fired for a unit (O5)",
  usage: "norn why <unit> [--tick <tick_id>]",
  options: { tick: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { key, story } = parseUnitKey(args.positionals[0] as string);
    const tickId = opt.str(args, "tick");
    const tick = tickId ? findTick(ctx.root, tickId) : lastTickWith(ctx.root, key);
    if (!tick) throw refuse(tickId ? `no tick ${tickId} in the trace` : `no tick in the trace decided anything for ${key}`, tickId ? `norn trace ${key}` : "norn tick", "no_tick");
    const recorded = tick.decisions.find((d) => d.unit === key);
    if (!recorded) throw refuse(`tick ${tick.tick_id} decided nothing for ${key}`, `norn trace ${key}`, "no_decision");
    const inputs = replayInputs(ctx.root, tick);
    if (!inputs) throw refuse(`tick ${tick.tick_id} has no replay block (recorded by an older norn)`, `norn trace ${key}`, "no_replay");

    let replayed: Decision[];
    try {
      replayed = decide(inputs.facts, inputs.workflows, inputs.config);
    } catch (e) {
      throw refuse(`replay of tick ${tick.tick_id} failed: ${(e as Error).message}`, `norn trace ${key}`, "replay_failed");
    }
    const mine = replayed.find((d) => d.unit === key) ?? null;
    const matches = !!mine && mine.rule === recorded.rule && canon(mine.action) === canon(recorded.action);
    const allMatch =
      replayed.length === tick.decisions.length &&
      replayed.every((d, i) => d.unit === tick.decisions[i]?.unit && d.rule === tick.decisions[i]?.rule && canon(d.action) === canon(tick.decisions[i]?.action));

    const sf = inputs.facts.stories.find((s) => s.key === story);
    const uf = sf?.units.find((u) => u.unit.key === key);
    const st = uf?.state ?? null;
    const action = recorded.action as { kind?: string; reason?: string };
    const out = {
      unit: key,
      tick_id: tick.tick_id,
      at: tick.at,
      rule: recorded.rule,
      action: action.kind ?? null,
      ...(action.reason ? { reason: action.reason } : {}),
      result: recorded.result,
      facts: {
        claim: sf?.claim.state ?? null,
        status: st?.status ?? (uf ? "not_started" : null),
        step: st?.step ?? null,
        attempt: st?.attempt ?? null,
        park: st?.park ?? null,
        counters: st?.counters ?? {},
        unapplied: uf?.unapplied.map((r) => `${String(r.n).padStart(4, "0")}-${r.receipt.kind}`) ?? [],
        errors: uf?.errors ?? [],
      },
      decision: recorded.action,
      replay: {
        matches,
        all_match: allMatch,
        rule: mine?.rule ?? null,
        ...(matches ? {} : { action: mine?.action ?? null }),
      },
    };
    return matches ? out : withExit(out, ExitCode.error);
  },
});
