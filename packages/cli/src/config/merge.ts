/**
 * Merging the config layers, lowest first, by the runtime's overlay rule: mappings merge key by key;
 * lists and scalars are replaced whole, so a repo's `packs` never appends to a user's. A mapping that
 * picks a plugin (`use`) and picks a different one above drops the keys below too: they were the old
 * plugin's config, and the new plugin's factory would refuse them. Norn's own keys in a slot (the
 * tracker's `intake`) are no plugin's, so they still merge from below.
 */
import { deepMerge, overlay } from "@norn/runtime";

export { getKey, isMapping } from "@norn/runtime";
export type ConfigValue = unknown;

/** Deep merge with the keys norn reads itself in a slot, by the slot's dotted path; the rest of a slot is its plugin's. */
export const CONFIG_MERGE = deepMerge({ tracker: ["intake"] });

export function mergeLayers(layers: readonly unknown[]): Record<string, unknown> {
  return overlay(
    layers.map((value, i) => ({ label: String(i), value })),
    CONFIG_MERGE,
  ).value;
}
