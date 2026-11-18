/**
 * Which file set each key of the merged config: the layer the overlay names for the key's leaf, else
 * the defaults. A slot whose `use` a higher layer changed drops its plugin's keys below, so such a leaf
 * only a lower layer holds never appears in the merged config to be attributed.
 */
import { leafKeys, overlay } from "@norn/runtime";
import { CONFIG_MERGE } from "./merge.ts";
import { LAYERS, type Layer } from "./paths.ts";

export type Origin = Layer | "default";

export function originsOf(merged: unknown, layers: Readonly<Record<Layer, unknown>>): Record<string, Origin> {
  const resolved = overlay(
    LAYERS.map((label) => ({ label, value: layers[label] })),
    CONFIG_MERGE,
  );
  const out: Record<string, Origin> = {};
  // the merged config shown may hold keys no layer sets (a failed load's, or one the schema filled): those are the defaults'
  for (const key of leafKeys(merged)) out[key] = resolved.originOf(key) ?? "default";
  return out;
}
