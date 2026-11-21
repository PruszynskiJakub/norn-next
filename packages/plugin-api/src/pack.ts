/**
 * The pack slot: workflows, the shared files they `use`, the skills their steps name, and the roles
 * their agent steps name, shipped together as text and data. A pack carries files, never code, so the
 * runtime loads its workflows through the kernel's loader exactly as it would a repo's own and a pack
 * can never bypass the workflow checks.
 */
import { type RoleDefinition, rolesProblems } from "./role.ts";

export interface Pack {
  /** workflow file name (`story.yaml`) to its YAML text */
  workflows: Record<string, string>;
  /** shared file path (`base-update.yaml`) to its YAML text; workflows reach these through `use` */
  shared: Record<string, string>;
  /** skill name to its files, each by a path relative to the skill's folder; every skill has a `SKILL.md` */
  skills: Record<string, Record<string, string>>;
  /** the roles its workflows' agent steps name with `by:` (plugin API 1.23); absent: the shipped pack's */
  roles?: Record<string, RoleDefinition>;
}
export const SKILL_NAME_PATTERN = "^[a-z][a-z0-9-]*$";
const SKILL_NAME_RE = new RegExp(SKILL_NAME_PATTERN);
const YAML_FILE_RE = /\.ya?ml$/;

type Loose = Record<string, unknown>;

/**
 * Whether `path` may name a file inside a pack: relative, canonical and never climbing out. A pack's
 * files are written into a repo or a machine folder by path, so a `..` would let one escape it.
 */
export function isPackPath(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.endsWith("/")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

function filesProblems(what: string, given: unknown, yamlOnly: boolean): string[] {
  if (given === null || typeof given !== "object" || Array.isArray(given)) return [`${what} must be an object of file texts`];
  const out: string[] = [];
  for (const [path, text] of Object.entries(given as Loose)) {
    if (!isPackPath(path)) out.push(`${what} path ${JSON.stringify(path)} is not a relative file path`);
    else if (yamlOnly && !YAML_FILE_RE.test(path)) out.push(`${what} file ${path} is not a .yaml file`);
    if (typeof text !== "string") out.push(`${what} file ${path} is not text`);
  }
  return out;
}

/** What is wrong with a value offered as a pack; empty when it fits the contract. */
export function packProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object") return ["is not an object"];
  const v = value as Loose;
  const out = [...filesProblems("workflows", v.workflows, true), ...filesProblems("shared", v.shared, true)];
  const skills = v.skills;
  if (skills === null || typeof skills !== "object" || Array.isArray(skills)) return [...out, "skills must be an object"];
  for (const [name, files] of Object.entries(skills as Loose)) {
    if (!SKILL_NAME_RE.test(name)) out.push(`skill name ${JSON.stringify(name)} must match ${SKILL_NAME_PATTERN}`);
    const found = filesProblems(`skill ${name}`, files, false);
    out.push(...found);
    if (found.length === 0 && typeof (files as Loose)["SKILL.md"] !== "string") out.push(`skill ${name} has no SKILL.md`);
  }
  if (v.roles !== undefined) out.push(...rolesProblems(v.roles));
  return out;
}
