/**
 * `norn lab [--clean] [--tty]`: a throwaway norn repo under the temp directory where the lab's stand-in
 * agent plays a story through its eight beats. It builds the lab, or resumes the one there, and prints
 * where the lab is, the beat its story is at and the command that moves it on. `--tty` plays the tour
 * in the terminal, its lines on stderr as they happen, and prints the lab as its story ended.
 */
import { tmpdir } from "node:os";
import { defineCommand, opt } from "../command.ts";
import { labMarkdown, openLab, playLab } from "../lab/lab.ts";
import { lineInput } from "../lab/tty.ts";
import { labPaths } from "../lab/paths.ts";
import { rendered } from "../output.ts";
import { pause } from "./watch.ts";

export const labCommand = defineCommand({
  name: "lab",
  summary: "Build or resume a throwaway lab repo where a stand-in agent plays a story in eight beats",
  usage: "norn lab [--clean] [--tty]",
  options: { clean: { type: "boolean" }, tty: { type: "boolean" } },
  optionHelp: {
    "--clean": "remove the lab and build it again, from beat 1",
    "--tty": "play the tour in the terminal: pause at each beat with its caption, and at each decision of yours print its exact command, which Enter runs or you run in another shell",
  },
  async run(ctx, args) {
    const paths = labPaths(ctx.env.TMPDIR?.trim() || tmpdir());
    const host = ctx.io.hosts.host({ root: paths.repo, dataDir: paths.home });
    const lab = { host, paths, self: ctx.io.self };
    const clean = opt.bool(args, "clean");
    const view = opt.bool(args, "tty")
      ? await playLab(lab, { clean }, { say: (line) => ctx.io.log?.(line), input: lineInput(ctx.io.lines?.()), sleep: (ms) => (ctx.io.sleep ?? pause)(ms, ctx.io.signal), signal: ctx.io.signal })
      : await openLab(lab, { clean });
    return rendered(view, labMarkdown(view));
  },
});
