/**
 * `norn ask "<question>" [--option …]` (§9.3, §10 universal report): the step needs a person's
 * answer. The tick parks the unit in the inbox; the answer resumes the same session (B2, C3).
 */
import type { ReceiptOf } from "@norn/schema";
import { defineCommand, opt } from "../command.ts";
import { usageError } from "../output.ts";
import { reported, reportedFor, reportHeader, reportTarget, writeReport } from "../runtime/report.ts";
import { cmd } from "@norn/core";

export const askCommand = defineCommand({
  name: "ask",
  summary: "Report that the step needs a person's answer to continue (§9.3); then end your turn",
  usage: 'norn ask "<question>" [--option "<a>" --option "<b>"]',
  options: { option: { type: "string", multiple: true } },
  positionals: { min: 1, max: 1 },
  markdown: true,
  async run(ctx, args) {
    const question = (args.positionals[0] as string).trim();
    if (!question) throw usageError("norn ask needs a non-empty question", cmd.ask());
    const options = opt.list(args, "option").map((o) => o.trim()).filter(Boolean);
    const t = reportTarget(ctx, "ask");
    const receipt: ReceiptOf<"ask"> = { kind: "ask", ...reportHeader(ctx, t), question };
    if (options.length) receipt.options = options;
    const written = writeReport(t, receipt);
    const answerWith = cmd.storyAnswer(t.s.unit.key);
    return reported(t, "ask", written, { question, ...(options.length ? { options } : {}), answer_with: answerWith }, [
      `Asked a person (${reportedFor(t)}): ${question}`,
      ...(options.length ? [`Options: ${options.join(" · ")}`] : []),
      `They answer with \`${answerWith}\`; the answer comes back to this session.`,
    ]);
  },
});
