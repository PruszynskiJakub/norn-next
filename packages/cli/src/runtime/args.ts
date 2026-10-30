/** Unit and story keys as a person types them on the command line (ID1). */
import { isStoryKey, parseSliceKey, sliceKey, storyOf } from "@norn/schema";
import { usageError } from "../output.ts";
import { cmd } from "@norn/core";

/** Normalize a unit key: `gh-123`, `gh-123/03` (also `gh-123/3`). Usage error otherwise. */
export function parseUnitKey(raw: string): { key: string; story: string; slice: string | null } {
  const s = raw.trim();
  if (isStoryKey(s)) return { key: s, story: s, slice: null };
  const m = /^((?:gh|gl)-[1-9][0-9]*)\/([0-9]{1,3})$/.exec(s);
  if (m) {
    const key = sliceKey(m[1] as string, m[2] as string);
    return { key, story: storyOf(key), slice: key };
  }
  throw usageError(`not a story or slice key: '${raw}' (use e.g. gh-123 or gh-123/03)`, cmd.status());
}

/** Story key from `gh-7` or a unit key `gh-7/01` (claims are per story, T1). */
export function storyArg(raw: string, command: string): string {
  const key = parseSliceKey(raw)?.story ?? raw;
  if (!isStoryKey(key)) throw usageError(`not a story key: '${raw}' (expected e.g. gh-123)`, `norn ${command} <story>`);
  return key;
}
