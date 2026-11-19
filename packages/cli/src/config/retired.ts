/**
 * Keys this norn once read and reads no more. Unlike the old norn's keys (renamed.ts), a file that
 * still sets one loads: refusing every command over a setting that no longer changes anything would
 * stop a person's work for nothing. The key is left out before the schema sees the file, and named
 * with the command that deletes it.
 */
import type { ConfigProblem } from "./load.ts";
import { isMapping } from "./merge.ts";
import type { Layer } from "./paths.ts";

/** Each retired key, dotted, with why it no longer matters. */
const RETIRED_KEYS: Record<string, string> = {
  "kernel.max_agents": "norn starts every due agent and check, with no cap",
};

const FLAG: Record<Layer, string> = { user: " --user", local: "", repo: " --commit" };

export function retiredWhy(key: string): string | undefined {
  return RETIRED_KEYS[key];
}

export function retiredText(key: string, why: string): string {
  return `${key} is no longer read: ${why}`;
}

/** The set that deletes `key` from the file of `layer`. */
export function unsetCommand(key: string, layer: Layer): string {
  return `norn config set ${key} --unset${FLAG[layer]}`;
}

/** The document without its retired keys, and a note for each one it had; the document is never changed in place. */
export function withoutRetired(layer: Layer, doc: Record<string, unknown>): { doc: Record<string, unknown>; retired: ConfigProblem[] } {
  let out = doc;
  const retired: ConfigProblem[] = [];
  for (const [key, why] of Object.entries(RETIRED_KEYS)) {
    const path = key.split(".");
    const leaf = path.pop() as string;
    let parent: unknown = out;
    for (const p of path) parent = isMapping(parent) ? parent[p] : undefined;
    if (!isMapping(parent) || !(leaf in parent)) continue;
    if (out === doc) out = structuredClone(doc);
    let owner = out as Record<string, unknown>;
    for (const p of path) owner = owner[p] as Record<string, unknown>;
    delete owner[leaf];
    retired.push({ layer, path: `/${[...path, leaf].join("/")}`, message: retiredText(key, why), do_instead: unsetCommand(key, layer) });
  }
  return { doc: out, retired };
}
