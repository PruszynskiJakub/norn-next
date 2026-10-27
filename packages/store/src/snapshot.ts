/**
 * Raw on-disk snapshot of one repository for observe (H2): config, repo workflows, and
 * per story its frontmatter, slice files, and per unit state.json, pinned workflow,
 * unapplied receipts and handoff. Data only — Facts composition happens in the CLI.
 *
 * Specs live in story worktrees (§7); pass them as `storyRoots`. Roots are scanned in
 * order — storyRoots, then the fetched base branch (`<remote>/<base>`, base.ts: the durable record
 * once a worktree is gone, F36), then repoRoot (solo repos and unpushed stories) — and the first
 * root holding a story wins. The main checkout's local `main` is never preferred over the fetched base.
 * R3.4 (N1): a story worktree supplies only the story its `.norn-unit` marker names; a copy of
 * another story's record in it (cut from a later base) is never read. Roots without a story marker
 * supply nothing.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FileError, NumberedReceipt, SliceFileFacts, UnitRef } from "@norn/core";
import { STORY_UNIT_DIR, type StoryFrontmatter, type UnitState, parseSliceFileName, parseSpecDirName, sliceKey } from "@norn/schema";
import { baseSpecsRoot, defaultBaseRef } from "./base.ts";
import { type LoadedConfig, loadConfig, loadWorkflows, type WorkflowListing } from "./config.ts";
import { readSliceFile, readStoryFile } from "./frontmatter.ts";
import { isErrno } from "./fsx.ts";
import { slicesDir, specsDir, storyFile, unitDir } from "./paths.ts";
import { listReceipts } from "./receipts.ts";
import { type Handoff, type PinnedWorkflow, readHandoff, readPinnedWorkflow, readState } from "./unit.ts";
import { readUnitMarker } from "./worktree.ts";

export interface UnitSnapshot {
  unit: UnitRef;
  /** absolute runs/<unit>/ */
  path: string;
  /** null = not started (no state.json) or corrupt (see errors) */
  state: UnitState | null;
  workflow: PinnedWorkflow | null;
  /** receipts numbered above state.applied_through (all when no state), ascending */
  unapplied: NumberedReceipt[];
  /** every valid receipt, when `includeApplied` */
  receipts?: NumberedReceipt[];
  handoff: Handoff | null;
  /** files of this unit failing validation → unit is corrupt (S2) */
  errors: FileError[];
}

export interface StorySnapshot {
  key: string;
  slug: string;
  /** checkout or worktree the spec was read from */
  root: string;
  /** absolute spec folder */
  path: string;
  /** root-relative spec folder `.agents/specs/<id>-<slug>` */
  spec_dir: string;
  frontmatter: StoryFrontmatter | null;
  frontmatter_error: FileError | null;
  slices: SliceFileFacts[];
  /** story unit first, then slice units ascending by dir name */
  units: UnitSnapshot[];
  /** read from the fetched base branch copy (no worktree, not in the main checkout): `root` is read-only */
  from_base?: boolean;
  /**
   * R3.2: `status` of the story's record on the fetched base branch, whatever root it was read from;
   * null = not on the base; absent = no base ref.
   */
  base_status?: StoryFrontmatter["status"] | null;
}

export interface RepoSnapshot {
  root: string;
  home: string;
  config: LoadedConfig;
  workflows: WorkflowListing;
  stories: StorySnapshot[];
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((n) => !n.startsWith(".") && statSync(join(path, n)).isDirectory())
      .sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
}
function files(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
}

export function loadUnit(root: string, specPath: string, unit: UnitRef, opts: { includeApplied?: boolean } = {}): UnitSnapshot {
  const path = unitDir(specPath, unit.dir);
  const errors: FileError[] = [];
  const st = readState(path, root);
  if (!st.ok && st.reason === "corrupt") errors.push(st.error);
  const wf = readPinnedWorkflow(path, root);
  if (!wf.ok && wf.reason === "corrupt") errors.push(wf.error);
  const state = st.ok ? st.value : null;
  const all = listReceipts(path, { root });
  errors.push(...all.errors);
  const after = state?.applied_through ?? 0;
  // S7: `norn workflow --to` re-pins workflow.yaml right after journaling a workflow receipt;
  // until the tick applies it, the new pin matching that receipt's to_hash is expected.
  const switching = (hash: string) => all.receipts.some((r) => r.n > after && r.receipt.kind === "workflow" && r.receipt.to_hash === hash);
  if (state && wf.ok && state.workflow_hash !== wf.value.hash && !switching(wf.value.hash))
    errors.push({ file: relative(root, join(path, "workflow.yaml")), errors: [{ path: "", message: "hash differs from state.workflow_hash" }] });
  if (st.ok && !wf.ok && wf.reason === "missing")
    errors.push({ file: relative(root, join(path, "workflow.yaml")), errors: [{ path: "", message: "pinned workflow missing" }] });
  return {
    unit,
    path,
    state,
    workflow: wf.ok ? wf.value : null,
    unapplied: all.receipts.filter((r) => r.n > after),
    ...(opts.includeApplied ? { receipts: all.receipts } : {}),
    handoff: readHandoff(path),
    errors,
  };
}

