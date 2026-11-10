/**
 * Repository layout. Every function returns an absolute path from a root
 * (the main checkout or a story worktree — both hold the same relative layout).
 * The checkout's machine-local files live outside it, in the machine dir.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { CONFIG_FILES, LEGACY_SPEC_FILE, parseSliceKey, SPEC_FILE, SPECS_DIR, STORY_UNIT_DIR, sliceDirName, storyDirName, LEGACY_STORY_HANDOFF_PATH, unitHandoffPath } from "@norn/schema";

/** The committed repo config and workflows, relative to a root, as messages name them. */
export const REPO_CONFIG_FILE = CONFIG_FILES.repo;
/** Your settings for this repo (gitignored). */
export const LOCAL_CONFIG_FILE = CONFIG_FILES.local;
/** The JSON schema copies editors read through the starters' modelines. */
export const REPO_CONFIG_SCHEMA_FILE = ".agents/norn.config.schema.json";
export const LOCAL_CONFIG_SCHEMA_FILE = ".agents/norn.config.local.schema.json";
/** under the norn home, next to `config.yaml` */
export const USER_CONFIG_SCHEMA_FILE = "config.schema.json";
export const WORKFLOWS_DIR = ".agents/workflows";

export const repoConfigPath = (root: string) => join(root, REPO_CONFIG_FILE);
export const workflowsDir = (root: string) => join(root, WORKFLOWS_DIR);
/** Whether norn is set up in this checkout (the cockpit falls back to the last repo otherwise). */
export const isNornRepo = (root: string) => existsSync(repoConfigPath(root)) || existsSync(workflowsDir(root));

/** The checkout a root belongs to: its git common dir (real path) and the main checkout's path. */
export interface CheckoutOf {
  /** real path of the git common dir; a root outside git stands for itself */
  common: string;
  /** the main checkout (the common dir's parent), or the root outside git */
  checkout: string;
  /** `<folder>-<first 8 hex of sha256(common)>` */
  id: string;
}

const realOr = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The git dir `.git` names under `dir` (a folder, or a `gitdir:` file in a linked worktree), or null. */
function gitDirAt(dir: string): string | null {
  const dotgit = join(dir, ".git");
  try {
    if (statSync(dotgit).isDirectory()) return dotgit;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, "utf8"));
    if (!m?.[1]) return null;
    const gd = m[1].trim();
    return isAbsolute(gd) ? gd : resolve(dir, gd);
  } catch {
    return null;
  }
}

const checkouts = new Map<string, CheckoutOf>();

/**
 * Which checkout `root` belongs to, from the files git keeps (no git process): walk up to a `.git`,
 * follow a linked worktree's `gitdir:` and its `commondir`, take the real path. Every worktree of one
 * repository resolves to the same common dir, so all share one machine dir; two clones never do.
 * `root` is a located checkout (or a unit worktree), so the walk-up only matters for a path inside one;
 * a root outside git stands for itself. A submodule's common dir is `.git/modules/<x>` and names it.
 */
