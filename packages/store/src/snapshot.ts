/**
 * Raw on-disk snapshot of one repository for observe: config, repo workflows, and
 * per story its frontmatter, slice files, and per unit state.json, pinned workflow,
 * unapplied receipts and handoff. Data only — Facts composition happens in the CLI.
 *
 * Specs live in story worktrees; pass them as `storyRoots`. Roots are scanned in
 * order — storyRoots, then the fetched base branch (`<remote>/<base>`, base.ts: the durable record
 * once a worktree is gone), then repoRoot (solo repos and unpushed stories) — and the first
 * root holding a story wins. The main checkout's local `main` is never preferred over the fetched base.
 * A story worktree supplies only the story its `.norn-unit` marker names; a copy of
 * another story's record in it (cut from a later base) is never read. Roots without a story marker
 * supply nothing.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FileError, NumberedReceipt, SliceFileFacts, UnitRef } from "@norn/core";
import { claimRef, isClosedStatus, isStoryKey, parseSliceDirName, parseSliceFileName, parseSpecDirName, type RunStory, sliceDirName, sliceKey, SPEC_FILE, STORY_UNIT_DIR, type StoryFrontmatter, type UnitState } from "@norn/schema";
import { baseSpecsRoot, defaultBaseRef } from "./base.ts";
import { type LoadedConfig, loadConfig, loadWorkflows, type WorkflowListing } from "./config.ts";
import { readSliceFile, readStoryFile } from "./frontmatter.ts";
import { displayPath, isErrno } from "./fsx.ts";
import { handoffPath, pinnedWorkflowPath, slicesDir, specsDir, storyFile } from "./paths.ts";
import { gitSync } from "./git.ts";
import { recordedHeartbeatId } from "./heartbeat.ts";
import { machineRunsDir, runStateDirIn, runStateRoundsIn, runStateSource } from "./run-state.ts";
import { listReceipts } from "./receipts.ts";
import { localRecordRefs } from "./record-ref.ts";
import { parseBlob } from "./refs.ts";
import { type Handoff, type PinnedWorkflow, readHandoff, readPinnedWorkflow, readState } from "./unit.ts";
import { readUnitMarker } from "./worktree.ts";

export interface UnitSnapshot {
  unit: UnitRef;
  /** absolute record folder (`runStateDir`): `<machine dir>/runs/<story>/<unit>/`, the story's current round folder */
  path: string;
  /** the record folder relative to the story's run-state folder, e.g. `_story/rounds/01-story` */
  record: string;
  /** null = not started (no state.json) or corrupt (see errors) */
  state: UnitState | null;
  workflow: PinnedWorkflow | null;
  /** receipts numbered above state.applied_through (all when no state), ascending */
  unapplied: NumberedReceipt[];
  /** every valid receipt, when `includeApplied` */
  receipts?: NumberedReceipt[];
  /** absolute path of the unit's handoff, from its own resolver (`handoffPath`), not from `path` */
  handoffFile: string;
  handoff: Handoff | null;
  /** files of this unit failing validation → unit is corrupt */
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
  /** The checkout whose machine dir holds the story's run state */
  checkout: string;
  /** Where the story's units' run state was read from (`runStateSource`) */
  run_state: RunStateAt;
  frontmatter: StoryFrontmatter | null;
  frontmatter_error: FileError | null;
  slices: SliceFileFacts[];
  /** story unit first, then slice units ascending by dir name */
  units: UnitSnapshot[];
  /** read from the fetched base branch copy (no worktree, not in the main checkout): `root` is read-only */
  from_base?: boolean;
  /**
   * A story this checkout holds whose record is in its machine dir but whose
   * spec is in no tree here — it has no branch. No frontmatter, no spec folder; its units are its run state.
   */
  record_only?: boolean;
  /**
   * `status` of the story's record on the fetched base branch, whatever root it was read from;
   * null = not on the base; absent = no base ref.
   */
  base_status?: StoryFrontmatter["status"] | null;
}

