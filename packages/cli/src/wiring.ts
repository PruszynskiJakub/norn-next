/**
 * Adapter wiring (X2): the built-in registry from @norn/adapters, plus third-party adapters
 * selected in config by package name. Ports are built from the resolved config; tests inject
 * replacements through `CliDeps.ports`.
 */
import { claude, codex, gemini, gh, git, glab, headless, herdr, notify, opencode, proc } from "@norn/adapters";
import type {
  AdapterContext,
  AdapterRegistry,
  AgentAdapter,
  AgentFactory,
  NotifierFactory,
  NotifierPort,
  Ports,
  RemoteFactory,
  RunnerFactory,
  RunnerPort,
} from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
import { REPO_CONFIG_FILE } from "@norn/store";
import { failure } from "./output.ts";

export function defaultRegistry(): AdapterRegistry {
  return {
    git: git.factory,
    process: proc.processFactory,
    remotes: { gh: gh.factory, glab: glab.factory },
    runners: { herdr: herdr.herdrFactory, headless: headless.headlessFactory },
    agents: { claude: claude.createAgent, codex: codex.createAgent, opencode: opencode.createAgent, gemini: gemini.createAgent },
    notifiers: { ...notify.notifiers },
  };
}

type Kind = "agent" | "runner" | "notifier" | "remote";
const EXPORT_NAMES: Record<Kind, string[]> = {
  agent: ["createAgent", "agentFactory"],
  runner: ["runnerFactory", "createRunner"],
  notifier: ["notifierFactory", "createNotifier"],
  remote: ["remoteFactory", "factory"],
};

/** X2: an adapter id not built in is imported as a package exporting a factory by a known name. */
async function external<T>(kind: Kind, id: string): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(id)) as Record<string, unknown>;
  } catch (e) {
    throw failure(`unknown ${kind} adapter '${id}': not built in and not importable (${(e as Error).message})`, `install the package '${id}' or fix ${REPO_CONFIG_FILE}`, "unknown_adapter");
  }
  for (const name of EXPORT_NAMES[kind]) if (typeof mod[name] === "function") return mod[name] as T;
  throw failure(`package '${id}' exports none of ${EXPORT_NAMES[kind].join(", ")}`, `fix the ${kind} adapter in ${REPO_CONFIG_FILE}`, "unknown_adapter");
}

/** Build every port the config selects. `overrides` replace whole ports (tests, embedding). */
export async function buildPorts(registry: AdapterRegistry, actx: AdapterContext, config: ResolvedConfig, overrides: Partial<Ports> = {}): Promise<Ports> {
  const agents: Record<string, AgentAdapter> = {};
  if (overrides.agents) Object.assign(agents, overrides.agents);
  for (const [name, a] of Object.entries(config.agents)) {
    if (agents[name]) continue;
    const f = registry.agents[a.adapter] ?? (await external<AgentFactory>("agent", a.adapter));
    agents[name] = f(actx);
  }
  let runner: RunnerPort | null = null;
  if ("runner" in overrides) runner = overrides.runner ?? null;
  else if (config.runner) {
    const f = registry.runners[config.runner.adapter] ?? (await external<RunnerFactory>("runner", config.runner.adapter));
    runner = f(actx, config.runner);
  }
  let notifiers: NotifierPort[];
  if (overrides.notifiers) notifiers = overrides.notifiers;
  else {
    notifiers = [];
    for (const n of config.notifiers) {
      const f = registry.notifiers[n.adapter] ?? (await external<NotifierFactory>("notifier", n.adapter));
      notifiers.push(f(actx, n));
    }
  }
  let remote = overrides.remote;
  if (remote === undefined) {
    const f = registry.remotes[config.remote.provider] ?? (await external<RemoteFactory>("remote", config.remote.provider));
    remote = f(actx);
  }
  return {
    clock: overrides.clock ?? actx.clock,
    process: overrides.process ?? registry.process(actx),
    git: overrides.git ?? registry.git(actx),
    remote,
    runner,
    agents,
    notifiers,
  };
}
