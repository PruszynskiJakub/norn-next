/**
 * Putting the pack's skills where a launched agent finds them. A brief names its skills by name
 * (`Use the norn-implement skill`), and an agent loads a project skill only from its own folder in
 * the worktree (the harness's `skillsDir`). So before every launch each pack skill is written once
 * to `.agents/skills/<name>/`, and the harness's folder gets a link to it, `<skillsDir>/<name>` →
 * `../../.agents/skills/<name>`, the layout a repo keeping its skills in `.agents` uses itself.
 *
 * Nothing norn writes here is committed: each skill folder holds a `.gitignore` of `*` carrying
 * OWNER_MARK, and the harness's folder a marked `.gitignore` naming norn's links. The mark also
 * tells norn's copy from the repo's own: a skill folder of that name without it, or anything at a
 * link's name that is not norn's link, is the repo's and is left untouched, so a repo overrides a
 * pack skill by committing its own. A host without links gets a marked copy in the harness's folder.
 */
import { type HostFiles, isPackPath } from "@norn/plugin-api";

export type PackSkills = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Where the pack's skills are written in a worktree, and where a harness without its own folder reads them. */
export const SKILLS_DIR = ".agents/skills";

const OWNER_MARK = "# norn: pack skills, rewritten before every launch; edit the pack, not these copies";
const IGNORE_FILE = ".gitignore";
const IGNORE_ALL = `${OWNER_MARK}\n*\n`;

async function readOr(files: HostFiles, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

const marked = (text: string | null): boolean => text?.startsWith(OWNER_MARK) === true;

/** Whether the folder is the repo's own skill: something is in it, and not under norn's mark. */
async function repoOwned(files: HostFiles, dir: string): Promise<boolean> {
  if (marked(await readOr(files, `${dir}/${IGNORE_FILE}`))) return false;
  return (await files.list(dir)).length > 0;
}

/**
 * Write the skill's files into `dir` under the mark, each only when its text changed. The mark goes
 * first, so a copy cut short by a crash is still norn's and is completed next launch.
 */
async function writeCopy(files: HostFiles, dir: string, content: Readonly<Record<string, string>>, changed: string[]): Promise<void> {
  for (const [rel, text] of [[IGNORE_FILE, IGNORE_ALL] as const, ...Object.entries(content)]) {
    const path = `${dir}/${rel}`;
    if ((await readOr(files, path)) === text) continue;
    await files.write(path, text);
    changed.push(path);
  }
}

type Linker = Required<Pick<HostFiles, "symlink" | "readLink">>;

/**
 * Link `<dir>/<name>` to `target` unless something not norn's is at that name. Answers whether the
 * name is norn's link now, so the folder's `.gitignore` names it.
 */
async function linkSkill(files: HostFiles & Linker, dir: string, name: string, target: string, changed: string[]): Promise<boolean> {
  const path = `${dir}/${name}`;
  const current = await files.readLink(path);
  if (current === target) return true;
  // another link, or a file or folder, at the name: the repo's, left as it is
  if (current !== null || (await files.list(dir)).includes(name)) return false;
  await files.symlink(target, path);
  changed.push(path);
  return true;
}

/**
 * Write every skill to `<worktree>/.agents/skills/` and make it reachable from `skillsDir`, and
 * answer the paths written. A `skillsDir` that is not a plain relative folder is refused: the links
 * climb out of it by its depth.
 */
export async function installSkills(files: HostFiles, worktree: string, skillsDir: string, skills: PackSkills): Promise<string[]> {
  if (!isPackPath(skillsDir)) throw new Error(`skills folder ${JSON.stringify(skillsDir)} is not a relative folder inside the worktree`);
  const changed: string[] = [];
  const own = `${worktree}/${SKILLS_DIR}`;
  for (const [name, content] of Object.entries(skills)) {
    if (!(await repoOwned(files, `${own}/${name}`))) await writeCopy(files, `${own}/${name}`, content, changed);
  }
  if (skillsDir === SKILLS_DIR) return changed;
  const dir = `${worktree}/${skillsDir}`;
  if (!files.symlink || !files.readLink) {
    for (const [name, content] of Object.entries(skills)) if (!(await repoOwned(files, `${dir}/${name}`))) await writeCopy(files, `${dir}/${name}`, content, changed);
    return changed;
  }
  const linker = files as HostFiles & Linker;
  const up = "../".repeat(skillsDir.split("/").length);
  const linked: string[] = [];
  for (const name of Object.keys(skills)) if (await linkSkill(linker, dir, name, `${up}${SKILLS_DIR}/${name}`, changed)) linked.push(name);
  await ignoreLinks(files, dir, linked, changed);
  return changed;
}

/**
 * The names, relative to a worktree, at which installSkills links the pack's skills into `skillsDir`:
 * norn's alone, never the repo's work, whether or not a `.gitignore` there names them. Copies need no
 * listing, as each holds its own ignore-all.
 */
export function skillLinks(skillsDir: string | undefined, skills: PackSkills): string[] {
  if (skillsDir === undefined || skillsDir === SKILLS_DIR) return [];
  return Object.keys(skills).map((name) => `${skillsDir}/${name}`);
}

/**
 * A git-ignored link is never committed, and a link cannot hold the `.gitignore` its target folder
 * does, so the harness's folder gets one naming them. A `.gitignore` there that is not norn's is the
 * repo's and is never rewritten.
 */
async function ignoreLinks(files: HostFiles, dir: string, linked: readonly string[], changed: string[]): Promise<void> {
  if (linked.length === 0) return;
  const path = `${dir}/${IGNORE_FILE}`;
  const current = await readOr(files, path);
  if (current !== null && !marked(current)) return;
  const text = `${OWNER_MARK}\n/${IGNORE_FILE}\n${linked.map((n) => `/${n}`).join("\n")}\n`;
  if (current === text) return;
  await files.write(path, text);
  changed.push(path);
}
