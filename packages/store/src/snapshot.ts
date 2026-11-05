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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FileError, NumberedReceipt, SliceFileFacts, UnitRef } from "@norn/core";
import { type RunStory, SPEC_FILE, STORY_UNIT_DIR, type StoryFrontmatter, type UnitState, parseSliceFileName, parseSpecDirName, sliceKey, treeStoryRunStatePath } from "@norn/schema";
import { baseSpecsRoot, defaultBaseRef } from "./base.ts";
import { type LoadedConfig, loadConfig, loadWorkflows, type WorkflowListing } from "./config.ts";
import { readSliceFile, readStoryFile } from "./frontmatter.ts";
import { displayPath, isErrno } from "./fsx.ts";
import { handoffPath, slicesDir, specsDir, statePath, storyFile } from "./paths.ts";
import { runStateDirIn, runStateRoundsIn, runStateSource, treeRunStateDir, treeRunStateFiles } from "./run-state.ts";
import { listReceipts } from "./receipts.ts";
import { type Handoff, type PinnedWorkflow, readHandoff, readPinnedWorkflow, readState } from "./unit.ts";
import { readUnitMarker } from "./worktree.ts";

export interface UnitSnapshot {
  unit: UnitRef;
  /** absolute record folder (`runStateDir`): `<machine dir>/runs/<story>/<unit>/`, the story's current round folder (gh-71 B30, S12) */
  path: string;
  /** the record folder relative to the story's run-state folder (gh-71 D2, gh-195 D7), e.g. `_story/rounds/01-story` */
  record: string;
  /** null = not started (no state.json) or corrupt (see errors) */
  state: UnitState | null;
  workflow: PinnedWorkflow | null;
  /** receipts numbered above state.applied_through (all when no state), ascending */
  unapplied: NumberedReceipt[];
  /** every valid receipt, when `includeApplied` */
  receipts?: NumberedReceipt[];
  /** absolute path of the unit's handoff, from its own resolver (`handoffPath`, gh-195 prefactor 2), not from `path` */
  handoffFile: string;
  handoff: Handoff | null;
  /** files of this unit failing validation → unit is corrupt (S2) */
  errors: FileError[];
  /**
   * gh-195/06 (B34): the unit worktree whose tree (an older norn's `<spec folder>/runs/`, on its branch)
   * this unit's run state was read from, the machine dir holding none of it yet. Absent = the machine dir.
   */
  tree_root?: string;
  /** gh-195/06 (B34, D13): run state an older norn left on this unit's own branch, still to move off it; absent = none */
  branch_record?: BranchRecord;
}

/**
 * gh-195/06 (B34, D13): run state an older norn left in `<spec folder>/runs/` of a unit worktree, on its
 * branch. The unit whose worktree it is carries it.
 */
export interface BranchRecord {
  /** `<spec folder>/runs`, relative to the worktree */
  path: string;
  /**
   * the units' folders there (`_story`, `<nn>-<slug>`) that were read as their run state, the machine
   * dir holding none of it yet: the move copies them. [] = the machine dir holds them all (a move that
   * stopped after the copy): only the removal is left.
   */
  copy: string[];
  /** every unit's folder there, copied or not: the removal takes them all */
  holds: string[];
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
  /** gh-195/05 (S12): the checkout whose machine dir holds the story's run state */
  checkout: string;
  /** gh-195/05: where the story's units' run state was read from (`runStateSource`) */
  run_state: RunStateAt;
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
  /**
   * gh-195 D16 (B29, B35): stories whose run state an older norn left in the base's tree (the fetched
   * base branch, the main checkout without one), never read: `norn upgrade` moves it to archive refs.
   * Ascending; [] = none.
   */
  base_run_state: string[];
}

/**
 * gh-195 D16 (B35): the stories whose spec folder in the tree `root` (the base cache, or a checkout)
 * still holds `runs/` from an older norn, by key, ascending. The one place that notices them: once the
 * removal `norn upgrade` stages is committed (gh-195/17), it finds none.
 */