/** Read one spec folder (story.md, slices/, runs/). */
export function loadStory(root: string, specPath: string, opts: { includeApplied?: boolean } = {}): StorySnapshot | null {
  const name = specPath.split("/").at(-1) ?? "";
  const m = parseSpecDirName(name);
  if (!m) return null;
  const { story: key, slug } = m;
  const story = readStoryFile(storyFile(specPath), root);
  let frontmatter_error: FileError | null = null;
  if (!story.ok)
    frontmatter_error =
      story.reason === "corrupt" ? story.error : { file: relative(root, storyFile(specPath)), errors: [{ path: "", message: "story.md missing" }] };
  else if (story.value.frontmatter.id !== key)
    frontmatter_error = { file: relative(root, storyFile(specPath)), errors: [{ path: "/id", message: `must equal folder key '${key}'` }] };

  const slices: SliceFileFacts[] = [];
  for (const f of files(slicesDir(specPath))) {
    const sm = parseSliceFileName(f);
    if (!sm) continue;
    const nn = sm.nn;
    const file = join(slicesDir(specPath), f);
    const sk = sliceKey(key, nn);
    const r = readSliceFile(file, root);
    let error: FileError | null = r.ok ? null : r.reason === "corrupt" ? r.error : null;
    if (r.ok && r.value.frontmatter.id !== sk)
      error = { file: relative(root, file), errors: [{ path: "/id", message: `must equal '${sk}' (from file name)` }] };
    slices.push({ key: sk, file: relative(root, file), nn, slug: sm.slug, frontmatter: r.ok && !error ? r.value.frontmatter : null, error });
  }

  const units: UnitSnapshot[] = [loadUnit(root, specPath, { story: key, slice: null, dir: STORY_UNIT_DIR, key }, opts)];
  const runDirs = new Set(dirs(join(specPath, "runs")).filter((d) => d !== STORY_UNIT_DIR));
  for (const s of slices) runDirs.add(`${s.nn}-${s.slug}`);
  for (const d of [...runDirs].sort()) {
    const nn = /^([0-9]{2,3})-/.exec(d)?.[1];
    if (!nn) continue;
    const sk = sliceKey(key, nn);
    units.push(loadUnit(root, specPath, { story: key, slice: sk, dir: d, key: sk }, opts));
  }
  return {
    key,
    slug,
    root,
    path: specPath,
    spec_dir: relative(root, specPath),
    frontmatter: story.ok && !frontmatter_error ? story.value.frontmatter : null,
    frontmatter_error,
    slices,
    units,
  };
}

/** Every story under `<root>/.agents/specs/` (only `only`'s spec folder when given). */
export function loadStories(root: string, opts: { includeApplied?: boolean; only?: string } = {}): StorySnapshot[] {
  const out: StorySnapshot[] = [];
  for (const d of dirs(specsDir(root))) {
    if (opts.only !== undefined && parseSpecDirName(d)?.story !== opts.only) continue;
    const s = loadStory(root, join(specsDir(root), d), opts);
    if (s) out.push(s);
  }
  return out;
}

export function loadSnapshot(opts: {
  repoRoot: string;
  /** story worktrees, scanned before repoRoot */
  storyRoots?: string[];
  home?: string;
  env?: Record<string, string | undefined>;
  includeApplied?: boolean;
  /**
   * Remote-tracking ref of the base branch to read records from (`refs/remotes/origin/main`);
   * null = none (solo); undefined = detect from the configured git remote (base.ts).
   */
  baseRef?: string | null;
}): RepoSnapshot {
  const config = loadConfig({ repoRoot: opts.repoRoot, home: opts.home, env: opts.env });
  const workflows = loadWorkflows(opts.repoRoot);
  const baseRef = opts.baseRef !== undefined ? opts.baseRef : defaultBaseRef(opts.repoRoot, config.ok ? config.config.remote.git_remote : "origin", config.ok ? config.config.base_branch : null);
  const baseRoot = baseRef ? baseSpecsRoot(opts.repoRoot, baseRef) : null;
  const seen = new Map<string, StorySnapshot>();
  // R3.4: a story worktree is read only for the story its marker names
  for (const root of opts.storyRoots ?? []) {
    const m = readUnitMarker(root).marker;
    if (!m || m.slice !== null) continue;
    for (const s of loadStories(root, { includeApplied: opts.includeApplied, only: m.story })) if (!seen.has(s.key)) seen.set(s.key, s);
  }
  const base = new Map<string, StorySnapshot>();
  if (baseRoot) for (const s of loadStories(baseRoot, { includeApplied: opts.includeApplied })) base.set(s.key, s);
  for (const [key, s] of base) if (!seen.has(key)) seen.set(key, { ...s, from_base: true });
  for (const s of loadStories(opts.repoRoot, { includeApplied: opts.includeApplied })) if (!seen.has(s.key)) seen.set(s.key, s);
  const stories = [...seen.values()]
    .map((s) => (baseRoot ? { ...s, base_status: base.get(s.key)?.frontmatter?.status ?? null } : s))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { root: opts.repoRoot, home: config.home, config, workflows, stories };
}

/**
 * A slice runs in its own worktree (§7, GR3), so its live `runs/<unit>/` is there, not in the
 * story root the snapshot read. Each slice unit for which `sliceWorktree` names a worktree is
 * re-read from that worktree's copy of the spec folder; other units are kept as read.
 */
export function withSliceWorktrees(
  story: StorySnapshot,
  sliceWorktree: (slice: string) => string | null | undefined,
  opts: { includeApplied?: boolean } = {},
): StorySnapshot {
  const units = story.units.map((u) => {
    const wt = u.unit.slice ? sliceWorktree(u.unit.slice) : null;
    return wt ? loadUnit(wt, join(wt, story.spec_dir), u.unit, opts) : u;
  });
  return { ...story, units };
}
