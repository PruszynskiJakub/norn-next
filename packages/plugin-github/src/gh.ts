/**
 * The one way the plugin reaches GitHub: `gh` run through the host, every call bounded, every
 * failure a PluginResult, every JSON answer validated before it is read.
 */
import { type ExecOutput, type HostContext, ok, parseJson, type PluginResult } from "@norn/plugin-api";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { type GithubConfig, REPO_PATTERN } from "./config.ts";
import { classify } from "./failure.ts";

/** Every gh call reaches the network, so every one is bounded; a hung call must not hold a tick. */
export const GH_TIMEOUT_MS = 120_000;

/** gh never prompts and never colours, so its output is the same in a terminal and under a host. */
const GH_ENV = { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" };

const RepoView = Type.Object({ nameWithOwner: Type.String({ pattern: REPO_PATTERN }) });

export interface Gh {
  /** stdout of a call that needs no repository (`gh api user`) */
  run(args: string[], input?: string): Promise<PluginResult<string>>;
  /** stdout of a call on the configured repository: `-R OWNER/NAME` is appended */
  inRepo(args: string[], input?: string): Promise<PluginResult<string>>;
  /** what a call on the repository left behind, for a command whose non-zero exit still answers (`gh pr checks`) */
  inRepoRaw(args: string[]): Promise<PluginResult<ExecOutput>>;
  /** `inRepo`, its stdout parsed and validated */
  json<S extends TSchema>(schema: S, args: string[], input?: string): Promise<PluginResult<Static<S>>>;
  /** `OWNER/NAME`, from the config or asked of gh once */
  repo(): Promise<PluginResult<string>>;
}

const what = (args: string[]): string => `gh ${args.slice(0, 2).join(" ")}`;

export function createGh(ctx: HostContext, config: GithubConfig): Gh {
  // only a found repository is remembered: a failed lookup is asked again on the next call
  let repo: string | undefined = config.repo;

  const exec = (args: string[], input?: string): Promise<ExecOutput> =>
    ctx.exec(["gh", ...args], { cwd: ctx.repo.root, env: GH_ENV, timeoutMs: GH_TIMEOUT_MS, ...(input === undefined ? {} : { input }) });

  const run = async (args: string[], input?: string): Promise<PluginResult<string>> => {
    const out = await exec(args, input);
    if (out.code !== 0 || out.timedOut) return classify(out, what(args));
    return ok(out.stdout);
  };

  const resolveRepo = async (): Promise<PluginResult<string>> => {
    if (repo !== undefined) return ok(repo);
    const out = await run(["repo", "view", "--json", "nameWithOwner"]);
    if (!out.ok) return out;
    const parsed = parseJson(RepoView, out.value, "gh repo view");
    if (!parsed.ok) return parsed;
    repo = parsed.value.nameWithOwner;
    return ok(repo);
  };

  const inRepo = async (args: string[], input?: string): Promise<PluginResult<string>> => {
    const r = await resolveRepo();
    if (!r.ok) return r;
    return run([...args, "-R", r.value], input);
  };

  return {
    run,
    inRepo,
    async inRepoRaw(args) {
      const r = await resolveRepo();
      if (!r.ok) return r;
      return ok(await exec([...args, "-R", r.value]));
    },
    repo: resolveRepo,
    async json(schema, args, input) {
      const out = await inRepo(args, input);
      if (!out.ok) return out;
      return parseJson(schema, out.value, what(args));
    },
  };
}
