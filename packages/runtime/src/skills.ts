/**
 * Putting the pack's skills where a launched agent finds them. A brief names its skills by name
 * (`Use the norn-implement skill`), and an agent loads a project skill only from its own folder in
 * the worktree (the harness's `skillsDir`). So before every launch each pack skill is written once
 * to `.agents/skills/<name>/`, and the harness's folder gets a link to it, `<skillsDir>/<name>` →
 * `../../.agents/skills/<name>`, the layout a repo keeping its skills in `.agents` uses itself.
 *
 * Nothing norn writes here is committed: each skill folder holds a `.gitignore` of `*` carrying
 * the skills' owner mark (`skillMark` in `ownership.ts`), and the harness's folder a marked
 * `.gitignore` naming norn's links. The mark also tells norn's copy from the repo's own: a skill
 * folder of that name without it, or anything at a link's name that is not norn's link, is the
 * repo's and is left untouched, so a repo overrides a pack skill by committing its own. A host without links gets a marked copy in the harness's folder.
 *
 * This is the mount table's skills row writer (mount.ts). Which skill wins a name is the overlay
 * rule's call, the repo's unmarked folders over the pack; the mark stays the guard at every write,
 * since the folder can change between reading the layer and writing it.
 */
import { type HostFiles, isPackPath } from "@norn/plugin-api";
import { byName, overlay } from "./overlay.ts";
import { skillMark } from "./ownership.ts";

export type PackSkills = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Where the pack's skills are written in a worktree, and where a harness without its own folder reads them. */
export const SKILLS_DIR = ".agents/skills";

async function readOr(files: HostFiles, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

/**
 * Write the skill's files into `dir` under the mark, each only when its text changed. The mark goes
 * first, so a copy cut short by a crash is still norn's and is completed next launch.
 */
async function writeCopy(files: HostFiles, dir: string, content: Readonly<Record<string, string>>, changed: string[]): Promise<void> {
  for (const [rel, text] of [[skillMark.ignoreFile, skillMark.folderText] as const, ...Object.entries(content)]) {
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
  const holder = await skillMark.linkHolder(files, dir, name, target);
  if (holder !== "free") return holder === "norn";
  const path = `${dir}/${name}`;
  await files.symlink(target, path);
  changed.push(path);
  return true;
}

/**
 * The repo's layer: each folder under `.agents/skills/` of a pack skill's name that holds something
 * without the mark. Only the pack's names are read, since only they can contend, and anything else
 * there (a README, the repo's own skills) is no folder norn may look into. Its value is never read,
 * only its name, since a winner the repo holds is left where it is.
 */
async function repoSkills(files: HostFiles, own: string, packNames: readonly string[]): Promise<Record<string, true>> {
  let names: string[];
  try {
    names = await files.list(own);
  } catch {
    return {};
  }
  const out: Record<string, true> = {};
  for (const name of packNames) if (names.includes(name) && !(await skillMark.mayWriteFolder(files, `${own}/${name}`))) out[name] = true;
  return out;
}

/** The pack's skills that win their name over the repo's own, by the overlay rule. */
async function packWinners(files: HostFiles, own: string, skills: PackSkills): Promise<[string, Readonly<Record<string, string>>][]> {
  const won = overlay<"pack" | "repo", unknown>(
    [
      { label: "pack", value: skills },
      { label: "repo", value: await repoSkills(files, own, Object.keys(skills)) },
    ],
    byName((name) => name),
  );
  return Object.entries(skills).filter(([name]) => won.originOf(name) === "pack");
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
  const winners = await packWinners(files, own, skills);
  for (const [name, content] of winners) {
    if (await skillMark.mayWriteFolder(files, `${own}/${name}`)) await writeCopy(files, `${own}/${name}`, content, changed);
  }
  if (skillsDir === SKILLS_DIR) return changed;
  const dir = `${worktree}/${skillsDir}`;
  if (!files.symlink || !files.readLink) {
    for (const [name, content] of winners) if (await skillMark.mayWriteFolder(files, `${dir}/${name}`)) await writeCopy(files, `${dir}/${name}`, content, changed);
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
 * A git-ignored link is never committed, and a link cannot hold the `.gitignore` its target folder
 * does, so the harness's folder gets one naming them. A `.gitignore` there that is not norn's is the
 * repo's and is never rewritten.
 */
async function ignoreLinks(files: HostFiles, dir: string, linked: readonly string[], changed: string[]): Promise<void> {
  if (linked.length === 0) return;
  const path = `${dir}/${skillMark.ignoreFile}`;
  if (!(await skillMark.mayWriteIgnore(files, path))) return;
  const text = skillMark.linksText(linked);
  if ((await readOr(files, path)) === text) return;
  await files.write(path, text);
  changed.push(path);
}
