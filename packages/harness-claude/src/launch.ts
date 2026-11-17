import type { LaunchRequest, LaunchSpec } from "@norn/plugin-api";

/** The run a session belongs to; norn's hook command reads it to file each event under its run. */
export const RUN_ID_ENV = "NORN_RUN_ID";

/**
 * `claude [--model m] [--resume id] [args...] -- <prompt>`. `--` ends the options, so a variadic flag
 * in the extra args (`--allowedTools a b`) cannot swallow the prompt as one more value.
 */
export function launch(req: LaunchRequest): LaunchSpec {
  const argv = ["claude"];
  if (req.model) argv.push("--model", req.model);
  if (req.resume) argv.push("--resume", req.resume);
  argv.push(...(req.args ?? []));
  if (req.prompt) argv.push("--", req.prompt);
  // the run id goes last, so a caller's env cannot file the session under another run
  return { argv, env: { ...req.env, [RUN_ID_ENV]: req.run_id } };
}
