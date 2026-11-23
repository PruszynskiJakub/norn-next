/**
 * `norn lab [--clean]`: a throwaway norn repo under the temp directory where the lab's stand-in agent
 * plays a story through its eight beats. It builds the lab, or resumes the one there, and prints where
 * the lab is, the beat its story is at and the command that moves it on.
 */
import { tmpdir } from "node:os";
import { defineCommand, opt } from "../command.ts";
import { labMarkdown, openLab } from "../lab/lab.ts";
import { labPaths } from "../lab/paths.ts";
import { rendered } from "../output.ts";

export const labCommand = defineCommand({
  name: "lab",
  summary: "Build or resume a throwaway lab repo where a stand-in agent plays a story in eight beats",
  usage: "norn lab [--clean]",
  options: { clean: { type: "boolean" } },
  optionHelp: { "--clean": "remove the lab and build it again, from beat 1" },
  async run(ctx, args) {
    const paths = labPaths(ctx.env.TMPDIR?.trim() || tmpdir());
    const host = ctx.io.hosts.host({ root: paths.repo, dataDir: paths.home });
    const view = await openLab({ host, paths, self: ctx.io.self }, { clean: opt.bool(args, "clean") });
    return rendered(view, labMarkdown(view));
  },
});
