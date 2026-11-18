/**
 * Putting the pack's skills where a launched agent finds them. A brief names its skills by name
 * (`Use the norn-implement skill`), and an agent loads a project skill only from its own folder in
 * the worktree (the harness's `skillsDir`), so before every launch each pack skill is written there.
 *
 * Each skill folder norn writes holds a `.gitignore` of `*` carrying OWNER_MARK: git ignores the
 * copy, so it is never committed, and the mark tells norn's copy from the repo's own. A folder of
 * that name without the mark is the repo's skill and is left untouched, so a repo can override a
 * pack skill by committing its own.
 */
import type { HostFiles } from "@norn/plugin-api";

export type PackSkills = Readonly<Record<string, Readonly<Record<string, string>>>>;

const OWNER_MARK = "# norn: a pack skill, rewritten before every launch; edit the pack, not this copy";
const IGNORE_FILE = ".gitignore";
const IGNORE_TEXT = `${OWNER_MARK}\n*\n`;

async function readOr(files: HostFiles, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

/** Whether the folder is the repo's own skill: something is in it, and not under norn's mark. */
async function repoOwned(files: HostFiles, dir: string): Promise<boolean> {
  const mark = await readOr(files, `${dir}/${IGNORE_FILE}`);
  if (mark?.startsWith(OWNER_MARK)) return false;
  return (await files.list(dir)).length > 0;
}

/**
 * Write every skill into `<worktree>/<skillsDir>/<name>/`, a file only when its text changed, and
 * answer the paths written. The mark goes first, so a copy cut short by a crash is still norn's and
 * is completed next launch, never mistaken for the repo's.
 */
export async function installSkills(files: HostFiles, worktree: string, skillsDir: string, skills: PackSkills): Promise<string[]> {
  const changed: string[] = [];
  for (const [name, content] of Object.entries(skills)) {
    const dir = `${worktree}/${skillsDir}/${name}`;
    if (await repoOwned(files, dir)) continue;
    for (const [rel, text] of [[IGNORE_FILE, IGNORE_TEXT] as const, ...Object.entries(content)]) {
      const path = `${dir}/${rel}`;
      if ((await readOr(files, path)) === text) continue;
      await files.write(path, text);
      changed.push(path);
    }
  }
  return changed;
}
