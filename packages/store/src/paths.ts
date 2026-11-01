/**
 * Repository layout (§7). Every function returns an absolute path from a root
 * (the main checkout or a story worktree — both hold the same relative layout).
 * The checkout's machine-local files live outside it, in the machine dir (B5, D1).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { LEGACY_SPEC_FILE, parseRoundDirName, parseSliceKey, recordHandoffPath, ROUNDS_DIR, RUNS_DIR, roundDirName, roundRecordPath, SPEC_FILE, SPECS_DIR, STORY_UNIT_DIR, sliceDirName, storyDirName, unitRecordPath } from "@norn/schema";

/** gh-110 B1, B2 (D1): the committed repo config and workflows, relative to a root, as messages name them. */
export const REPO_CONFIG_FILE = ".agents/norn.config.yaml";
export const WORKFLOWS_DIR = ".agents/workflows";

/** gh-110 D4: the old layout's places, relative to the main checkout; only refused and moved from, never read. */
export const OLD_NORN_DIR = ".agents/norn";
export const OLD_CONFIG_FILE = ".agents/norn/config.yaml";
export const OLD_WORKFLOWS_DIR = ".agents/norn/workflows";
export const OLD_TRACE_DIR = ".agents/norn/trace";

export const repoConfigPath = (root: string) => join(root, REPO_CONFIG_FILE);
export const workflowsDir = (root: string) => join(root, WORKFLOWS_DIR);
/** Whether norn is set up in this checkout (CP13: the cockpit falls back to the last repo otherwise). */
export const isNornRepo = (root: string) => existsSync(repoConfigPath(root)) || existsSync(workflowsDir(root));

