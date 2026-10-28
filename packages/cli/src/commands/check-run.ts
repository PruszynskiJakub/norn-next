/**
 * `norn check-run <run_id>`: started by a tick, never by hand (C5, H6). Runs the check order the tick
 * wrote for that run, writes its `check` receipt and releases the run's lease; the next tick applies it.
 */
import { defineCommand } from "../command.ts";
import { readCheckOrder, runCheckOrder } from "../runtime/act/check.ts";
import { refuse } from "../output.ts";

export const checkRunCommand = defineCommand({
  name: "check-run",
  summary: "Run a check step a tick started, and write its receipt (C5); a tick starts it",
  usage: "norn check-run <run_id>",
  positionals: { min: 1, max: 1 },
  repo: false,
  async run(ctx, args) {
    const runId = args.positionals[0]!;
    const order = readCheckOrder(ctx.home, runId);
    if (!order) throw refuse(`no check order for run ${runId}`, "a tick starts `norn check-run`; run `norn tick`");
    const r = await runCheckOrder(order, () => ctx.clock.now());
    return { run_id: runId, outcome: r.outcome, exit_code: r.exit_code, duration_ms: r.duration_ms };
  },
});
