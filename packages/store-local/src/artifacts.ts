/**
 * A story's artifacts as flat files, one per path. Each file is written atomically, but a write must
 * first check that no other artifact makes its name both a file and a folder, so writes take the
 * story's artifacts lock: two racing writers of `a` and `a/b` would otherwise both find the name free.
 * A remove only frees names, so it needs no lock.
 */
import { artifactPathClash, fail, type HostContext, normalizeArtifactPath, ok, type PluginResult } from "@norn/plugin-api";
import { decodeArtifactName, isHidden, type Layout } from "./layout.ts";
import { type LockTuning, withLock } from "./lock.ts";
import { corrupt } from "./records.ts";

/** The artifacts part; stories and paths are validated (and paths encoded) by the store before they reach here. */
export interface ArtifactFiles {
  read(story: string, name: string): Promise<PluginResult<string | null>>;
  write(story: string, name: string, text: string): Promise<PluginResult<null>>;
  list(story: string): Promise<PluginResult<string[]>>;
  remove(story: string, name: string): Promise<PluginResult<null>>;
}

export function artifacts(ctx: HostContext, at: Layout, tuning: LockTuning): ArtifactFiles {
  const file = (story: string, name: string) => `${at.artifacts(story)}/${name}`;
  const list = async (story: string): Promise<PluginResult<string[]>> => {
    const dir = at.artifacts(story);
    const out: string[] = [];
    for (const name of await ctx.files.list(dir)) {
      if (isHidden(name)) continue;
      const path = decodeArtifactName(name);
      if (path === null || normalizeArtifactPath(path) !== path) return corrupt(`${dir}/${name}`, "not an artifact file name");
      out.push(path);
    }
    return ok(out.sort());
  };
  return {
    read: async (story, name) => ok(await ctx.files.read(file(story, name))),
    write: (story, name, text) =>
      withLock(ctx, `${at.artifacts(story)}.lock`, tuning, async (): Promise<PluginResult<null>> => {
        const path = decodeArtifactName(name);
        if (path === null) throw new RangeError(`not an artifact file name: ${name}`);
        const existing = await list(story);
        if (!existing.ok) return existing;
        const clash = artifactPathClash(existing.value, path);
        if (clash !== null) return fail("conflict", `local store: ${path} and ${clash} cannot both be artifacts`, false);
        await ctx.files.write(file(story, name), text);
        return ok(null);
      }),
    list,
    remove: async (story, name) => {
      await ctx.files.remove(file(story, name));
      return ok(null);
    },
  };
}
