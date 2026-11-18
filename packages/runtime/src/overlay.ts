/**
 * The one "later layer wins" rule: layers lowest first, each labelled, resolved by a strategy into a
 * value and the label of the layer that set each resolved key or name. The config layers and the
 * repo's workflows over the pack both resolve through it, so a person reads one rule for both.
 */

export interface OverlayLayer<L extends string, V> {
  label: L;
  /** null or undefined when the layer is absent: it sets nothing */
  value: V | null | undefined;
}

type Mapping = Record<string, unknown>;

export const isMapping = (v: unknown): v is Mapping => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mappings merge key by key; lists and scalars are replaced whole. */
export interface DeepMerge {
  kind: "deepMerge";
  /**
   * The keys inside a slot that norn reads itself, by the slot's dotted path; the rest are its plugin's.
   * A mapping that picks a different plugin (`use`) than the layer below drops the keys below but these:
   * the others were the old plugin's config, and the new plugin's factory would refuse them.
   */
  nornKeys: Readonly<Record<string, readonly string[]>>;
}

/** The highest layer that sets a value wins whole. */
export interface ReplaceWhole {
  kind: "replaceWhole";
}

/** Records keyed by file, replaced whole by name, never by key: a repo's `story.yml` replaces the pack's `story.yaml`. */
export interface ByName {
  kind: "byName";
  nameOf: (key: string) => string;
}

export type OverlayStrategy = DeepMerge | ReplaceWhole | ByName;

export const deepMerge = (nornKeys: Readonly<Record<string, readonly string[]>> = {}): DeepMerge => ({ kind: "deepMerge", nornKeys });
export const replaceWhole: ReplaceWhole = Object.freeze({ kind: "replaceWhole" });
export const byName = (nameOf: (key: string) => string): ByName => ({ kind: "byName", nameOf });

export interface Overlaid<L extends string, V> {
  value: V;
  /** each resolved key (a dotted leaf for `deepMerge`, a name for `byName`, `""` for `replaceWhole`) to its layer */
  origins: Record<string, L>;
  /** the label of the highest layer that holds this key, or null when none does */
  originOf: (key: string) => L | null;
}

/** Every leaf of a mapping as a dotted key; a list is one leaf. */
export function leafKeys(value: unknown, prefix = ""): string[] {
  if (!isMapping(value)) return prefix ? [prefix] : [];
  const keys = Object.keys(value);
  if (keys.length === 0) return prefix ? [prefix] : [];
  return keys.flatMap((k) => leafKeys(value[k], prefix ? `${prefix}.${k}` : k));
}

/** The value at a dotted key (`tracker.intake.label`), or undefined. */
export function getKey(value: unknown, key: string): unknown {
  let at: unknown = value;
  for (const part of key.split(".")) {
    if (!isMapping(at)) return undefined;
    at = at[part];
  }
  return at;
}

const child = (path: string, key: string): string => (path ? `${path}.${key}` : key);

function mergeTwo(below: unknown, above: unknown, path: string, nornKeys: DeepMerge["nornKeys"]): unknown {
  if (!isMapping(below) || !isMapping(above)) return structuredClone(above);
  let out: Mapping = structuredClone(below);
  if (typeof above.use === "string" && typeof below.use === "string" && above.use !== below.use) {
    const own = nornKeys[path] ?? [];
    out = Object.fromEntries(Object.entries(out).filter(([key]) => own.includes(key)));
  }
  for (const [key, value] of Object.entries(above)) out[key] = key in out ? mergeTwo(out[key], value, child(path, key), nornKeys) : structuredClone(value);
  return out;
}

function overlayDeep<L extends string>(layers: readonly OverlayLayer<L, unknown>[], strategy: DeepMerge): Overlaid<L, Mapping> {
  let value: Mapping = {};
  for (const layer of layers) if (isMapping(layer.value)) value = mergeTwo(value, layer.value, "", strategy.nornKeys) as Mapping;
  // A key's origin is the highest layer holding its leaf, read off the raw layers rather than tracked
  // through the merge: it is what `config show` has always printed, and a `use` reset removes the lower
  // leaves from the merged value anyway, so they are never asked about.
  const originOf = (key: string): L | null => [...layers].reverse().find((l) => getKey(l.value, key) !== undefined)?.label ?? null;
  const origins: Record<string, L> = {};
  for (const key of leafKeys(value)) {
    const from = originOf(key);
    if (from !== null) origins[key] = from;
  }
  return { value, origins, originOf };
}

function overlayWhole<L extends string, V>(layers: readonly OverlayLayer<L, V>[]): Overlaid<L, V | undefined> {
  const top = [...layers].reverse().find((l) => l.value !== null && l.value !== undefined);
  const value = top === undefined ? undefined : (structuredClone(top.value) as V);
  const originOf = (key: string): L | null => (key === "" && top !== undefined ? top.label : null);
  return { value, origins: top === undefined ? {} : { "": top.label }, originOf };
}

function overlayByName<L extends string, T>(layers: readonly OverlayLayer<L, Readonly<Record<string, T>>>[], strategy: ByName): Overlaid<L, Record<string, T>> {
  let value: Record<string, T> = {};
  const origins: Record<string, L> = {};
  for (const layer of layers) {
    if (!isMapping(layer.value)) continue;
    const over = layer.value as Readonly<Record<string, T>>;
    const replaced = new Set(Object.keys(over).map(strategy.nameOf));
    const kept: Record<string, T> = {};
    for (const [key, item] of Object.entries(value)) if (!replaced.has(strategy.nameOf(key))) kept[key] = item;
    value = { ...kept, ...over };
    for (const name of replaced) origins[name] = layer.label;
  }
  const originOf = (name: string): L | null => origins[name] ?? null;
  return { value, origins, originOf };
}

export function overlay<L extends string>(layers: readonly OverlayLayer<L, unknown>[], strategy: DeepMerge): Overlaid<L, Mapping>;
export function overlay<L extends string, V>(layers: readonly OverlayLayer<L, V>[], strategy: ReplaceWhole): Overlaid<L, V | undefined>;
export function overlay<L extends string, T>(layers: readonly OverlayLayer<L, Readonly<Record<string, T>>>[], strategy: ByName): Overlaid<L, Record<string, T>>;
export function overlay<L extends string>(layers: readonly OverlayLayer<L, unknown>[], strategy: OverlayStrategy): Overlaid<L, unknown> {
  switch (strategy.kind) {
    case "deepMerge":
      return overlayDeep(layers, strategy);
    case "replaceWhole":
      return overlayWhole(layers);
    case "byName":
      return overlayByName(layers as readonly OverlayLayer<L, Readonly<Record<string, unknown>>>[], strategy);
  }
}
