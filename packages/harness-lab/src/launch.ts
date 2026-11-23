/**
 * The lab agent runs on the norn that launched it: `[...self, "lab-agent", ...]`, with `self` read
 * from the hook command install is given, so a compiled norn needs no `bun` and a norn run by bun
 * names its own bun by path.
 */
import type { InstallTarget, LaunchRequest, LaunchSpec, UninstallTarget } from "@norn/plugin-api";
import { RUN_ENV } from "@norn/plugin-api";

/** The command `norn` runs the stand-in agent under. */
export const LAB_AGENT_COMMAND = "lab-agent";

/** The words of a POSIX command line as a shell reads them: bare words, single quotes and backslash escapes. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error(`unterminated quote in ${JSON.stringify(line)}`);
      word = (word ?? "") + line.slice(i + 1, end);
      i = end;
    } else if (c === "\\" && i + 1 < line.length) {
      word = (word ?? "") + line[++i];
    } else if (c === " " || c === "\t" || c === "\n") {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

/** The norn a hook command runs: its words without the trailing `hook <harness>`. */
export function selfOfHookCommand(hookCommand: string): string[] {
  const words = shellWords(hookCommand);
  const at = words.lastIndexOf("hook");
  const self = at >= 0 ? words.slice(0, at) : words;
  if (self.length === 0) throw new Error(`the hook command ${JSON.stringify(hookCommand)} names no norn to run`);
  return self;
}

/**
 * The norn each worktree was installed with. launch is pure and takes no hook command, while the
 * host installs a harness in the same process right before every launch and resume, so the install
 * is where launch learns it.
 */
const installedSelf = new Map<string, string[]>();

export async function install(target: InstallTarget): Promise<{ changed: string[] }> {
  installedSelf.set(target.worktree, selfOfHookCommand(target.hookCommand));
  return { changed: [] };
}

export async function uninstall(target: UninstallTarget): Promise<{ changed: string[] }> {
  installedSelf.delete(target.worktree);
  return { changed: [] };
}

/** `<self> lab-agent [--resume <session>] -- <prompt>`, the run id last in the env so no caller's env files it elsewhere. */
export function launch(req: LaunchRequest): LaunchSpec {
  const self = installedSelf.get(req.cwd);
  if (self === undefined) throw new Error(`the lab harness was not installed in ${req.cwd}, so it knows no norn to run the lab agent on`);
  const argv = [...self, LAB_AGENT_COMMAND];
  if (req.resume !== undefined) argv.push("--resume", req.resume);
  argv.push("--", req.prompt);
  return { argv, env: { ...req.env, [RUN_ENV.run]: req.run_id } };
}
