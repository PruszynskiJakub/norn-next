/**
 * Repository layout (§7). Every function returns an absolute path from a root
 * (the main checkout or a story worktree — both hold the same relative layout).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LEGACY_SPEC_FILE, SPEC_FILE, SPECS_DIR, STORY_UNIT_DIR, sliceDirName, storyDirName } from "@norn/schema";

const NORN_DIR = ".agents/norn";

export const repoConfigPath = (root: string) => join(root, NORN_DIR, "config.yaml");
export const workflowsDir = (root: string) => join(root, NORN_DIR, "workflows");
export const traceDir = (root: string) => join(root, NORN_DIR, "trace");
/** Local tick lock (H1); lives in the gitignored trace dir. */
export const tickLockPath = (root: string) => join(traceDir(root), "tick.lock");
/** K6/BS3: a story's integrate lock — slice integrations and base updates of one story never interleave. */
export const integrateLockPath = (root: string, story: string) => join(traceDir(root), `integrate-${story}.lock`);

/** Machine-local runtime files of one checkout, in the gitignored trace dir (§7.1). */
export const heartbeatFilePath = (root: string) => join(traceDir(root), "heartbeat.json");
export const actFailuresPath = (root: string) => join(traceDir(root), "failures.json");
export const remoteCachePath = (root: string) => join(traceDir(root), "remote.json");
export const notifiedPath = (root: string) => join(traceDir(root), "notified.json");
export const pendingRecordsPath = (root: string) => join(traceDir(root), "records.json");
export const foreignCommitsPath = (root: string) => join(traceDir(root), "foreign.json");
export const inboxOpenPath = (root: string) => join(traceDir(root), "inbox.json");
export const baseFactsPath = (root: string) => join(traceDir(root), "base.json");
export const prFactsPath = (root: string) => join(traceDir(root), "pr.json");
/** GR6: the base branch's `.agents/specs/` materialized per tree id (store/base.ts). */
export const baseCacheDir = (root: string) => join(traceDir(root), "base");

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

/** `runs/<unit>/` where unit is `_story` or the slice dir name `<nn>-<slug>`. */
export const unitDir = (specDir: string, unit: string) => join(specDir, "runs", unit);
export const storyUnitDir = (specDir: string) => unitDir(specDir, STORY_UNIT_DIR);
export const statePath = (ud: string) => join(ud, "state.json");
export const pinnedWorkflowPath = (ud: string) => join(ud, "workflow.yaml");
export const receiptsDir = (ud: string) => join(ud, "receipts");
export const logPath = (ud: string, runId: string) => join(ud, "logs", `${runId}.log`);
export const evidenceDir = (ud: string, runId: string) => join(ud, "evidence", runId);
export const handoffPath = (ud: string) => join(ud, "handoff.md");
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
