/**
 * The bundled skills observe and the view compare a worktree against. A
 * difference never refuses a session or holds a run; it is a Check item in the inbox.
 */
import { join } from "node:path";
import { assetsDir } from "./assets.ts";
import { bundledSkills } from "./workflows.ts";

/** This norn's bundled skills — their source folder and names — for observe and the view to compare against. */
export function bundledSkillSet(env: Record<string, string | undefined>): { source: string; names: string[] } {
  return { source: join(assetsDir(env), "skills"), names: bundledSkills(env) };
}