export function baseRunStateStories(root: string): string[] {
  const out: string[] = [];
  for (const d of dirs(specsDir(root))) {
    const m = parseSpecDirName(d);
    if (m && treeRunStateFiles(root, { key: m.story, spec_dir: relative(root, join(specsDir(root), d)) }).length) out.push(m.story);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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

/** Where a story's run state is read from, as `loadUnit` takes it (gh-195/05, `runStateSource`). */
export interface RunStateAt {
  /** the folder holding the story's units' run state */
  base: string;
  /** the root a file error or a receipt names a path from; none = absolute (the machine dir, S12) */
  name?: string;
  /** an older norn's record in a unit worktree's branch tree (gh-195/06), not the machine dir */
  tree: boolean;
  /** gh-195 D7 (B29): the archive ref's record commit this finished story's run state was unpacked from; absent = not the archive */
  archive?: string;
}

/**
 * One unit's run state (gh-195 prefactor 1: found through the resolver; S12: in the machine dir of the
 * checkout `root` belongs to), with its handoff from the worktree `root`.
 */
export function loadUnit(root: string, story: RunStory, unit: UnitRef, opts: { includeApplied?: boolean; path?: string; at?: RunStateAt } = {}): UnitSnapshot {
  const at = opts.at ?? runStateSource(root, story);
  const path = opts.path ?? runStateDirIn(at.base, unit.dir);
  const name = at.name;
  const handoffFile = handoffPath(join(root, story.spec_dir), unit.dir);
  const errors: FileError[] = [];
  const st = readState(path, name);
  if (!st.ok && st.reason === "corrupt") errors.push(st.error);
  const wf = readPinnedWorkflow(path, name);
  if (!wf.ok && wf.reason === "corrupt") errors.push(wf.error);
  const state = st.ok ? st.value : null;
  const all = listReceipts(path, name ? { root: name } : {});
  errors.push(...all.errors);
  const after = state?.applied_through ?? 0;
  // S7: `norn story edit --workflow --at` re-pins workflow.yaml right after journaling a workflow receipt;
  // until the tick applies it, the new pin matching that receipt's to_hash is expected.
  const switching = (hash: string) => all.receipts.some((r) => r.n > after && r.receipt.kind === "workflow" && r.receipt.to_hash === hash);
  if (state && wf.ok && state.workflow_hash !== wf.value.hash && !switching(wf.value.hash))
    errors.push({ file: displayPath(join(path, "workflow.yaml"), name), errors: [{ path: "", message: "hash differs from state.workflow_hash" }] });
  if (st.ok && !wf.ok && wf.reason === "missing")
    errors.push({ file: displayPath(join(path, "workflow.yaml"), name), errors: [{ path: "", message: "pinned workflow missing" }] });
  return {
    unit,
    path,
    record: relative(at.base, path),
    state,
    workflow: wf.ok ? wf.value : null,
    unapplied: all.receipts.filter((r) => r.n > after),
    ...(opts.includeApplied ? { receipts: all.receipts } : {}),
    handoffFile,
    handoff: readHandoff(handoffFile),
    errors,
  };
}

/**
 * gh-195/06 (B34): a unit of the worktree `root`, read from its branch's tree (`<spec folder>/runs/`, an
 * older norn's) when `branch` and the machine dir holds none of its run state yet, else from `at`.
 */
function readUnit(root: string, story: RunStory, unit: UnitRef, opts: { includeApplied?: boolean }, at: RunStateAt, branch: boolean): UnitSnapshot {
  if (branch && !at.tree) {
    const tree: RunStateAt = { base: treeRunStateDir(root, story), name: root, tree: true };
    const held = (base: string) => existsSync(statePath(runStateDirIn(base, unit.dir)));
    if (!held(at.base) && held(tree.base)) return { ...loadUnit(root, story, unit, { ...opts, at: tree }), tree_root: root };
  }
  return loadUnit(root, story, unit, { ...opts, at });
}

/** gh-195/06 (B34): the run state left on the branch of the worktree `root`, carried by its unit; the move copies the units read from there. */
function withBranchRecord(root: string, story: RunStory, owner: UnitSnapshot, units: readonly UnitSnapshot[]): UnitSnapshot {
  const { branch_record: _, ...rest } = owner;
  if (!treeRunStateFiles(root, story).length) return rest;
  const copy = units.filter((u) => u.tree_root === root).map((u) => u.unit.dir);
  return { ...rest, branch_record: { path: treeStoryRunStatePath(story), copy, holds: dirs(treeRunStateDir(root, story)) } };
}

/**
 * gh-71 B29, B36: the story's rounds, oldest first, each its own record folder read as a unit snapshot
 * (every receipt when `includeApplied`). A flat record from an older norn is its one round, round 1;
 * [] when the story has not started. Read only.
 */
export function loadRounds(story: StorySnapshot, opts: { includeApplied?: boolean } = {}): Array<{ n: number; workflow: string; unit: UnitSnapshot }> {
  const current = story.units[0];
  if (!current?.state) return [];
  const rounds = runStateRoundsIn(story.run_state.base);
  if (!rounds.length) return [{ n: current.state.round ?? 1, workflow: current.state.workflow, unit: current }];
  return rounds.map((r) => ({ n: r.n, workflow: r.workflow, unit: r.path === current.path ? current : loadUnit(story.root, story, current.unit, { ...opts, path: r.path, at: story.run_state }) }));
}

/**
 * Read one spec folder (spec.md, slices/) and its units' run state (S12: in the machine dir of
 * `checkout`, default `root`; `archive`: or, for a finished story this machine holds none of, the
 * record on its archive ref here, gh-195 D7, D16).
 */
export function loadStory(root: string, specPath: string, opts: { includeApplied?: boolean; checkout?: string; archive?: boolean; branch?: boolean } = {}): StorySnapshot | null {
  const name = specPath.split("/").at(-1) ?? "";
  const m = parseSpecDirName(name);
  if (!m) return null;
  const { story: key, slug } = m;
  const story = readStoryFile(storyFile(specPath), root);
  let frontmatter_error: FileError | null = null;
  if (!story.ok)
    frontmatter_error =
      story.reason !== "missing" ? story.error : { file: relative(root, storyFile(specPath)), errors: [{ path: "", message: `${SPEC_FILE} missing` }] };
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
    let error: FileError | null = r.ok || r.reason === "missing" ? null : r.error;
    if (r.ok && r.value.frontmatter.id !== sk)
      error = { file: relative(root, file), errors: [{ path: "/id", message: `must equal '${sk}' (from file name)` }] };
    slices.push({ key: sk, file: relative(root, file), nn, slug: sm.slug, frontmatter: r.ok && !error ? r.value.frontmatter : null, error });
  }

  const run: RunStory = { key, spec_dir: relative(root, specPath) };
  const checkout = opts.checkout ?? root;
  // D7, D16 (B29): only a finished story's record is read from its archive ref, never written there
  const finished = story.ok && (story.value.frontmatter.status === "done" || story.value.frontmatter.status === "dropped");
  const at = runStateSource(root, run, { checkout, ...(opts.archive && finished ? { archive: true } : {}) });
  const unitOpts = opts.includeApplied ? { includeApplied: true } : {};
  // gh-195/06 (B34): a story worktree's branch may still hold an older norn's run state
  const branch = !!opts.branch;
  const units: UnitSnapshot[] = [readUnit(root, run, { story: key, slice: null, dir: STORY_UNIT_DIR, key }, unitOpts, at, branch)];
  const runDirs = new Set([...dirs(at.base), ...(branch ? dirs(treeRunStateDir(root, run)) : [])].filter((d) => d !== STORY_UNIT_DIR));
  for (const s of slices) runDirs.add(`${s.nn}-${s.slug}`);
  for (const d of [...runDirs].sort()) {
    const nn = /^([0-9]{2,3})-/.exec(d)?.[1];
    if (!nn) continue;
    const sk = sliceKey(key, nn);
    units.push(readUnit(root, run, { story: key, slice: sk, dir: d, key: sk }, unitOpts, at, branch));
  }
  if (branch) units[0] = withBranchRecord(root, run, units[0] as UnitSnapshot, units);
  return {
    key,
    slug,
    root,
    path: specPath,
    spec_dir: run.spec_dir,
    checkout,
    run_state: at,
    frontmatter: story.ok && !frontmatter_error ? story.value.frontmatter : null,
    frontmatter_error,
    slices,
    units,
  };
}

/** Every story under `<root>/.agents/specs/` (only `only`'s spec folder when given). */
function loadStories(root: string, opts: { includeApplied?: boolean; only?: string; checkout?: string; archive?: boolean; branch?: boolean } = {}): StorySnapshot[] {
  const out: StorySnapshot[] = [];
  for (const d of dirs(specsDir(root))) {
    if (opts.only !== undefined && parseSpecDirName(d)?.story !== opts.only) continue;
    const { only: _, ...read } = opts;
    const s = loadStory(root, join(specsDir(root), d), read);
    if (s) out.push(s);
  }
  return out;
}

export function loadSnapshot(opts: {
  repoRoot: string;
  /**
   * story worktrees, scanned before repoRoot: a path (read for the story its marker names) or a story
   * key and the path the caller already matched it to (gh-195/05, B2: observe read a marker `git clean`
   * took from the worktree's folder and branch, and writes nothing, H2)
   */
  storyRoots?: Array<string | { story: string; path: string }>;
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
  const baseRef = opts.baseRef !== undefined ? opts.baseRef : defaultBaseRef(opts.repoRoot, config.ok ? config.config.git_remote : "origin", config.ok ? config.config.base_branch : null);
  const baseRoot = baseRef ? baseSpecsRoot(opts.repoRoot, baseRef) : null;
  const seen = new Map<string, StorySnapshot>();
  // R3.4: a story worktree is read only for the story its marker names
  for (const entry of opts.storyRoots ?? []) {
    const root = typeof entry === "string" ? entry : entry.path;
    const m = typeof entry === "string" ? readUnitMarker(root).marker : { story: entry.story, slice: null };
    if (!m || m.slice !== null) continue;
    for (const s of loadStories(root, { includeApplied: opts.includeApplied, only: m.story, branch: true })) if (!seen.has(s.key)) seen.set(s.key, s);
  }
  const base = new Map<string, StorySnapshot>();
  // gh-195/05: the base cache is no checkout: its stories' run state is the repo's machine dir, or a
  // finished story's archive ref (D7, D16: never the base tree's runs/ of an older norn)
  if (baseRoot) for (const s of loadStories(baseRoot, { includeApplied: opts.includeApplied, checkout: opts.repoRoot, archive: true })) base.set(s.key, s);
  for (const [key, s] of base) if (!seen.has(key)) seen.set(key, { ...s, from_base: true });
  for (const s of loadStories(opts.repoRoot, { includeApplied: opts.includeApplied, archive: true })) if (!seen.has(s.key)) seen.set(s.key, s);
  const stories = [...seen.values()]
    .map((s) => (baseRoot ? { ...s, base_status: base.get(s.key)?.frontmatter?.status ?? null } : s))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { root: opts.repoRoot, home: config.home, config, workflows, stories, base_run_state: baseRunStateStories(baseRoot ?? opts.repoRoot) };
}

/**
 * A slice runs in its own worktree (§7, GR3), so its handoff is there, not in the story root the
 * snapshot read (its run state is in the machine dir either way, S12). Each slice unit for which
 * `sliceWorktree` names a worktree is re-read with that worktree's handoff; other units are kept as read.
 */
export function withSliceWorktrees(
  story: StorySnapshot,
  sliceWorktree: (slice: string) => string | null | undefined,
  opts: { includeApplied?: boolean } = {},
): StorySnapshot {
  const units = story.units.map((u) => {
    const wt = u.unit.slice ? sliceWorktree(u.unit.slice) : null;
    if (!wt) return u;
    // gh-195/06 (B34): a slice branch may still hold an older norn's run state of the slice
    const own = readUnit(wt, story, u.unit, opts, story.run_state, true);
    // …else the story branch's copy, read with the story, stays its run state
    const read = !own.tree_root && !own.state && u.tree_root ? { ...u, handoffFile: own.handoffFile, handoff: own.handoff } : own;
    return withBranchRecord(wt, story, read, [read]);
  });
  // the story's move copies only the units still read from its own worktree's branch
  const owner = units[0];
  if (owner?.branch_record) units[0] = withBranchRecord(story.root, story, owner, units);
  return { ...story, units };
}
