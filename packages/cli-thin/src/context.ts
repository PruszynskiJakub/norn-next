/**
 * What a command runs with. Everything a command may need is built on first use and kept, so a
 * command that never touches the repo (help, --version) runs anywhere, and one that does refuses
 * with the CliError of the first piece that does not resolve.
 */
import { hostname } from "node:os";
import type { HostContext } from "@norn/plugin-api";
import type { Runtime, RuntimeEnv } from "@norn/runtime";
import type { LoadedConfig } from "./config/load.ts";
import { nornHome } from "./home.ts";
import type { PluginImporter } from "./plugins/installed.ts";
import { defaultHolder, type HostFactory, type WiredPlugins, type WiredRepo, wireConfig, wirePlugins, wireRepo, wireRuntime, wireRuntimeEnv } from "./wiring.ts";

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
  /** a line for a person on stderr; never data */
  log?(line: string): void;
  /** how this binary is invoked, so a launched agent's hooks call the same build: `[bun, main.ts]` or `[norn]` */
  self: readonly string[];
  /** this binary's version; the entry passes the package's */
  version: string;
  hosts: HostFactory;
  importer: PluginImporter;
  /** this machine's name, for the default claim holder */
  hostname?: string;
}

export class CliContext {
  private repoP?: Promise<WiredRepo>;
  private configP?: Promise<LoadedConfig>;
  private pluginsP?: Promise<WiredPlugins>;
  private envP?: Promise<RuntimeEnv>;
  readonly stderr: string[] = [];

  constructor(readonly io: CliIo) {}

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
    this.configP ??= this.repo().then(wireConfig);
    return this.configP;
  }
  /** bundled and installed plugins, every pick resolved */
  plugins(): Promise<WiredPlugins> {
    this.pluginsP ??= Promise.all([this.repo(), this.config()]).then(([w, c]) => wirePlugins(w, c, this.io.importer));
    return this.pluginsP;
  }
  /** the runtime env the agent verbs and views read */
  runtimeEnv(): Promise<RuntimeEnv> {
    this.envP ??= this.parts().then(wireRuntimeEnv);
    return this.envP;
  }
  /** the tick host */
  async runtime(): Promise<Runtime> {
    return wireRuntime(await this.runtimeEnv());
  }

  private async parts() {
    const [w, loaded, p] = await Promise.all([this.repo(), this.config(), this.plugins()]);
    return { w, loaded, plugins: p.plugins, holder: defaultHolder(this.io.env, this.io.hostname ?? hostname()), self: this.io.self };
  }
}
