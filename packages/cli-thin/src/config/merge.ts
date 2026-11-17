/**
 * Merging the config layers, lowest first. Mappings merge key by key; lists and scalars are replaced
 * whole, so a repo's `packs` never appends to a user's. A mapping that picks a plugin (`use`) and
 * picks a different one above drops the keys below too: they were the old plugin's config, and the
 * new plugin's factory would refuse them. Norn's own keys in a slot (the tracker's `intake`) are no
 * plugin's, so they still merge from below.
 */
export type ConfigValue = unknown;
type Mapping = Record<string, unknown>;

export const isMapping = (v: unknown): v is Mapping => typeof v === "object" && v !== null && !Array.isArray(v);

/** The keys inside a slot that norn reads itself, by the slot's dotted path; the rest are its plugin's. */
const NORN_SLOT_KEYS: Readonly<Record<string, readonly string[]>> = { tracker: ["intake"] };

const child = (path: string, key: string): string => (path ? `${path}.${key}` : key);

function mergeTwo(below: unknown, above: unknown, path: string): unknown {
  if (!isMapping(below) || !isMapping(above)) return structuredClone(above);
  let out: Mapping = structuredClone(below);
  if (typeof above.use === "string" && typeof below.use === "string" && above.use !== below.use) {
    const own = NORN_SLOT_KEYS[path] ?? [];
    out = Object.fromEntries(Object.entries(out).filter(([key]) => own.includes(key)));
  }
  for (const [key, value] of Object.entries(above)) out[key] = key in out ? mergeTwo(out[key], value, child(path, key)) : structuredClone(value);
  return out;
}

export function mergeLayers(layers: readonly unknown[]): Mapping {
  let out: Mapping = {};
  for (const layer of layers) if (isMapping(layer)) out = mergeTwo(out, layer, "") as Mapping;
  return out;
}

/** The value at a dotted key (`tracker.intake.label`), or undefined. */
export function getKey(config: unknown, key: string): unknown {
  let at: unknown = config;
  for (const part of key.split(".")) {
    if (!isMapping(at)) return undefined;
    at = at[part];
  }
  return at;
}
