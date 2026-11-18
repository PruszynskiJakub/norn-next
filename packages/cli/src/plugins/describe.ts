/** What a plugin provides, by slot, as the plugin commands print it. */
import type { NornPlugin } from "@norn/plugin-api";

export type Provides = Partial<Record<keyof NornPlugin["provides"], string[]>>;

export function providesOf(p: NornPlugin): Provides {
  const out: Provides = {};
  for (const [slot, named] of Object.entries(p.provides) as Array<[keyof NornPlugin["provides"], Record<string, unknown> | undefined]>) {
    const names = Object.keys(named ?? {}).sort();
    if (names.length > 0) out[slot] = names;
  }
  return out;
}

export const providesText = (p: Provides): string =>
  Object.entries(p)
    .map(([slot, names]) => `${slot}: ${(names ?? []).join(", ")}`)
    .join("; ") || "nothing";
