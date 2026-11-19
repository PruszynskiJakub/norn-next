/**
 * Whether the commits between two heads touch only a story's spec folder: the story's own notes,
 * which travel with its next code push rather than sending the story back to push them alone.
 */
import { ok, type PluginResult, type Vcs } from "@norn/plugin-api";
import { SPECS_DIR } from "@norn/schema";

/** True when every path that differs from `from` to `to` lies in `story`'s spec folder; a vcs that cannot name paths answers false, so every commit counts. */
export async function specOnly(vcs: Vcs, story: string, from: string, to: string): Promise<PluginResult<boolean>> {
  if (!vcs.changedPaths) return ok(false);
  const paths = await vcs.changedPaths(from, to);
  if (!paths.ok) return paths;
  const folder = `${SPECS_DIR}/${story}/`;
  return ok(paths.value.every((p) => p.startsWith(folder)));
}
