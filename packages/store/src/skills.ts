/**
 * Skills on disk (SK1): one committed copy of each bundled skill folder in `.agents/skills/`,
 * linked from each agent's own skill folder. `norn init` overwrites the bundled folders whole
 * (S1 atomic writes per file); a repo customizes a skill by writing its own under another name.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { VERSION_PATTERN, versionMatch } from "@norn/schema";
import { parse as parseYaml } from "yaml";
import { atomicWrite, readText, safeUnlink } from "./fsx.ts";
import { repoConfigPath } from "./paths.ts";

export const SKILLS_DIR = ".agents/skills";
const skillsDir = (root: string) => join(root, SKILLS_DIR);

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

/** A bundled skill folder as read once: its files, their sizes, and their bytes once a compare needs them. */
interface FolderCopy {
  files: string[];
  sizes: number[];
  bytes(i: number): Buffer;
}

/**
 * The bundled skill folders in `dir`, each read once on its first compare: one load compares many
 * worktrees against them. Hold it no longer than one load, so a changed source is read again.
 */
export interface SkillSource {
  dir: string;
  folder(name: string): FolderCopy;
}

export function skillSource(dir: string): SkillSource {
  const read = new Map<string, FolderCopy>();
  return {
    dir,
    folder(name) {
      let copy = read.get(name);
      if (!copy) {
        const at = join(dir, name);
        const files = filesUnder(at);
        const bytes: Buffer[] = [];
        copy = { files, sizes: files.map((f) => statSync(join(at, f)).size), bytes: (i) => (bytes[i] ??= readFileSync(join(at, files[i] as string))) };
        read.set(name, copy);
      }
      return copy;
    },
  };
}

const sourceOf = (source: string | SkillSource): SkillSource => (typeof source === "string" ? skillSource(source) : source);

/** True when folder `b` holds the same files with the same bytes as the copy (sizes first, so a changed file rarely costs a read). */
function sameFolder(a: FolderCopy, b: string): boolean {
  const fb = filesUnder(b);
  if (a.files.join("\n") !== fb.join("\n")) return false;
  if (a.files.some((f, i) => statSync(join(b, f)).size !== a.sizes[i])) return false;
  return a.files.every((f, i) => readFileSync(join(b, f)).equals(a.bytes(i)));
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
  const source = skillSource(sourceDir);
  for (const name of names) {
    const from = join(sourceDir, name);
    const to = join(dest, name);
    if (!isLink(to) && sameFolder(source.folder(name), to)) {
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
function isSkillLinked(root: string, agentDir: string, name: string): boolean {
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

/**
 * The bundled skills in `skillsFolder` that differ from this norn's copies in `sourceDir` (B21).
 * Only `names` are compared, so a repo-local skill is never named; a missing skill is not drift.
 */
export function skillsDrift(skillsFolder: string, source: string | SkillSource, names: readonly string[]): string[] {
  const src = sourceOf(source);
  return names.filter((n) => existsSync(join(skillsFolder, n, "SKILL.md")) && !sameFolder(src.folder(n), join(skillsFolder, n)));
}

/** The `norn_version` a team file records, or null (none, unreadable, not a version). */
export function recordedNornVersion(teamFile: string): string | null {
  const raw = readText(teamFile);
  if (raw === null) return null;
  try {
    const v = (parseYaml(raw) as { norn_version?: unknown } | null)?.norn_version;
    return typeof v === "string" && new RegExp(VERSION_PATTERN).test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * gh-61 B20, D14: the bundled skills in a worktree that differ from the running norn's (`skillsDrift`
 * on its `.agents/skills/`) — none when the worktree's own team file records a `norn_version` newer
 * than `running`: its skills belong to the version that branch moves to.
 */
export function worktreeSkillsDrift(root: string, source: string | SkillSource, names: readonly string[], running: string): string[] {
  const recorded = recordedNornVersion(repoConfigPath(root));
  if (recorded && versionMatch(recorded, running) === "older") return [];
  return skillsDrift(skillsDir(root), source, names);
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
  const drifted = skillsDrift(dir, sourceDir, names);
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
