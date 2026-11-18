/**
 * Which file set each key of the merged config: the highest layer holding the key's leaf, else the
 * defaults. A slot whose `use` a higher layer changed drops its plugin's keys below, so such a leaf
 * only a lower layer holds never appears in the merged config to be attributed.
 */
import { getKey, isMapping } from "./merge.ts";
import { LAYERS, type Layer } from "./paths.ts";

export type Origin = Layer | "default";

/** Every leaf of a mapping as a dotted key; a list is one leaf. */
export function leafKeys(value: unknown, prefix = ""): string[] {
  if (!isMapping(value)) return prefix ? [prefix] : [];
  const keys = Object.keys(value);
  if (keys.length === 0) return prefix ? [prefix] : [];
  return keys.flatMap((k) => leafKeys(value[k], prefix ? `${prefix}.${k}` : k));
}

export function originsOf(merged: unknown, layers: Readonly<Record<Layer, unknown>>): Record<string, Origin> {
  const out: Record<string, Origin> = {};
  for (const key of leafKeys(merged)) {
    const from = [...LAYERS].reverse().find((l) => getKey(layers[l], key) !== undefined);
    out[key] = from ?? "default";
  }
  return out;
}
