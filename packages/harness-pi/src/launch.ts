import { type LaunchRequest, type LaunchSpec, RUN_ENV } from "@norn/plugin-api";

/**
 * `pi --approve [-p] [--model m] [--session-id id] [args...] -- <prompt>`. `--approve` trusts the
 * worktree's project-local resources for this process alone, so pi loads norn's extension and the
 * repo's skills in norn's runs without a trust prompt, and a person's own pi there still asks. `-p`
 * (print mode) when no terminal will show the session. `--session-id` opens the worktree's session
 * with that id, the id the extension reports on `session_start`. `--` ends the options, so a
 * variadic flag in the extra args cannot swallow the prompt.
 */
export function launch(req: LaunchRequest): LaunchSpec {
  const argv = ["pi", "--approve"];
  if (req.headless) argv.push("-p");
  if (req.model) argv.push("--model", req.model);
  if (req.resume) argv.push("--session-id", req.resume);
  argv.push(...(req.args ?? []));
  if (req.prompt) argv.push("--", req.prompt);
  // the run id goes last, so a caller's env cannot file the session under another run
  return { argv, env: { ...req.env, [RUN_ENV.run]: req.run_id } };
}
