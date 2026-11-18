/**
 * `norn plugin list`: list the bundled and installed plugins and what each provides. Each installed
 * plugin is loaded as a command would load it, so one that is missing or written for another plugin
 * API shows here with the command that fixes it.
 */
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { BUNDLED_PLUGINS } from "../plugins/bundled.ts";
import { type Provides, providesOf, providesText } from "../plugins/describe.ts";
import { repoLock } from "../plugins/install.ts";
import { loadInstalled } from "../plugins/installed.ts";

interface Listed {
  name: string;
  source: "bundled" | "installed";
  api: string;
  provides: Provides;
  /** installed only */
  spec?: string;
  version?: string;
  loads?: boolean;
  error?: string;
  do_instead?: string;
}

export const pluginListCommand = defineCommand({
  name: "plugin list",
  summary: "List the bundled and installed plugins and what each provides",
  usage: "norn plugin list",
  async run(ctx) {
    const r = await repoLock(ctx);
    const out: Listed[] = BUNDLED_PLUGINS.map((p) => ({ name: p.name, source: "bundled", api: p.api, provides: providesOf(p) }));
    for (const entry of r.lock.plugins) {
      const load = await loadInstalled(entry, r.pluginsDir, ctx.io.importer, PLUGIN_API_VERSION);
      const base = { name: entry.name, source: "installed" as const, spec: entry.spec, version: entry.version };
      if (load.ok) out.push({ ...base, api: load.plugin.api, provides: providesOf(load.plugin), loads: true });
      else
        out.push({
          ...base,
          api: load.api ?? entry.api,
          provides: {},
          loads: false,
          error: load.message,
          do_instead: load.reason === "api" ? `norn plugin update ${entry.name}` : load.reason === "missing" ? `norn plugin add ${entry.spec}` : `norn plugin remove ${entry.name}`,
        });
    }
    const lines = out.map((p) => {
      const head = `- ${p.name}${p.version ? ` ${p.version}` : ""} (${p.source}, plugin API ${p.api})`;
      return p.loads === false ? `${head}: does not load: ${p.error}; do instead: ${p.do_instead}` : `${head}: ${providesText(p.provides)}`;
    });
    return rendered({ plugin_api: PLUGIN_API_VERSION, lock: r.path, team: r.team, plugins: out }, [`# Plugins (plugin API ${PLUGIN_API_VERSION})`, "", ...lines, "", `Lock: ${r.path}`].join("\n"));
  },
});
