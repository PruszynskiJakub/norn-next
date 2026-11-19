/**
 * Moving a person off the old norn's repo-local config, which held their mode and agent. This norn
 * reads only its own repo-local file, so the old one was ignored without a word: a person who chose
 * manual found agents starting on their own. Its keys are written into the repo-local file where it
 * does not set them already, and the old text is kept beside it. A repo not set up yet is left to
 * `norn init`: a repo-local file holding only the mode would read as a config gone wrong rather
 * than one never made.
 */
import { join } from "node:path";
import type { HostFiles } from "@norn/plugin-api";
import { parse } from "yaml";
import { parseLayer } from "./load.ts";
import { getKey, isMapping } from "./merge.ts";
import { type ConfigPaths, layerFileName, OLD_LOCAL_CONFIG_FILE, REPO_LOCAL_FILE } from "./paths.ts";
import type { ConfigLayer } from "./schema.ts";
import { overrideOf } from "./set.ts";
import { setKeyInText } from "./write.ts";

export interface OldLocalConfig {
  /** this norn's key and value for each old key carried over */
  set: Array<{ from: string; key: string; value: unknown }>;
  /** old keys left behind, each with why */
  ignored: string[];
}

export interface OldLocalMove {
  file: string;
  backup: string;
  mapped: string[];
  ignored: string[];
  /** the line a command prints about the move */
  notice: string;
}

const isArgs = (v: unknown): v is string[] => Array.isArray(v) && v.every((a) => typeof a === "string" && a !== "");

/** The executor an old agent name means: one of that name, else one running that harness. */
function executorFor(agent: string, executors: Readonly<Record<string, { harness?: string }>>): string | undefined {
  if (agent in executors) return agent;
  return Object.entries(executors).find(([, e]) => e.harness === agent)?.[0];
}

/** The old file's keys in this norn's spelling, against the executors the other files configure. */
export function mapOldLocalConfig(text: string, executors: Readonly<Record<string, { harness?: string }>>): OldLocalConfig {
  const out: OldLocalConfig = { set: [], ignored: [] };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    out.ignored.push("the whole file: it is not YAML");
    return out;
  }
  if (doc === null || doc === undefined) return out;
  if (!isMapping(doc)) {
    out.ignored.push("the whole file: it is not a mapping of keys");
    return out;
  }
  const none = (name: string) => `no executor ${name} is configured${Object.keys(executors).length > 0 ? ` (${Object.keys(executors).join(", ")})` : ""}`;
  for (const [key, value] of Object.entries(doc)) {
    if (key === "$schema") continue;
    if (key === "mode" && (value === "auto" || value === "manual")) out.set.push({ from: "mode", key: "kernel.mode", value });
    else if (key === "agent" && typeof value === "string" && value !== "") {
      const name = executorFor(value, executors);
      if (name) out.set.push({ from: "agent", key: "executor", value: name });
      else out.ignored.push(`agent: ${none(value)}`);
    } else if (key === "agents" && isMapping(value)) {
      for (const [agent, entry] of Object.entries(value)) {
        const name = executorFor(agent, executors);
        if (!name) out.ignored.push(`agents.${agent}: ${none(agent)}`);
        else if (!isMapping(entry)) out.ignored.push(`agents.${agent}: not a mapping`);
        else
          for (const [field, v] of Object.entries(entry)) {
            if (field === "model" && typeof v === "string" && v !== "") out.set.push({ from: `agents.${agent}.model`, key: `executors.${name}.model`, value: v });
            else if (field === "args" && isArgs(v)) out.set.push({ from: `agents.${agent}.args`, key: `executors.${name}.args`, value: v });
            else out.ignored.push(`agents.${agent}.${field}: this norn takes only model and args`);
          }
      }
    } else out.ignored.push(`${key}: not a key this norn takes from it`);
  }
  return out;
}

/** The executors every file configures together, as far as each parses. */
async function configuredExecutors(files: HostFiles, paths: ConfigPaths): Promise<Record<string, { harness?: string }>> {
  const out: Record<string, { harness?: string }> = {};
  for (const layer of ["user", "local", "repo"] as const) {
    const parsed = parseLayer(layer, await files.read(paths[layer]));
    for (const [name, e] of Object.entries(parsed.ok && parsed.value?.executors ? parsed.value.executors : {})) out[name] = { ...out[name], ...(e.harness ? { harness: e.harness } : {}) };
  }
  return out;
}

/** One file's layer, or null when it is absent or does not parse: the load names a broken file. */
async function parsedLayer(files: HostFiles, layer: "repo", path: string): Promise<ConfigLayer | null> {
  const parsed = parseLayer(layer, await files.read(path));
  return parsed.ok ? parsed.value : null;
}

/**
 * Move the old file into the repo-local one; null when there is none, or when no config of this
 * norn is there yet and `setUp` asks for one. The old text is kept before anything else is
 * written, so a crash between the steps loses nothing, and a move cut short is finished next time:
 * a key already set is never written again.
 */
export async function migrateOldLocalConfig(
  files: HostFiles,
  root: string,
  paths: ConfigPaths,
  /** `carried`: this norn's keys a caller already took from the old file (init's mode), named as taken rather than as set already */
  opts: { setUp: boolean; carried?: readonly string[] },
): Promise<OldLocalMove | null> {
  const file = join(root, OLD_LOCAL_CONFIG_FILE);
  const text = await files.read(file);
  if (text === null) return null;
  if (opts.setUp && (await files.read(paths.repo)) === null && (await files.read(paths.local)) === null) return null;
  const m = mapOldLocalConfig(text, await configuredExecutors(files, paths));
  const current = await files.read(paths.local);
  const parsed = parseLayer("local", current);
  // a repo-local file that does not parse is the person's to fix; the load names it
  if (!parsed.ok) return null;
  const layer: ConfigLayer | null = parsed.value;
  const above = { user: null, local: layer, repo: await parsedLayer(files, "repo", paths.repo) };
  let next = current;
  const mapped: string[] = [];
  const ignored = [...m.ignored];
  for (const s of m.set) {
    // a key the committed file sets never applies from the person's file: taking it would claim a fix that is not in effect
    const wins = overrideOf(above, paths, "local", s.key, s.value);
    if (opts.carried?.includes(s.key)) mapped.push(`${s.from} → ${s.key}`);
    else if (wins) ignored.push(`${s.from}: ${layerFileName(wins.layer)} sets ${s.key} (${typeof wins.value === "string" ? wins.value : JSON.stringify(wins.value)}), and it wins`);
    else if (getKey(layer, s.key) !== undefined) ignored.push(`${s.from}: ${REPO_LOCAL_FILE} sets ${s.key} already`);
    else {
      next = setKeyInText(next, s.key, s.value);
      mapped.push(`${s.from} → ${s.key}`);
    }
  }
  let backup = `${file}.old`;
  for (let n = 2; (await files.read(backup)) !== null; n++) backup = `${file}.old-${n}`;
  await files.write(backup, text);
  if (next !== current && next !== null) await files.write(paths.local, next);
  await files.remove(file);
  const list = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "nothing");
  const backupName = backup.slice(root.length + 1);
  const notice = `norn: moved ${OLD_LOCAL_CONFIG_FILE} (the old norn's) into ${REPO_LOCAL_FILE}: took ${list(mapped)}${ignored.length > 0 ? `; ignored ${ignored.join("; ")}` : ""}; the old text is kept as ${backupName}`;
  return { file, backup, mapped, ignored, notice };
}
