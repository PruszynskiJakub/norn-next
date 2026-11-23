/**
 * What a command runs with. Everything a command may need is built on first use and kept, so a
 * command that never touches the repo (help, --version) runs anywhere, and one that does refuses
 * with the CliError of the first piece that does not resolve.
 */
import { hostname } from "node:os";
import type { HostContext } from "@norn/plugin-api";
import type { Runtime, RuntimeEnv } from "@norn/runtime";
import type { LoadedConfig } from "./config/load.ts";
import { LAYERS, type Layer } from "./config/paths.ts";
import { nornHome } from "./home.ts";
import { machineHolder } from "./holder.ts";
import { packFailure } from "./plugins/pack-check.ts";
import type { PluginImporter } from "./plugins/installed.ts";
import { floorRefusal } from "./version-guard.ts";
import { type HostFactory, type WiredPlugins, type WiredRepo, wireConfig, wirePlugins, wireConfirmedWorkflows, wireRepo, wireRepoWorkflows, wireRuntime, wireRuntimeEnv } from "./wiring.ts";

/** A terminal a person types into: what `status --watch` reads keys from and draws its frames for. */
export interface Terminal {
  /** raw key chunks as the terminal sends them; the cockpit ends when they end */
  keys: AsyncIterable<string>;
  columns: number;
  rows: number;
  /** the frames may carry colour */
  color: boolean;
  /** hand the terminal back as it was */
  close(): void;
}

/** The process as the entry hands it over; a test passes its own, so the CLI runs in-process with no child. */
export interface CliIo {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** the user's home folder, beneath which `~/.norn` sits */
  userHome: string;
  /** the whole of stdin; called only by a command that reads it */
  stdin(): Promise<string>;
  /** aborted on the first SIGINT or SIGTERM: `watch` ends its tick and stops */
  signal?: AbortSignal;
  /** waits `ms`, or less when the signal aborts; a test passes its own, so a watch's pauses take no wall time */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  /** a line for a person on stderr; never data */
  log?(line: string): void;
  /** stdin line by line, for a command that waits on a person's Enter; absent, its input has ended */
  lines?(): AsyncIterable<string>;
  /** the person's terminal, taken over by `status --watch` until it quits */
  terminal?(): Terminal;
  /** how this binary is invoked, so a launched agent's hooks call the same build: `[bun, main.ts]` or `[norn]` */
  self: readonly string[];
  /** this binary's version; the entry passes the package's */
  version: string;
  hosts: HostFactory;
  importer: PluginImporter;
  /** what the network calls this machine now (os.hostname); the claim holder is fixed from it only once */
  hostname?: string;
}

export class CliContext {
  private repoP?: Promise<WiredRepo>;
  private configP?: Promise<LoadedConfig>;
  private pluginsP?: Promise<WiredPlugins>;
  private envP?: Promise<RuntimeEnv>;
  private layers: readonly Layer[] = LAYERS;
  readonly stderr: string[] = [];

  /** `acts`: the command acts, so its runtime env is refused below the store's version floor */
  constructor(
    readonly io: CliIo,
    private readonly opts: { acts?: boolean } = {},
  ) {}

  get env() {
    return this.io.env;
  }
  get version(): string {
    return this.io.version;
  }
  get home(): string {
    return nornHome(this.io.env, this.io.userHome);
  }
  /** a line for a person, on stderr after the command's output */
  note(line: string): void {
    this.stderr.push(line);
  }

  /** the checkout, its machine dir and the host over both */
  repo(): Promise<WiredRepo> {
    this.repoP ??= wireRepo(this.home, this.io.cwd, this.io.hosts);
    return this.repoP;
  }
  async host(): Promise<HostContext> {
    return (await this.repo()).ctx;
  }
  /** the merged, validated config; a config error otherwise */
  config(): Promise<LoadedConfig> {
    this.configP ??= this.repo().then((w) => wireConfig(w, (line) => this.note(line), this.layers));
    return this.configP;
  }
  /**
   * From here on, read only the repo's own config files, as a checkout with no person's home sees
   * them (CI): what the user's file sets would hide, or cause, a problem the repo alone has.
   */
  repoLayersOnly(): void {
    this.layers = LAYERS.filter((l) => l !== "user");
    this.reload();
  }
  /** bundled and installed plugins, every pick resolved */
  plugins(): Promise<WiredPlugins> {
    this.pluginsP ??= Promise.all([this.repo(), this.config()]).then(([w, c]) => wirePlugins(w, c, this.io.importer));
    return this.pluginsP;
  }
  /**
   * Forget the config, the plugins and the env built from them, so the next use reads them again
   * from disk; the checkout and its host stay.
   */
  reload(): void {
    this.configP = undefined;
    this.pluginsP = undefined;
    this.envP = undefined;
  }
  /** the runtime env the agent verbs and views read */
  runtimeEnv(): Promise<RuntimeEnv> {
    this.envP ??= this.parts()
      .then(wireRuntimeEnv)
      .then(async (env) => {
        const refusal = this.opts.acts ? await floorRefusal(env.slots.store, this.version, (line) => this.note(line)) : null;
        if (refusal) throw refusal;
        return env;
      });
    return this.envP;
  }
  /** the runtime env, refused when the workflows (the pack's and the repo's) cannot run: what a tick needs */
  async workflowEnv(): Promise<RuntimeEnv> {
    const [env, p] = await Promise.all([this.runtimeEnv(), this.plugins()]);
    const failure = packFailure(env.workflows, { pack: env.config.pack, plugins: p.plugins, installedAs: p.installedAs, repo: env.repoWorkflows, held: Object.keys(env.held) });
    if (failure) throw failure;
    return env;
  }
  /** the tick host */
  async runtime(): Promise<Runtime> {
    return wireRuntime(await this.workflowEnv());
  }

  private async parts() {
    const [w, loaded, p] = await Promise.all([this.repo(), this.config(), this.plugins()]);
    const [repoWorkflows, confirmedWorkflows, machine] = await Promise.all([wireRepoWorkflows(w), wireConfirmedWorkflows(w), machineHolder(w.ctx, w.home, this.io.env, this.io.hostname ?? hostname())]);
    return { w, loaded, plugins: p.plugins, repoWorkflows, confirmedWorkflows, holder: machine.holder, formerHolders: machine.former, self: this.io.self, ...(this.io.env.PATH !== undefined ? { path: this.io.env.PATH } : {}), ...(this.io.env.NORN_HOME_DIR ? { home: this.io.env.NORN_HOME_DIR } : {}) };
  }
}