export function checkoutOf(root: string): CheckoutOf {
  const cached = checkouts.get(root);
  if (cached) return cached;
  let dir = resolve(root);
  let gitDir: string | null = null;
  for (;;) {
    gitDir = gitDirAt(dir);
    if (gitDir) break;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  let common: string;
  if (gitDir) {
    let c = gitDir;
    try {
      const rel = readFileSync(join(gitDir, "commondir"), "utf8").trim();
      if (rel) c = isAbsolute(rel) ? rel : resolve(gitDir, rel);
    } catch {
      // no commondir: the git dir is the common dir (main checkout, submodule)
    }
    common = realOr(c);
  } else common = realOr(root);
  const checkout = gitDir ? (basename(common) === ".git" ? dirname(common) : common) : common;
  const folder = basename(checkout).replace(/\.git$/, "") || "repo";
  const out = { common, checkout, id: `${folder}-${createHash("sha256").update(common).digest("hex").slice(0, 8)}` };
  if (gitDir) checkouts.set(root, out);
  return out;
}

/** Norn home per checkout (by common dir), bound by whoever knows it (cli context, view); else NORN_HOME_DIR or ~/.norn. */
const homes = new Map<string, string>();

/**
 * Bind the norn home the machine dir of `root`'s checkout lives in. A command's home comes with its
 * context (`--home`, its env's NORN_HOME_DIR), not the process env; store's path functions take only
 * the root, so the cli binds it once it knows the repo.
 */
export function bindNornHome(root: string, home: string): void {
  homes.set(checkoutOf(root).common, home);
}

/** Drop a binding made for a throwaway checkout (doctor's scratch unit). */
export function unbindNornHome(root: string): void {
  homes.delete(checkoutOf(root).common);
  checkouts.delete(root);
}

/** The norn home `root`'s machine dir lives in. */
const machineHomeOf = (root: string) => homes.get(checkoutOf(root).common) ?? nornHome();

/** The checkout's machine-local files (trace, locks, heartbeat, caches), `<norn home>/repos/<id>/`. */
export const machineDir = (root: string) => join(machineReposDir(machineHomeOf(root)), checkoutOf(root).id);
export const machineReposDir = (home: string) => join(home, "repos");
/** Names the checkout a machine dir belongs to, so doctor can tell an orphan after a repo folder moved. */
export const checkoutFilePath = (dir: string) => join(dir, "checkout.json");
/** The headless runner's default session log dir, the machine dir's `sessions/` (`runs/` holds run state). */
export const runnerLogDir = (root: string) => join(machineDir(root), "sessions");
/** Local tick lock; in the machine dir. */
export const tickLockPath = (root: string) => join(machineDir(root), "tick.lock");
/** A story's integrate lock — slice integrations and base updates of one story never interleave. */
export const integrateLockPath = (root: string, story: string) => join(machineDir(root), `integrate-${story}.lock`);

/** Machine-local runtime files of one checkout, in the machine dir. */
export const heartbeatFilePath = (root: string) => join(machineDir(root), "heartbeat.json");
export const actFailuresPath = (root: string) => join(machineDir(root), "failures.json");
export const remoteCachePath = (root: string) => join(machineDir(root), "remote.json");
export const notifiedPath = (root: string) => join(machineDir(root), "notified.json");
export const pendingRecordsPath = (root: string) => join(machineDir(root), "records.json");
export const foreignCommitsPath = (root: string) => join(machineDir(root), "foreign.json");
export const inboxOpenPath = (root: string) => join(machineDir(root), "inbox.json");
export const baseFactsPath = (root: string) => join(machineDir(root), "base.json");
export const noticesPath = (root: string) => join(machineDir(root), "notices.json");
/** The mailbox receipts this checkout's ticks rejected, next to the notices */
export const rejectedReceiptsPath = (root: string) => join(machineDir(root), "rejected.json");
/** Records set aside as superseded, `superseded/<story>-<ulid>/` in the machine dir */
export const supersededDir = (root: string) => join(machineDir(root), "superseded");
/** The lock around a read-modify-write of `rejected.json` (a tick's keep, tidy's prune). */
export const rejectedLockPath = (root: string) => join(machineDir(root), "rejected.lock");
export const prFactsPath = (root: string) => join(machineDir(root), "pr.json");
export const issueFactsPath = (root: string) => join(machineDir(root), "issue.json");
/**
 * A unit's hook file — `hooks/<story>/_story.jsonl` for the story unit,
 * `hooks/<story>/<nn>.jsonl` for a slice.
 */
export function hookFilePath(root: string, unit: { story: string; slice?: string | null }): string {
  const nn = unit.slice ? parseSliceKey(unit.slice)?.nn : null;
  if (unit.slice && !nn) throw new Error(`not a slice key: ${unit.slice}`);
  return join(hooksDir(root), unit.story, `${nn ?? STORY_UNIT_DIR}.jsonl`);
}
/** The machine dir's `hooks/`, one folder per story holding its units' hook files. */
export const HOOKS_DIR = "hooks";
export const hooksDir = (root: string) => join(machineDir(root), HOOKS_DIR);
/** The one-time backfill of the hook files from the day files (`hooks/backfill.json`). */
export const hookBackfillPath = (root: string) => join(hooksDir(root), "backfill.json");
/**
 * The machine dir's `stop-blocks/<run_id>/`: one file per turn end refused for the run, named by its
 * index below the cap. The files are only ever created exclusively, never read or parsed, so they are
 * not JSON and have no schema.
 */
export const STOP_BLOCKS_DIR = "stop-blocks";
export const stopBlocksDir = (root: string, runId: string) => join(machineDir(root), STOP_BLOCKS_DIR, runId);
export const stopBlockPath = (root: string, runId: string, i: number) => join(stopBlocksDir(root, runId), String(i));
/** The base branch's `.agents/specs/` materialized per tree id (store/base.ts). */
export const baseCacheDir = (root: string) => join(machineDir(root), "base");
/** Finished stories' records unpacked from their archive ref, one folder per record commit (`archive/<story>/<commit>/`, record-ref.ts). */
export const archiveCacheDir = (root: string, story: string) => join(machineDir(root), "archive", story);

export const specsDir = (root: string) => join(root, SPECS_DIR);
export const storyDir = (root: string, story: string, slug: string) => join(specsDir(root), storyDirName(story, slug));
/**
 * The story's spec file — `spec.md`, or `story.md` in a folder an older norn intook and that has
 * no `spec.md` yet. Both readers and writers go through here, so such a folder keeps its name.
 */
export function storyFile(specDir: string): string {
  const spec = join(specDir, SPEC_FILE);
  const legacy = join(specDir, LEGACY_SPEC_FILE);
  return !existsSync(spec) && existsSync(legacy) ? legacy : spec;
}
export const slicesDir = (specDir: string) => join(specDir, "slices");
export const sliceFile = (specDir: string, nn: string, slug: string) => join(slicesDir(specDir), `${sliceDirName(nn, slug)}.md`);

export const statePath = (ud: string) => join(ud, "state.json");
export const pinnedWorkflowPath = (ud: string) => join(ud, "workflow.yaml");
export const receiptsDir = (ud: string) => join(ud, "receipts");
export const logPath = (ud: string, runId: string) => join(ud, "logs", `${runId}.log`);
export const evidenceDir = (ud: string, runId: string) => join(ud, "evidence", runId);
/**
 * The resolver for a unit's handoff, keyed by the unit (`_story` or
 * `<nn>-<slug>`), not by its record folder: `<spec folder>/handoffs/story.md` or
 * `handoffs/<nn>-<slug>.md`. Every reader and writer of a handoff goes through here.
 */
export const handoffPath = (specDir: string, unit: string) => join(specDir, unitHandoffPath(unit));
/**
 * The story handoff an older norn wrote beside `file` (`handoffs/_story.md`), when `file` is the
 * story's; null for a slice's, which never moved.
 */
export function legacyHandoffFile(file: string): string | null {
  const story = unitHandoffPath(STORY_UNIT_DIR);
  return file.endsWith(`/${story}`) ? join(file.slice(0, -story.length), LEGACY_STORY_HANDOFF_PATH) : null;
}

/** Worktree marker files, machine-local: never committed. */
export const UNIT_MARKER_FILE = ".norn-unit";
export const ENV_NORN_FILE = ".env.norn";
export const WORKTREE_LOCAL_FILES = [ENV_NORN_FILE, UNIT_MARKER_FILE] as const;
export const unitMarkerPath = (worktree: string) => join(worktree, UNIT_MARKER_FILE);
export const envNornPath = (worktree: string) => join(worktree, ENV_NORN_FILE);

/** `~/.norn`, overridable with NORN_HOME_DIR (tests) or an explicit argument. */
export function nornHome(override?: string, env: Record<string, string | undefined> = process.env): string {
  return override ?? env.NORN_HOME_DIR ?? join(homedir(), ".norn");
}
export const userConfigPath = (home: string) => join(home, "config.yaml");
export const leasesDir = (home: string) => join(home, "leases");
/** Check orders a tick hands a detached `norn check-run`: `<run_id>.json`, removed by that process. */
export const checkOrdersDir = (home: string) => join(home, "checks");
export const checkOrderPath = (home: string, runId: string) => join(checkOrdersDir(home), `${runId}.json`);
