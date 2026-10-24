/**
 * loadTraceView (O4, X1): the step timeline of one unit — for a story, its slices too —
 * read from local files only (spec folders in the checkout and story worktrees, slice
 * worktrees, and the whole trace of that story). No writes, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { storyWorktreePath } from "@norn/core";
import { storyOf } from "@norn/schema";
import { defaultBaseRef, loadSnapshot, readTrace, type StorySnapshot, traceDir, type UnitSnapshot, withSliceWorktrees } from "@norn/store";
import { discoverStoryRoots, markedSliceWorktree } from "./load.ts";
import { buildStepTimeline, mergeStoryTimeline } from "./steps.ts";
import type { TraceRecords, TraceView } from "./types.ts";

function sameFile(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * Where the unit's records are read from (F36). A story with no worktree is read from the cached
 * copy of `origin/<base>` (store/base.ts, `trace/base/<tree>/`, replaced when the base tree
 * moves). When the main checkout holds the very same records (it was pulled), its live path is
 * shown instead; otherwise the cache path is shown and flagged, with the ref to `git show`.
 */
function recordsOf(repoRoot: string, story: StorySnapshot, remote: string): { records: TraceRecords; runsDir: (u: UnitSnapshot) => string } {
  if (!story.from_base) return { records: { source: story.root === repoRoot ? "checkout" : "worktree", root: story.root }, runsDir: (u) => u.path };
  const live = (u: UnitSnapshot) => join(repoRoot, relative(story.root, u.path));
  const pulled = story.units.every((u) => !existsSync(join(u.path, "state.json")) || sameFile(join(u.path, "state.json"), join(live(u), "state.json")));
  if (pulled) return { records: { source: "checkout", root: repoRoot, same_as_base: true }, runsDir: live };
  const ref = defaultBaseRef(repoRoot, remote) ?? undefined;
  return { records: { source: "base_cache", root: story.root, ...(ref ? { ref } : {}) }, runsDir: (u) => u.path };
}

export interface LoadTraceViewOptions {
  repoRoot: string;
  /** story key or slice key */
  key: string;
  home?: string;
  env?: Record<string, string | undefined>;
  /** ms epoch; default Date.now() */
  now?: number;
  /** default: every `<repoRoot>-worktrees/<story>` folder */
  storyRoots?: string[];
  /** attach events to rows (no-op / claim-renew ticks hidden) */
  events?: boolean;
  /** attach every event, no-op ticks included */
  all?: boolean;
  /** a story without its slices */
  storyOnly?: boolean;
}

/** null when the unit is unknown. */
export function loadTraceView(opts: LoadTraceViewOptions): TraceView | null {
  const now = opts.now ?? Date.now();
  const storyKey = storyOf(opts.key);
  const snap = loadSnapshot({
    repoRoot: opts.repoRoot,
    storyRoots: opts.storyRoots ?? discoverStoryRoots(opts.repoRoot),
    home: opts.home,
    env: opts.env,
    includeApplied: true,
  });
  const read = snap.stories.find((s) => s.key === storyKey);
  if (!read) return null;
  const storyWt = storyWorktreePath(opts.repoRoot, read.key, read.slug);
  const story = withSliceWorktrees(read, (slice) => markedSliceWorktree(storyWt, read, slice), { includeApplied: true });
  const { events } = readTrace(opts.repoRoot, { unit: storyKey });
  const tdir = traceDir(opts.repoRoot);
  const { records, runsDir } = recordsOf(opts.repoRoot, story, snap.config.ok ? snap.config.config.remote.git_remote : "origin");

  const build = (u: UnitSnapshot): TraceView => {
    const file = u.unit.slice ? story.slices.find((s) => s.key === u.unit.slice) : null;
    return buildStepTimeline(
      {
        key: u.unit.key,
        story: story.key,
        slice: u.unit.slice,
        title: (u.unit.slice ? file?.frontmatter?.title : story.frontmatter?.title) ?? u.unit.key,
        runs_dir: runsDir(u),
        trace_dir: tdir,
        state: u.state,
        workflow: u.workflow?.workflow ?? null,
        receipts: u.receipts ?? u.unapplied,
        events,
        intake_at: u.unit.slice ? null : (story.frontmatter?.intake_at ?? null),
      },
      { now, events: opts.events, all: opts.all },
    );
  };

  const unit = story.units.find((u) => u.unit.key === opts.key);
  if (!unit) return null;
  const view = build(unit);
  if (unit.unit.slice || opts.storyOnly) return { ...view, records };
  return {
    ...mergeStoryTimeline(
      view,
      story.units.filter((u) => u.unit.slice).map(build),
    ),
    records,
  };
}
