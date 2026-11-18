import type { LaunchRequest, LaunchSpec } from "@norn/plugin-api";

/** The run a session belongs to; norn's hook command reads it to file each event under its run. */
export const RUN_ID_ENV = "NORN_RUN_ID";

/**
 * The args a launch takes when the executor configures none. An unattended `claude -p` has no one to
 * grant a permission, so Claude's own check would deny the `norn` commands the brief asks for; auto
 * lets its classifier allow them. Configured args replace this list whole, so a person can drop it.
 */
export const DEFAULT_ARGS: readonly string[] = Object.freeze(["--permission-mode", "auto"]);

/**
 * `claude [-p] [--model m] [--resume id] [args...] -- <prompt>`. `--` ends the options, so a variadic
 * flag in the extra args (`--allowedTools a b`) cannot swallow the prompt as one more value. `-p`
 * (print mode) when no terminal will show the session: the interactive UI needs one.
 */
export function launch(req: LaunchRequest): LaunchSpec {
  const argv = ["claude"];
  if (req.headless) argv.push("-p");
  if (req.model) argv.push("--model", req.model);
  if (req.resume) argv.push("--resume", req.resume);
  argv.push(...(req.args ?? DEFAULT_ARGS));
  if (req.prompt) argv.push("--", req.prompt);
  // the run id goes last, so a caller's env cannot file the session under another run
  return { argv, env: { ...req.env, [RUN_ID_ENV]: req.run_id } };
}
