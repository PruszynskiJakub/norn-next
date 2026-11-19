/**
 * The norn home and the machine dir of a checkout. The machine dir is keyed by the git common dir,
 * so every worktree of one repository (a unit's worktree included) shares it, and two clones never do.
 */
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { HostContext } from "@norn/plugin-api";
import { refuse } from "./output.ts";

export const HOME_ENV = "NORN_HOME_DIR";

/** `NORN_HOME_DIR`, else `~/.norn`. */
export function nornHome(env: Readonly<Record<string, string | undefined>>, userHome: string): string {
  const given = env[HOME_ENV];
  return given ? given : join(userHome, ".norn");
}

/** `<folder>-<8 hex>`: readable in a listing, and unique per common dir. */
export function machineId(commonDir: string): string {
  const checkout = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
  const folder = basename(checkout).replace(/\.git$/, "") || "repo";
  return `${folder}-${createHash("sha256").update(commonDir).digest("hex").slice(0, 8)}`;
}

export interface RepoIdentity {
  /** the main checkout: where the repo's config files are read, and what plugins see as `repo.root` */
  root: string;
  /** git's common dir, absolute and canonical */
  common: string;
  /** the machine dir's name under `<home>/repos/` */
  id: string;
}

/**
 * Which repository `cwd` belongs to, asked of git: `--path-format=absolute` gives canonical paths, so
 * a worktree reached through a symlink still names the same common dir.
 */
export async function locateRepo(exec: HostContext["exec"], cwd: string): Promise<RepoIdentity> {
  const out = await exec(["git", "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { cwd });
  const [common, top] = out.stdout.split("\n").map((l) => l.trim());
  if (out.code !== 0 || !common) throw refuse(`${cwd} is not inside a git repository`, "run norn from a git checkout, or `git init` one", "not_a_repo");
  // a bare repository's linked worktree has no main checkout: its own top level stands for it
  const root = basename(common) === ".git" ? dirname(common) : (top ?? common);
  return { root, common, id: machineId(common) };
}

/** Where norn keeps a home's and a checkout's files; every path here is outside every worktree. */
export const homePaths = (home: string) => ({
  userConfig: join(home, "config.yaml"),
  /** a bun project the installed plugins live in */
  plugins: join(home, "plugins"),
  repos: join(home, "repos"),
  /** who this machine claims as, fixed on first use (see holder.ts) */
  holder: join(home, "holder.json"),
});

export const machineDir = (home: string, id: string): string => join(homePaths(home).repos, id);
