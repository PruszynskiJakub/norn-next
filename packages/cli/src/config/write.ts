/**
 * Changing one config file. The edit goes through the YAML document, so a person's comments and key
 * order survive `norn config set`; the result is checked as a layer and merged with the other files
 * before anything is written, so a set never leaves a config norn refuses to load.
 */
import type { HostFiles } from "@norn/plugin-api";
import { Document, isMap, parse, parseDocument } from "yaml";
import { type ConfigLoad, type ConfigProblem, type LoadedConfig, mergeConfig, parseLayer } from "./load.ts";
import type { Layer } from "./paths.ts";
import { retiredText, retiredWhy, unsetCommand } from "./retired.ts";
import { CONFIG_FORMAT } from "./schema.ts";

/** A command-line value read as YAML: `true`, `3`, `[a, b]` and `{use: local}` mean what they say; the rest is a string. */
export function parseValue(text: string): unknown {
  try {
    const v = parse(text) as unknown;
    return v === undefined ? text : v;
  } catch {
    return text;
  }
}

/** The file's text with `key` (dotted) set to `value`, or removed when `value` is undefined. A new file starts with `format`. */
export function setKeyInText(text: string | null, key: string, value: unknown): string {
  const parsed = parseDocument(text ?? "");
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((e) => e.message).join("; "));
  // an empty file (or one holding a bare comment) has no mapping to set a key in
  const doc = isMap(parsed.contents) ? parsed : new Document({ format: CONFIG_FORMAT });
  const path = key.split(".");
  if (value === undefined) doc.deleteIn(path);
  else doc.setIn(path, doc.createNode(value));
  return doc.toString();
}

export type PlannedSet = { ok: true; text: string; next: LoadedConfig } | { ok: false; problems: ConfigProblem[] };

/** What setting `key` in `layer` would leave: the file's new text and the merged config, or the problems it would cause. */
export function planSet(loaded: Pick<LoadedConfig, "layers" | "paths">, current: string | null, layer: Layer, key: string, value: unknown): PlannedSet {
  // a retired key would load and be ignored, so setting one would only look like it worked
  const why = value === undefined ? undefined : retiredWhy(key);
  if (why) return { ok: false, problems: [{ layer, path: `/${key.split(".").join("/")}`, message: retiredText(key, why), do_instead: unsetCommand(key, layer) }] };
  let text: string;
  try {
    text = setKeyInText(current, key, value);
  } catch (e) {
    return { ok: false, problems: [{ layer, path: "", message: `not YAML: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const parsed = parseLayer(layer, text);
  if (!parsed.ok) return parsed;
  const merged: ConfigLoad = mergeConfig({ ...loaded.layers, [layer]: parsed.value }, loaded.paths, parsed.retired);
  return merged.ok ? { ok: true, text, next: merged.value } : { ok: false, problems: merged.problems };
}

/** Write a planned set: one atomic replace of the one file. */
export async function writeLayer(files: HostFiles, path: string, text: string): Promise<void> {
  await files.write(path, text);
}
