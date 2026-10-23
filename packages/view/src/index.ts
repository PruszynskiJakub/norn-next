/**
 * @norn/view — read model for front ends (X1): `loadProjectView()` → stories, slices,
 * inbox, runs, timeline, recently done; plus pure terminal formatters. Local reads only,
 * never writes. Front ends read through here and write only through CLI verbs.
 */
export * from "./format.ts";
export * from "./load.ts";
export * from "./timeline.ts";
export type * from "./types.ts";
