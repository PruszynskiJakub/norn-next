/**
 * Every skill an agent in a repo can use, and where norn finds it: the pack's own, a folder holding a
 * `SKILL.md` in the repo's `.agents/skills/`, or one in a harness's own skills folder. `norn skill list`
 * prints it and doctor's unseen-skill warning checks a workflow's skills against it, so the two never
 * disagree. A folder named like a pack skill is the pack's copy or link, norn's own, and reads as the
 * pack's. The harness may also load skills norn cannot see (a user-level folder, a harness plugin's).
 */
import type { Harness, HostFiles, Pack } from "@norn/plugin-api";
import { SKILLS_DIR } from "@norn/runtime";
import type { SkillListEntry } from "@norn/schema";
import { parse } from "yaml";

/** The repo a lookup reads besides the pack: its files and the harnesses its executors run. */
export interface SkillRepo {
  files: HostFiles;
  root: string;
  harnesses: readonly Harness[];
}

async function readOr(files: HostFiles, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

async function listOr(files: HostFiles, dir: string): Promise<string[]> {
  try {
    return await files.list(dir);
  } catch {
    return [];
  }
}

/** The `description` of a SKILL.md's frontmatter, or null when it has none. */
export function skillDescription(text: string): string | null {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  try {
    const d = (parse(fm[1] as string) as { description?: unknown } | null)?.description;
    return typeof d === "string" && d.trim() ? d.trim().replace(/\s+/g, " ") : null;
  } catch {
    return null;
  }
}

/** The description's "Use when" or "Use for" clause, up to the end of its sentence. */
export function useWhen(description: string | null): string | null {
  const m = description?.match(/\bUse (when|for)\b[\s\S]*?(\.(?=\s|$)|$)/);
  return m ? m[0].trim() : null;
}

/** Every skill, the pack's first, then the repo's, then each harness folder's; null `repo` reads the pack alone. */
export async function lookupSkills(pack: Pack["skills"], repo: SkillRepo | null): Promise<SkillListEntry[]> {
  const out: SkillListEntry[] = [];
  for (const name of Object.keys(pack).sort()) {
    const description = skillDescription(pack[name]?.["SKILL.md"] ?? "");
    out.push({ name, use_when: useWhen(description), description, source: "pack", path: null });
  }
  if (!repo) return out;
  const folders: Array<{ dir: string; harness: string | null }> = [{ dir: SKILLS_DIR, harness: null }];
  for (const h of repo.harnesses) if (h.skillsDir && !folders.some((f) => f.dir === h.skillsDir)) folders.push({ dir: h.skillsDir, harness: h.name });
  const seen = new Set(out.map((s) => s.name));
  for (const { dir, harness } of folders) {
    for (const name of (await listOr(repo.files, `${repo.root}/${dir}`)).sort()) {
      if (seen.has(name)) continue;
      const text = await readOr(repo.files, `${repo.root}/${dir}/${name}/SKILL.md`);
      if (text === null) continue;
      seen.add(name);
      const description = skillDescription(text);
      out.push({ name, use_when: useWhen(description), description, ...(harness ? { source: "harness", harness } : { source: "repo" }), path: `${dir}/${name}` });
    }
  }
  return out;
}
