/**
 * Adapter wiring: the built-in registry from @norn/adapters (gh-64: no third-party adapters).
 * Ports are built from the resolved config; tests inject replacements through `CliDeps.ports`.
 */
import { claude, codex, gemini, gh, git, glab, headless, herdr, notify, opencode, proc } from "@norn/adapters";
import type {
  AdapterContext,
  AdapterRegistry,
  AgentAdapter,
  NotifierPort,
  Ports,
  RunnerPort,
} from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
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

/** D15: the file a setting came from, for an adapter error ("built-in" and "derived" name none). */
export type SourceOf = (key: string) => string | null;

function adapterError(e: unknown, what: string, file: string | null): never {
  const message = `${what}: ${(e as Error).message}`;
  throw failure(message, file ? `fix it in ${file}` : "check the setting with `norn config`", "config_invalid");
}

/**
 * Build every port (X2: built-in adapters only). The runner is the detected one (B29); notifiers
 * come from `notify` (D9: `os` unless false, `ntfy`, `webhook`) plus Herdr's inside Herdr (B20).
 * An adapter that fails to build names the file its setting came from (D15). `overrides` replace
 * whole ports (tests, embedding).
 */
export async function buildPorts(registry: AdapterRegistry, actx: AdapterContext, config: ResolvedConfig, overrides: Partial<Ports> = {}, sourceOf: SourceOf = () => null): Promise<Ports> {
  const agents: Record<string, AgentAdapter> = {};
  if (overrides.agents) Object.assign(agents, overrides.agents);
  for (const name of new Set([config.agent, ...Object.keys(config.agents)])) {
    if (agents[name]) continue;
    const f = registry.agents[name];
    if (!f) adapterError(new Error(`not a built-in agent`), `agent ${name}`, sourceOf("agent"));
    agents[name] = f(actx);
  }
  let runner: RunnerPort | null = null;
  if ("runner" in overrides) runner = overrides.runner ?? null;
  else {
    const f = registry.runners[config.runner.adapter];
    runner = f ? f(actx, { adapter: config.runner.adapter }) : null;
  }
  let notifiers: NotifierPort[];
  if (overrides.notifiers) notifiers = overrides.notifiers;
  else {
    notifiers = [];
    const wanted: Array<{ adapter: string; options?: Record<string, unknown>; key: string }> = [];
    if (config.notify.os) wanted.push({ adapter: "os", key: "notify.os" });
    if (config.notify.ntfy) wanted.push({ adapter: "ntfy", options: { url: config.notify.ntfy }, key: "notify.ntfy" });
    if (config.notify.webhook) wanted.push({ adapter: "webhook", options: { url: config.notify.webhook }, key: "notify.webhook" });
    if (actx.env.HERDR_ENV === "1") wanted.push({ adapter: "herdr", key: "notify" });
    for (const n of wanted) {
      const f = registry.notifiers[n.adapter];
      if (!f) continue;
      try {
        notifiers.push(f(actx, { adapter: n.adapter, ...(n.options ? { options: n.options } : {}) }));
      } catch (e) {
        adapterError(e, `notify ${n.adapter}`, sourceOf(n.key));
      }
    }
  }
  let remote = overrides.remote;
  if (remote === undefined) {
    const f = registry.remotes[config.provider];
    if (!f) adapterError(new Error("not a built-in provider"), `provider ${config.provider}`, sourceOf("provider"));
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
