/**
 * Moving a machine off the old norn's user config. The old `<norn home>/config.yaml` kept its keys at
 * the top level (`mode: auto`), where this norn's schema refuses them, so every command would fail
 * on a file the person never touched. It is told apart only when it fails this norn's schema and every
 * key in it is one the old file allowed; then a command refuses with `config_old` and `norn init`
 * rewrites it in this norn's keys, keeping the old text beside it.
 */
import { check } from "@norn/schema";
import { parse, stringify } from "yaml";
import { isMapping } from "./merge.ts";
import { ConfigLayer, TraceRetain } from "./schema.ts";

/** Every key the old norn's user config allowed. */
const OLD_USER_KEYS = new Set(["$schema", "max_agents", "mode", "agent", "agents", "notify", "trace"]);

/** Where init keeps the old file's text. */
export const OLD_USER_BACKUP_SUFFIX = ".old";

export interface OldUserConfig {
  layer: ConfigLayer;
  /** old keys carried over, as `old → new` */
  mapped: string[];
  /** old keys left behind, each with why */
  ignored: string[];
}

/** Whether this text is the old norn's user config: valid YAML, not this norn's layer, only old keys. */
export function isOldUserConfig(text: string | null): boolean {
  if (text === null) return false;
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return false;
  }
  if (!isMapping(doc) || Object.keys(doc).length === 0) return false;
  if (check(ConfigLayer, doc).ok) return false;
  return Object.keys(doc).every((k) => OLD_USER_KEYS.has(k));
}

const IGNORED_WHY: Record<string, string> = {
  agent: "the default executor is chosen per repo, by `executor` in the repo's config",
  agents: "an executor's model and args are set under `executors` in the repo's config",
  notify: "this norn sends no notifications",
  max_agents: "norn starts every due agent and check, with no cap",
};

/** The old file mapped to this norn's keys; call only on text `isOldUserConfig` accepts. */
export function mapOldUserConfig(text: string): OldUserConfig {
  const doc = parse(text) as Record<string, unknown>;
  const kernel: Record<string, unknown> = {};
  const layer: Record<string, unknown> = {};
  const mapped: string[] = [];
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (key === "$schema") continue;
    if (key === "mode" && (value === "auto" || value === "manual")) {
      kernel.mode = value;
      mapped.push("mode → kernel.mode");
    } else if (key === "trace" && isMapping(value) && check(TraceRetain, value.retain).ok) {
      layer.trace = { retain: value.retain };
      mapped.push("trace.retain → trace.retain");
    } else {
      ignored.push(`${key}: ${IGNORED_WHY[key] ?? "its value is not one this norn takes"}`);
    }
  }
  if (Object.keys(kernel).length > 0) layer.kernel = kernel;
  return { layer: layer as ConfigLayer, mapped, ignored };
}

/** The new file's text: this norn's keys under a line saying where they came from. */
export function oldUserConfigText(m: OldUserConfig, backupName: string): string {
  const head = `# norn's user config: this machine's defaults for every repo. Rewritten by norn init from the old norn's file (kept as ${backupName})\n`;
  return Object.keys(m.layer).length === 0 ? head : `${head}${stringify(m.layer)}`;
}
