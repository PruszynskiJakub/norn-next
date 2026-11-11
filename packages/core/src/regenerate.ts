/**
 * The team's generated-file mapping (`regenerate` in the team config), matched against a path.
 * Both act (which conflicts a base update may regenerate) and the light path (which regenerated
 * merges count as clean) read it here, so the two never disagree on what is generated.
 */

/** The trailer on a merge commit norn completed by regenerating: the conflicted paths it took from the base. */
export const REGENERATED_TRAILER = "Norn-Regenerated";

/** One mapping entry as matching needs it: repo-relative path globs. */
export interface RegenerateGlobs {
  paths: readonly string[];
}

/** Does any of `globs` match `path`? (`*` stays inside a folder, `**` crosses folders.) */
export function globMatches(globs: readonly string[], path: string): boolean {
  return globs.some((g) => new Bun.Glob(g).match(path));
}

/** The entries whose globs match `path`, in mapping order. */
export function regenerateEntriesFor<E extends RegenerateGlobs>(entries: readonly E[], path: string): E[] {
  return entries.filter((e) => globMatches(e.paths, path));
}

/** Every one of `paths` matched by some entry; [] paths is not regenerable (nothing to regenerate). */
export function allRegenerable(entries: readonly RegenerateGlobs[], paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((p) => regenerateEntriesFor(entries, p).length > 0);
}
