/**
 * `norn lab-agent`: the lab harness's stand-in agent, run on this same norn so a compiled binary
 * needs no bun. It plays the beat script the lab names for the run in its launch env, through a host
 * from host-node (the one IO boundary), and exits as the agent would.
 */
import { LAB_BEATS_ENV, LabBeats, runLabAgent } from "@norn/harness-lab";
import { parseJson, RUN_ENV } from "@norn/plugin-api";
import { defineCommand, opt } from "../command.ts";
import { type ExitCode, refuse, withExit } from "../output.ts";

const STARTED_BY = "it is the lab's stand-in agent, which the lab harness starts in a lab run; to try norn with it, run `norn lab`";

export const labAgentCommand = defineCommand({
  name: "lab-agent",
  summary: "Run the lab's stand-in agent for the run in the launch env (the lab harness starts it)",
  usage: "norn lab-agent [--resume <session>] -- <prompt>",
  options: { resume: { type: "string" } },
  optionHelp: { "--resume <session>": "the session a resumed launch continues" },
  positionals: { min: 0, max: 1 },
  async run(ctx, args) {
    const unit = ctx.env[RUN_ENV.unit]?.trim();
    const runId = ctx.env[RUN_ENV.run]?.trim();
    if (!unit || !runId) throw refuse(`norn lab-agent runs for a run norn launched; ${RUN_ENV.unit} and ${RUN_ENV.run} are not set`, STARTED_BY, "no_run_env");
    const beatsPath = ctx.env[LAB_BEATS_ENV]?.trim();
    if (!beatsPath) throw refuse(`norn lab-agent plays the lab's beat script, and ${LAB_BEATS_ENV} names none: this is not a lab run`, STARTED_BY, "not_lab_run");
    const host = ctx.io.hosts.host({ root: ctx.io.cwd, dataDir: ctx.io.cwd });
    const text = await host.files.read(beatsPath);
    if (text === null) throw refuse(`the lab's beat script ${beatsPath} (${LAB_BEATS_ENV}) does not exist`, STARTED_BY, "not_lab_run");
    const beats = parseJson(LabBeats, text, `the lab's beat script ${beatsPath}`);
    if (!beats.ok) throw refuse(beats.failure.message, "start the lab again with `norn lab --clean`", "invalid");
    const resume = opt.str(args, "resume");
    const result = await runLabAgent(host, beats.value, {
      cwd: ctx.io.cwd,
      norn: ctx.io.self,
      run_id: runId,
      prompt: args.positionals[0] ?? "",
      ...(resume !== undefined && { resume }),
    });
    if (result.problem !== undefined) ctx.note(`norn lab-agent: ${result.problem}`);
    // the agent's own exit, such as a scripted crash, is what its runner sees
    return withExit({ unit, ...result }, result.exit as ExitCode);
  },
});