/** The checkout a root belongs to: its git common dir (real path) and the main checkout's path. */
export interface CheckoutOf {
  /** real path of the git common dir; a root outside git stands for itself */
  common: string;
  /** the main checkout (the common dir's parent), or the root outside git */
  checkout: string;
  /** D2: `<folder>-<first 8 hex of sha256(common)>` */
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
 * D2: which checkout `root` belongs to, from the files git keeps (no git process): walk up to a `.git`,
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
export const machineHomeOf = (root: string) => homes.get(checkoutOf(root).common) ?? nornHome();

/** B5, D1: the checkout's machine-local files (trace, locks, heartbeat, caches), `<norn home>/repos/<id>/`. */
export const machineDir = (root: string) => join(machineReposDir(machineHomeOf(root)), checkoutOf(root).id);
export const machineReposDir = (home: string) => join(home, "repos");
/** D3: names the checkout a machine dir belongs to, so doctor can tell an orphan after a repo folder moved. */
export const checkoutFilePath = (dir: string) => join(dir, "checkout.json");
/** D9: the headless runner's default session log dir: machine-local, in the machine dir. */
export const runnerLogDir = (root: string) => join(machineDir(root), "runs");
/** Local tick lock (H1); in the machine dir. */
export const tickLockPath = (root: string) => join(machineDir(root), "tick.lock");
/** D6: where an older norn took the tick lock; `norn migrate` takes it there. */
export const oldTickLockPath = (root: string) => join(root, OLD_TRACE_DIR, "tick.lock");
/** K6/BS3: a story's integrate lock — slice integrations and base updates of one story never interleave. */
export const integrateLockPath = (root: string, story: string) => join(machineDir(root), `integrate-${story}.lock`);

/** Machine-local runtime files of one checkout, in the machine dir (B5). */
export const heartbeatFilePath = (root: string) => join(machineDir(root), "heartbeat.json");
export const actFailuresPath = (root: string) => join(machineDir(root), "failures.json");
export const remoteCachePath = (root: string) => join(machineDir(root), "remote.json");
export const notifiedPath = (root: string) => join(machineDir(root), "notified.json");
export const pendingRecordsPath = (root: string) => join(machineDir(root), "records.json");
export const foreignCommitsPath = (root: string) => join(machineDir(root), "foreign.json");
export const inboxOpenPath = (root: string) => join(machineDir(root), "inbox.json");
export const baseFactsPath = (root: string) => join(machineDir(root), "base.json");
export const noticesPath = (root: string) => join(machineDir(root), "notices.json");
export const prFactsPath = (root: string) => join(machineDir(root), "pr.json");
/**
 * B5 (D3): a unit's hook file — `hooks/<story>/_story.jsonl` for the story unit,
 * `hooks/<story>/<nn>.jsonl` for a slice.
 */
export function hookFilePath(root: string, unit: { story: string; slice?: string | null }): string {
  const nn = unit.slice ? parseSliceKey(unit.slice)?.nn : null;
  if (unit.slice && !nn) throw new Error(`not a slice key: ${unit.slice}`);
  return join(machineDir(root), "hooks", unit.story, `${nn ?? STORY_UNIT_DIR}.jsonl`);
}
/** D5: the one-time backfill of the hook files from the day files (`hooks/backfill.json`). */
export const hookBackfillPath = (root: string) => join(machineDir(root), "hooks", "backfill.json");
/** GR6: the base branch's `.agents/specs/` materialized per tree id (store/base.ts). */
export const baseCacheDir = (root: string) => join(machineDir(root), "base");

export const specsDir = (root: string) => join(root, SPECS_DIR);
export const storyDir = (root: string, story: string, slug: string) => join(specsDir(root), storyDirName(story, slug));
/**
 * GR2: the story's spec file — `spec.md`, or `story.md` in a folder an older norn intook and that has
 * no `spec.md` yet. Both readers and writers go through here, so such a folder keeps its name.
 */
export function storyFile(specDir: string): string {
  const spec = join(specDir, SPEC_FILE);
  const legacy = join(specDir, LEGACY_SPEC_FILE);
  return !existsSync(spec) && existsSync(legacy) ? legacy : spec;
}
export const slicesDir = (specDir: string) => join(specDir, "slices");
export const sliceFile = (specDir: string, nn: string, slug: string) => join(slicesDir(specDir), `${sliceDirName(nn, slug)}.md`);

/** A spec folder's `runs/`, the parent of every unit's record folder. */
export const specRunsDir = (specDir: string) => join(specDir, RUNS_DIR);
/**
 * The resolver for a unit's record folder (gh-71 D2, B30, B36): `<spec folder>/runs/<unit>` where unit is
 * `_story` or the slice dir name `<nn>-<slug>` (`unitRecordPath`). Absolute under an absolute spec folder,
 * repo-relative (as git names it) under a repo-relative one. Every reader and writer goes through here.
 */
export function unitDir(specDir: string, unit: string): string {
  const base = join(specDir, unitRecordPath(unit));
  if (unit !== STORY_UNIT_DIR || !isAbsolute(specDir)) return base;
  const round = currentRound(specDir);
  return round ? join(base, ROUNDS_DIR, roundDirName(round.n, round.workflow)) : base;
}
export const storyUnitDir = (specDir: string) => unitDir(specDir, STORY_UNIT_DIR);
/**
 * gh-71 D2 (B30): the story's current round, the highest-numbered `runs/_story/rounds/NN-<wf>/` under an
 * absolute spec folder; null = none (a flat record, read as round 1 (B36), or a story not started).
 */
export function currentRound(specDir: string): { n: number; workflow: string } | null {
  let best: { n: number; workflow: string } | null = null;
  try {
    for (const d of readdirSync(join(specDir, unitRecordPath(STORY_UNIT_DIR), ROUNDS_DIR), { withFileTypes: true })) {
      const r = d.isDirectory() ? parseRoundDirName(d.name) : null;
      if (r && (!best || r.n > best.n)) best = r;
    }
  } catch {
    /* no rounds/ */
  }
  return best;
}
/** gh-71 B30: round `n`'s record folder under a spec folder (`runs/_story/rounds/NN-<wf>`). */
export const roundDir = (specDir: string, n: number, workflow: string) => join(specDir, roundRecordPath(n, workflow));
/**
 * Where a unit's record is written when it starts: a slice's own folder; for the story, its current
 * round, or round 01 of `workflow` when it has neither a round nor a flat record yet (gh-71 B30).
 */
export function startDir(specDir: string, unit: string, workflow: string): string {
  if (unit !== STORY_UNIT_DIR || currentRound(specDir) || isFlatStoryRecord(specDir)) return unitDir(specDir, unit);
  return roundDir(specDir, 1, workflow);
}
/** gh-71 D7 (B34): a story record kept the old flat way, `runs/_story/state.json` directly in the folder. */
export const isFlatStoryRecord = (specDir: string) => existsSync(join(specDir, unitRecordPath(STORY_UNIT_DIR), "state.json"));
export const statePath = (ud: string) => join(ud, "state.json");
export const pinnedWorkflowPath = (ud: string) => join(ud, "workflow.yaml");
export const receiptsDir = (ud: string) => join(ud, "receipts");
export const logPath = (ud: string, runId: string) => join(ud, "logs", `${runId}.log`);
export const evidenceDir = (ud: string, runId: string) => join(ud, "evidence", runId);
/** gh-71 B31: one handoff per story, `runs/_story/handoff.md`, above its round folders; a slice's in its own folder. */
export const handoffPath = (ud: string) => recordHandoffPath(ud);
/** What a commit of a unit's record stages: its record folder and its handoff (above the round folder for the story, gh-71 B31). */
export const recordPaths = (ud: string) => [...new Set([ud, handoffPath(ud)])];
/** R2.3: copies of runs/ files this checkout wrote but never got into the record. */
export const orphanedDir = (ud: string) => join(ud, "orphaned");

/** Worktree marker files (A3, K4). */
export const unitMarkerPath = (worktree: string) => join(worktree, ".norn-unit");
export const envNornPath = (worktree: string) => join(worktree, ".env.norn");

/** `~/.norn`, overridable with NORN_HOME_DIR (tests) or an explicit argument. */
export function nornHome(override?: string, env: Record<string, string | undefined> = process.env): string {
  return override ?? env.NORN_HOME_DIR ?? join(homedir(), ".norn");
}
export const userConfigPath = (home: string) => join(home, "config.yaml");
export const leasesDir = (home: string) => join(home, "leases");
/** Check orders a tick hands a detached `norn check-run` (C5): `<run_id>.json`, removed by that process. */
export const checkOrdersDir = (home: string) => join(home, "checks");
export const checkOrderPath = (home: string, runId: string) => join(checkOrdersDir(home), `${runId}.json`);