export interface RepoSnapshot {
  root: string;
  home: string;
  config: LoadedConfig;
  workflows: WorkflowListing;
  /** the remote-tracking ref of the base branch records were read from; null = none */
  base_ref: string | null;
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

/** Where a story's run state is read from, as `loadUnit` takes it (`runStateSource`). */
export interface RunStateAt {
  /** the folder holding the story's units' run state */
  base: string;
  /** the root a file error or a receipt names a path from; none = absolute (the machine dir) */
  name?: string;
  /** The archive ref's record commit this finished story's run state was unpacked from; absent = not the archive */
  archive?: string;
}

/**
 * One unit's run state (found through the resolver, in the machine dir of the
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
  // Every receipt is validated on every load, applied or not
  const all = listReceipts(path, name ? { root: name } : {});
  errors.push(...all.errors);
  const after = state?.applied_through ?? 0;
  // `norn story edit --workflow --at` re-pins workflow.yaml right after journaling a workflow receipt;
  // until the tick applies it, the new pin matching that receipt's to_hash is expected.
  const switching = (hash: string) => all.receipts.some((r) => r.n > after && r.receipt.kind === "workflow" && r.receipt.to_hash === hash);
  if (state && wf.ok && state.workflow_hash !== wf.value.hash && !switching(wf.value.hash))
    errors.push({ file: displayPath(pinnedWorkflowPath(path), name), errors: [{ path: "", message: "hash differs from state.workflow_hash" }] });
  if (st.ok && !wf.ok && wf.reason === "missing")
    errors.push({ file: displayPath(pinnedWorkflowPath(path), name), errors: [{ path: "", message: "pinned workflow missing" }] });
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
 * A unit read from `at` — `fromAt` when given, the unit as already read from `at`, with the
 * handoff of the worktree `root`.
 */
function readUnit(root: string, story: RunStory, unit: UnitRef, opts: { includeApplied?: boolean }, at: RunStateAt, fromAt?: UnitSnapshot): UnitSnapshot {
  if (fromAt) {
    const handoffFile = handoffPath(join(root, story.spec_dir), unit.dir);
    return { ...fromAt, handoffFile, handoff: readHandoff(handoffFile) };
  }
  return loadUnit(root, story, unit, { ...opts, at });
}

/**
 * The story's rounds, oldest first, each its own record folder read as a unit snapshot
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
 * Read one spec folder (spec.md, slices/) and its units' run state (in the machine dir of
 * `checkout`, default `root`; `archive`: or, for a finished story this machine holds none of, the
 * record on its archive ref here).
 */
export function loadStory(
  root: string,
  specPath: string,
  opts: { includeApplied?: boolean; checkout?: string; archive?: () => ReadonlyMap<string, string>; units?: boolean } = {},
): StorySnapshot | null {
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
  // Only a finished story's record is read from its archive ref, never written there
  const finished = story.ok && isClosedStatus(story.value.frontmatter.status);
  const at = runStateSource(root, run, { checkout, ...(opts.archive && finished ? { archive: opts.archive } : {}) });
  const base = { key, slug, root, path: specPath, spec_dir: run.spec_dir, checkout, run_state: at, frontmatter: story.ok && !frontmatter_error ? story.value.frontmatter : null, frontmatter_error, slices };
  if (opts.units === false) return { ...base, units: [] };
  const unitOpts = opts.includeApplied ? { includeApplied: true } : {};
  const units: UnitSnapshot[] = [readUnit(root, run, { story: key, slice: null, dir: STORY_UNIT_DIR, key }, unitOpts, at)];
  const runDirs = new Set(dirs(at.base).filter((d) => d !== STORY_UNIT_DIR));
  for (const s of slices) runDirs.add(sliceDirName(s.nn, s.slug));
  for (const d of [...runDirs].sort()) {
    const nn = parseSliceDirName(d, { loose: true })?.nn;
    if (!nn) continue;
    const sk = sliceKey(key, nn);
    units.push(readUnit(root, run, { story: key, slice: sk, dir: d, key: sk }, unitOpts, at));
  }
  return { ...base, units };
}

/**
 * Every story under `<root>/.agents/specs/` (only `only`'s spec folder when given). A story `read`
 * already holds (an earlier root's) is skipped, or with `frontmatterOf` read without its units.
 */
function loadStories(
  root: string,
  opts: { includeApplied?: boolean; only?: string; checkout?: string; archive?: () => ReadonlyMap<string, string>; read?: ReadonlyMap<string, unknown>; frontmatterOf?: boolean } = {},
): StorySnapshot[] {
  const out: StorySnapshot[] = [];
  const { only, read, frontmatterOf, ...load } = opts;
  for (const d of dirs(specsDir(root))) {
    const key = parseSpecDirName(d)?.story;
    if (only !== undefined && key !== only) continue;
    const held = key !== undefined && !!read?.has(key);
    if (held && !frontmatterOf) continue;
    const s = loadStory(root, join(specsDir(root), d), held ? { ...load, units: false } : load);
    if (s) out.push(s);
  }
  return out;
}

export function loadSnapshot(opts: {
  repoRoot: string;
  /**
   * story worktrees, scanned before repoRoot: a path (read for the story its marker names) or a story
   * key and the path the caller already matched it to (observe infers a marker `git clean`
   * took from the worktree's folder and branch, and writes nothing)
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
  /** the config the caller already loaded for this repo, home and env; default loaded here */
  config?: LoadedConfig;
}): RepoSnapshot {
  const config = opts.config ?? loadConfig({ repoRoot: opts.repoRoot, home: opts.home, env: opts.env });
  const workflows = loadWorkflows(opts.repoRoot);
  const baseRef = opts.baseRef !== undefined ? opts.baseRef : defaultBaseRef(opts.repoRoot, config.ok ? config.config.git_remote : "origin", config.ok ? config.config.base_branch : null);
  const baseRoot = baseRef ? baseSpecsRoot(opts.repoRoot, baseRef) : null;
  const seen = new Map<string, StorySnapshot>();
  // A story worktree is read only for the story its marker names
  for (const entry of opts.storyRoots ?? []) {
    const root = typeof entry === "string" ? entry : entry.path;
    const m = typeof entry === "string" ? readUnitMarker(root).marker : { story: entry.story, slice: null };
    if (!m || m.slice !== null) continue;
    for (const s of loadStories(root, { includeApplied: opts.includeApplied, only: m.story, read: seen })) if (!seen.has(s.key)) seen.set(s.key, s);
  }
  const base = new Map<string, StorySnapshot>();
  // The base cache is no checkout: its stories' run state is the repo's machine dir, or a
  // finished story's archive ref (never the base tree's runs/ of an older norn)
  // The archive refs are listed only once a finished story without run state here needs them
  let refs: Map<string, string> | undefined;
  const archive = () => (refs ??= localRecordRefs(opts.repoRoot));
  // a story a worktree supplied is read from the base for its `base_status` only, without its units
  if (baseRoot) for (const s of loadStories(baseRoot, { includeApplied: opts.includeApplied, checkout: opts.repoRoot, archive, read: seen, frontmatterOf: true })) base.set(s.key, s);
  for (const [key, s] of base) if (!seen.has(key)) seen.set(key, { ...s, from_base: true });
  for (const s of loadStories(opts.repoRoot, { includeApplied: opts.includeApplied, archive, read: seen })) if (!seen.has(s.key)) seen.set(s.key, s);
  for (const s of recordOnlyStories(opts.repoRoot, seen, { includeApplied: opts.includeApplied })) seen.set(s.key, s);
  const stories = [...seen.values()]
    .map((s) => (baseRoot ? { ...s, base_status: base.get(s.key)?.frontmatter?.status ?? null } : s))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { root: opts.repoRoot, home: config.home, config, workflows, base_ref: baseRef, stories };
}

/**
 * The stories this checkout holds (its local claim ref names this checkout's
 * heartbeat) with run state in the machine dir and a spec in no tree here: a story without a
 * branch, taken over from its record. Read from the run state alone (`record_only`).
 */
function recordOnlyStories(root: string, seen: ReadonlyMap<string, StorySnapshot>, opts: { includeApplied?: boolean }): StorySnapshot[] {
  const hb = recordedHeartbeatId(root);
  if (!hb) return [];
  const out: StorySnapshot[] = [];
  for (const key of dirs(machineRunsDir(root))) {
    if (seen.has(key) || !isStoryKey(key)) continue;
    const claim = gitSync(root, ["cat-file", "blob", claimRef(key)]);
    if (claim.code !== 0) continue;
    const blob = parseBlob("claim", claimRef(key), claim.stdout.toString("utf8"));
    // a corrupt claim is skipped here: observe reads the claim and reports it corrupt
    if (!blob.ok || blob.value.heartbeat_id !== hb) continue;
    const run: RunStory = { key, spec_dir: "" };
    const at = runStateSource(root, run, { checkout: root });
    const unitOpts = opts.includeApplied ? { includeApplied: true } : {};
    const units: UnitSnapshot[] = [readUnit(root, run, { story: key, slice: null, dir: STORY_UNIT_DIR, key }, unitOpts, at)];
    if (!units[0]?.state) continue;
    for (const d of dirs(at.base).filter((x) => x !== STORY_UNIT_DIR).sort()) {
      const nn = parseSliceDirName(d, { loose: true })?.nn;
      if (nn) units.push(readUnit(root, run, { story: key, slice: sliceKey(key, nn), dir: d, key: sliceKey(key, nn) }, unitOpts, at));
    }
    out.push({ key, slug: "", root, path: "", spec_dir: "", checkout: root, run_state: at, frontmatter: null, frontmatter_error: null, slices: [], units, record_only: true });
  }
  return out;
}

/**
 * A slice runs in its own worktree, so its handoff is there, not in the story root the
 * snapshot read (its run state is in the machine dir either way). Each slice unit for which
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
    return readUnit(wt, story, u.unit, opts, story.run_state, u);
  });
  return { ...story, units };
}
