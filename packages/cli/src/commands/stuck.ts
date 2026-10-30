/**
 * `norn stuck "<reason>"` (§9.3, §10 universal report): the agent cannot continue. The tick
 * parks the unit under Unblock (W7: `$stuck`) until a person runs `norn run rerun`.
 */
import type { ReceiptOf } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { usageError } from "../output.ts";
import { reported, reportedFor, reportHeader, reportTarget, writeReport } from "../runtime/report.ts";
import { cmd } from "@norn/core";

export const stuckCommand = defineCommand({
  name: "stuck",
  summary: "Report that the step cannot continue (§9.3); then end your turn",
  usage: 'norn stuck "<reason>"',
  positionals: { min: 1, max: 1 },
  markdown: true,
  async run(ctx, args) {
    const reason = (args.positionals[0] as string).trim();
    if (!reason) throw usageError("norn stuck needs a non-empty reason", cmd.stuck());
    const t = reportTarget(ctx, "stuck");
    const receipt: ReceiptOf<"stuck"> = { kind: "stuck", ...reportHeader(ctx, t), reason };
    const written = writeReport(t, receipt);
    const unblockWith = cmd.runRerun(t.s.unit.key);
    return reported(t, "stuck", written, { reason, unblock_with: unblockWith }, [`Reported stuck (${reportedFor(t)}): ${reason}`, `A person unblocks it with \`${unblockWith}\`.`]);
  },
});
