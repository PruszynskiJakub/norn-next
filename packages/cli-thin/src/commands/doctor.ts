/**
 * `norn doctor`: check the config, plugins, workflows, harness hooks and tools this repo needs.
 * Checks: config valid, every slot resolves, API ranges, workflows load, harness hooks installable,
 * tools present (git; gh with github; herdr with the herdr runner; claude with the claude harness).
 * Every failing check names its fix in `do_instead`; any failure exits 1 with the whole report.
 */
import { defineCommand } from "../command.ts";
import { doctorLines, runDoctor } from "../doctor.ts";
import { ExitCode, rendered, withExit } from "../output.ts";

export const doctorCommand = defineCommand({
  name: "doctor",
  summary: "Check the config, plugins, workflows, harness hooks and tools this repo needs",
  usage: "norn doctor",
  async run(ctx) {
    const report = await runDoctor(ctx);
    const out = rendered(report, [`# norn doctor: ${report.ok ? "all checks pass" : "some checks fail"}`, "", ...doctorLines(report)].join("\n"));
    return report.ok ? out : withExit(out, ExitCode.error);
  },
});
