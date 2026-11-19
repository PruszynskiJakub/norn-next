/**
 * `norn doctor`: check the config, plugins, workflows, harness hooks and tools this repo needs.
 * Checks: config valid, every slot resolves, API ranges, workflows load, the labels norn puts on items
 * defined on the tracker (created where missing), each harness's hook line runs, tools present (git
 * new enough; gh with github, and logged in; herdr with the herdr runner; claude with the claude
 * harness; pi with the pi harness), and the git remote a forge or a refs store pushes to.
 * `--repo` checks only what the repo's tree decides (config, plugins, slots, workflows), for a machine
 * with no agent or runner, such as CI checking a branch with the released norn.
 * Every failing check names its fix in `do_instead`; any failure exits 1 with the whole report.
 */
import { defineCommand } from "../command.ts";
import { doctorLines, runDoctor } from "../doctor.ts";
import { ExitCode, rendered, withExit } from "../output.ts";

export const doctorCommand = defineCommand({
  name: "doctor",
  summary: "Check the config, plugins, workflows, harness hooks and tools this repo needs",
  usage: "norn doctor [--repo]",
  options: { repo: { type: "boolean" } },
  optionHelp: { "--repo": "check only the repo's config, plugins, slots and workflows; no hooks or tools (CI)" },
  async run(ctx, args) {
    const report = await runDoctor(ctx, { repoOnly: args.values.repo === true });
    const out = rendered(report, [`# norn doctor: ${report.ok ? "all checks pass" : "some checks fail"}`, "", ...doctorLines(report)].join("\n"));
    return report.ok ? out : withExit(out, ExitCode.error);
  },
});
