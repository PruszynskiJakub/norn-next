/**
 * The old norn's top-level keys, which this norn's closed schema refuses as unknown. A bare
 * "unknown property 'mode'" leaves a person guessing; each one here names what replaced it and the
 * file it belongs in, so the refusal's `do_instead` is the command that fixes it.
 */
import type { ConfigProblem } from "./load.ts";
import { type Layer, layerFileName } from "./paths.ts";

/** Whose a key is: a person's goes in the repo-local file, a machine's in the user file, a team's where it was found. */
type Owner = "person" | "machine" | "team";

interface Renamed {
  /** this norn's key, set to the old value as written */
  to: string;
  owner: Owner;
}
interface Replaced {
  /** what replaced it, as a person reads it */
  by: string;
  owner: Owner;
  /** the sets that carry the old value over, given the old value; none when no set says it */
  sets?: (value: unknown) => Array<[string, string]> | null;
}
interface Gone {
  gone: string;
}

const PROVIDER_PLUGIN: Record<string, string> = { gh: "github" };

const OLD_KEYS: Record<string, Renamed | Replaced | Gone> = {
  mode: { to: "kernel.mode", owner: "person" },
  default_mode: { to: "kernel.mode", owner: "person" },
  agent: { to: "executor", owner: "person" },
  default_agent: { to: "executor", owner: "person" },
  agents: { by: "executors.<name>.model and executors.<name>.args", owner: "person" },
  runner: { by: "executors.<name>.runner", owner: "person" },
  max_agents: { to: "kernel.max_agents", owner: "machine" },
  workflow: { to: "kernel.workflow", owner: "team" },
  default_workflow: { to: "kernel.workflow", owner: "team" },
  slice_workflow: { to: "kernel.slice_workflow", owner: "team" },
  default_slice_workflow: { to: "kernel.slice_workflow", owner: "team" },
  base_branch: { to: "base", owner: "team" },
  label: { to: "tracker.intake.label", owner: "team" },
  provider: {
    by: "tracker.use and forge.use (github)",
    owner: "team",
    sets: (v) => {
      const plugin = typeof v === "string" ? PROVIDER_PLUGIN[v] : undefined;
      return plugin ? [["tracker.use", plugin], ["forge.use", plugin]] : null;
    },
  },
  remote: { by: "tracker and forge", owner: "team" },
  claim: { by: "kernel.claim_ttl and kernel.claim_renew_before", owner: "team" },
  limits: { by: "kernel.counters, or each workflow's own counters", owner: "team" },
  notify: { gone: "this norn sends no notifications" },
  notifiers: { gone: "this norn sends no notifications" },
  norn_version: { gone: "this norn records no version in its config" },
  regenerate: { gone: "this norn regenerates nothing" },
  record: { gone: "the store slot (store.use) keeps run data" },
  slots: { gone: "kernel.max_agents bounds the agents that run at once" },
  max_checks: { gone: "checks follow kernel.max_agents" },
  watch_interval: { gone: "use norn watch --interval" },
};

const OWNER_TEXT: Record<Owner, string> = { person: "your own key", machine: "this machine's key", team: "the team's key" };

/** The flag `config set` writes a key's file with. */
function flagFor(owner: Owner, found: Layer): string {
  const layer: Layer = owner === "person" ? "local" : owner === "machine" ? "user" : found;
  return layer === "repo" ? " --commit" : layer === "user" ? " --user" : "";
}

const scalar = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/** A problem for each old key at the top of one file's document, with the command that fixes it. */
export function renamedProblems(layer: Layer, doc: Record<string, unknown>): ConfigProblem[] {
  const file = layerFileName(layer);
  const out: ConfigProblem[] = [];
  for (const [key, value] of Object.entries(doc)) {
    const old = OLD_KEYS[key];
    if (!old) continue;
    const path = `/${key}`;
    const remove = `remove ${key} from ${file}`;
    if ("gone" in old) {
      out.push({ layer, path, message: `\`${key}\` is gone: ${old.gone}`, do_instead: remove });
      continue;
    }
    const flag = flagFor(old.owner, layer);
    const reads = "to" in old ? old.to : old.by;
    const message = `\`${key}\` is the old norn's spelling: this norn reads ${reads}, ${OWNER_TEXT[old.owner]}`;
    const sets = "to" in old ? (scalar(value) === null ? null : [[old.to, scalar(value) as string] as [string, string]]) : (old.sets?.(value) ?? null);
    const fix = sets ? sets.map(([k, v]) => `norn config set ${k} ${v}${flag}`).join(" and ") : `set ${reads}${flag ? ` (norn config set …${flag})` : ""}`;
    out.push({ layer, path, message, do_instead: `${fix}, then ${remove}` });
  }
  return out;
}
