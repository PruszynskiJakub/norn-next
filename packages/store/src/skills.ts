/**
 * Skills on disk (SK1): one committed copy of each bundled skill folder in `.agents/skills/`,
 * linked from each agent's own skill folder. `norn init` overwrites the bundled folders whole
 * (S1 atomic writes per file); a repo customizes a skill by writing its own under another name.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { atomicWrite, safeUnlink } from "./fsx.ts";

export const SKILLS_DIR = ".agents/skills";
export const skillsDir = (root: string) => join(root, SKILLS_DIR);

/** The marker norn 0.1.0 put into each skill copy it installed; such copies are norn's to replace or remove. */
export const LEGACY_SKILL_MARKER = "<!-- norn-owned: managed by `norn init`; remove this line to keep local edits -->";

/** Every file under `dir`, as paths relative to it, sorted. */
function filesUnder(dir: string, rel = ""): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = rel ? join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/** True when two skill folders hold the same files with the same bytes. */
function sameFolder(a: string, b: string): boolean {
  const fa = filesUnder(a);
  const fb = filesUnder(b);
  if (fa.join("\n") !== fb.join("\n")) return false;
  return fa.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

export interface SkillsInstall {
  dir: string;
  /** written or changed by this install (`git diff .agents/skills/` shows how) */
  updated: string[];
  unchanged: string[];
}

/** Copy each bundled skill folder from `sourceDir` into `.agents/skills/`, replacing what is there. */
export function installSkills(root: string, sourceDir: string, names: readonly string[]): SkillsInstall {
  const dest = skillsDir(root);
  const out: SkillsInstall = { dir: dest, updated: [], unchanged: [] };
  for (const name of names) {
    const from = join(sourceDir, name);
    const to = join(dest, name);
    if (!isLink(to) && sameFolder(from, to)) {
      out.unchanged.push(name);
      continue;
    }
    if (isLink(to) || (existsSync(to) && !statSync(to).isDirectory())) rmSync(to, { force: true });
    const keep = new Set(filesUnder(from));
    for (const f of keep) atomicWrite(join(to, f), readFileSync(join(from, f)));
    for (const f of filesUnder(to)) if (!keep.has(f)) safeUnlink(join(to, f));
    removeEmptyDirs(to);
    out.updated.push(name);
  }
  return out;
}

function removeEmptyDirs(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    removeEmptyDirs(sub);
    if (readdirSync(sub).length === 0) rmSync(sub, { recursive: true });
  }
}

export interface SkillLinks {
  dir: string;
  linked: string[];
  unchanged: string[];
  /** a folder of that name that norn did not install; left alone */
  kept: string[];
}

/** The relative link target from `agentDir/<name>` to `.agents/skills/<name>`. */
const linkTarget = (root: string, agentDir: string, name: string) => relative(agentDir, join(skillsDir(root), name));

/** True when `<agentDir>/<name>` is a link to `.agents/skills/<name>`. */
export function isSkillLinked(root: string, agentDir: string, name: string): boolean {
  const path = join(agentDir, name);
  if (!isLink(path)) return false;
  return resolve(agentDir, readlinkSync(path)) === resolve(skillsDir(root), name);
}

/** True when a folder is a copy norn 0.1.0 installed (its SKILL.md carries the legacy marker). */
function isLegacyCopy(path: string): boolean {
  try {
    return readFileSync(join(path, "SKILL.md"), "utf8").includes(LEGACY_SKILL_MARKER);
  } catch {
    return false;
  }
}

/**
 * Link each skill from an agent's skill folder to `.agents/skills/` (one copy for every agent).
 * An agent that reads `.agents/skills/` itself needs no links. A stale link or a copy norn
 * installed is replaced (atomically: link at a temp name, then rename); anything else is kept.
 */
export function linkSkills(root: string, agentDir: string, names: readonly string[]): SkillLinks {
  const out: SkillLinks = { dir: agentDir, linked: [], unchanged: [], kept: [] };
  if (resolve(agentDir) === resolve(skillsDir(root))) {
    out.unchanged.push(...names);
    return out;
  }
  for (const name of names) {
    const path = join(agentDir, name);
    if (isSkillLinked(root, agentDir, name)) {
      out.unchanged.push(name);
      continue;
    }
    if (existsSync(path) && !isLink(path)) {
      if (!isLegacyCopy(path)) {
        out.kept.push(name);
        continue;
      }
      rmSync(path, { recursive: true, force: true });
    }
    const tmp = join(agentDir, `.${name}.${process.pid}.link.tmp`);
    rmSync(tmp, { force: true });
    mkdirSync(agentDir, { recursive: true });
    symlinkSync(linkTarget(root, agentDir, name), tmp, "dir");
    renameSync(tmp, path);
    out.linked.push(name);
  }
  return out;
}

/** Skill folders an agent can see in `dir` (links followed): those holding a SKILL.md. */
export function visibleSkills(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => !n.startsWith(".") && existsSync(join(dir, n, "SKILL.md")))
      .sort();
  } catch {
    return [];
  }
}

export interface SkillsReport {
  dir: string;
  /** bundled skills absent from `.agents/skills/` */
  missing: string[];
  /** present, but not the bundled version (`norn init` updates them) */
  drifted: string[];
  /** per agent: bundled skills its skill folder does not link */
  unlinked: Record<string, string[]>;
}

/** Compare the installed skills with the bundled ones (doctor, SK1). */
export function skillsReport(root: string, sourceDir: string, names: readonly string[], agentDirs: Record<string, string>): SkillsReport {
  const dir = skillsDir(root);
  const missing = names.filter((n) => !existsSync(join(dir, n, "SKILL.md")));
  const drifted = names.filter((n) => !missing.includes(n) && !sameFolder(join(sourceDir, n), join(dir, n)));
  const unlinked: Record<string, string[]> = {};
  for (const [agent, agentDir] of Object.entries(agentDirs)) {
    if (resolve(agentDir) === resolve(dir)) continue;
    const off = names.filter((n) => !isSkillLinked(root, agentDir, n));
    if (off.length) unlinked[agent] = off;
  }
  return { dir, missing, drifted, unlinked };
}

/**
 * Remove norn's skills (uninstall): the bundled folders in `.agents/skills/`, the links to them
 * in each agent folder, and any copy norn 0.1.0 installed there. Everything else stays.
 */
export function removeSkills(root: string, names: readonly string[], agentDirs: readonly string[]): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  const canonical = resolve(skillsDir(root));
  for (const agentDir of new Set(agentDirs.map((d) => resolve(d)))) {
    if (agentDir === canonical) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(agentDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(agentDir, name);
      if (isSkillLinked(root, agentDir, name) || isLegacyCopy(path)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      } else if (names.includes(name)) kept.push(path);
    }
  }
  for (const name of names) {
    const path = join(canonical, name);
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  for (const name of readdirSafe(canonical)) {
    const path = join(canonical, name);
    if (isLegacyCopy(path)) {
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  if (existsSync(canonical) && readdirSafe(canonical).length === 0) rmSync(canonical, { recursive: true });
  return { removed, kept };
}

const readdirSafe = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
