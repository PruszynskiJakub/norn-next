/**
 * The run-state resolver. Every reader and writer of a unit's run state
 * (state.json, receipts, pinned workflow, logs, evidence) asks here for `(root, story, unit)`: `root` is
 * a checkout or worktree of the repository, `story` its key and spec folder, `unit` `_story` or
 * `<nn>-<slug>`. The folder is `<machine dir>/runs/<story>/<unit>` (the story's
 * current round under `_story/rounds/`), the same for every worktree of one checkout and never in a
 * worktree or on a branch. Nothing outside this module and schema's `ids.ts` joins a story or a spec
 * folder with `runs/` (test/repo/repo.test.ts).
 *
 * The run-state-folder primitives below (`unitDir`, `startDir`, …) take the folder holding a story's
 * units (`storyRunStateDir`); tests use them to name a fixture's files, package sources use the
 * `(root, story, unit)` functions.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  parseRoundDirName,
  ROUNDS_DIR,
  RUNS_DIR,
  type RunStory,
  roundDirName,
  roundRecordPath,
  STORY_UNIT_DIR,
  storyRunStatePath,
  unitRecordPath,
} from "@norn/schema";
import { machineDir, statePath } from "./paths.ts";
import { archivedRecordDir } from "./record-ref.ts";

/** The machine dir's `runs/`, holding every story's run state of the checkout `root` belongs to. */
export const machineRunsDir = (root: string): string => join(machineDir(root), RUNS_DIR);
/** A path decide names relative to the machine dir (`runs/<story>/…`, schema's `runStatePath`) under `root`'s checkout. */
export const runStateFile = (root: string, rel: string): string => join(machineDir(root), rel);

/** The folder holding every unit's run-state folder of a story, `<machine dir>/runs/<story>`. */
export const storyRunStateDir = (root: string, story: RunStory): string => runStateFile(root, storyRunStatePath(story));
/** A unit's run-state folder: a slice's own, the story's current round (or its flat record, or round-less before it starts). */
export const runStateDir = (root: string, story: RunStory, unit: string): string => unitDir(storyRunStateDir(root, story), unit);
/** Where a unit's run state is written when it starts (`startDir`): for the story, round 01 of `workflow` when it has none yet. */
export const runStateStartDir = (root: string, story: RunStory, unit: string, workflow: string): string => startDir(storyRunStateDir(root, story), unit, workflow);
/**
 * A run-state folder's record, its path inside the story's run state
 * (`<nn>-<slug>`, `_story/rounds/01-story`): what facts and messages name it by.
 */
export const runStateRecord = (root: string, story: RunStory, dir: string): string => relative(storyRunStateDir(root, story), dir);

/**
 * The resolver for a unit's record folder under a story's run-state folder `base`: a slice's
 * `<base>/<nn>-<slug>`; the story's current round `<base>/_story/rounds/NN-<wf>` when it has one,
 * else `<base>/_story` (a flat record from an older norn, read as round 1, or a story not started).
 * Every reader and writer goes through here.
 */
export function unitDir(base: string, unit: string): string {
  const dir = join(base, unitRecordPath(unit));
  // While `_story/state.json` is still flat the record is flat, even when a
  // round.migrate that stopped partway left some entries in rounds/01-<wf>/: state moves last, so the
  // next round.migrate finishes the move.
  if (unit !== STORY_UNIT_DIR || isFlatStoryRecord(base)) return dir;
  const round = currentRound(base);
  return round ? join(dir, ROUNDS_DIR, roundDirName(round.n, round.workflow)) : dir;
}
export const storyUnitDir = (base: string) => unitDir(base, STORY_UNIT_DIR);
/**
 * The story's current round, the highest-numbered `_story/rounds/NN-<wf>/` under a
 * story's run-state folder that has its state; null = none (a flat record, read as round 1, or a
 * story not started). A round folder is the record only once its state.json is written, so a
 * round.start that stopped after pinning the new round leaves the old round current and the round
 * receipt unapplied.
 */
export function currentRound(base: string): { n: number; workflow: string } | null {
  const r = storyRounds(base).at(-1);
  return r ? { n: r.n, workflow: r.workflow } : null;
}
/**
 * Every round folder `_story/rounds/NN-<wf>/` under a story's run-state folder that has
 * its state, ascending by number, with its absolute path; [] for a flat record (read as round 1) or
 * a story not started.
 */
export function storyRounds(base: string): Array<{ n: number; workflow: string; path: string }> {
  const out: Array<{ n: number; workflow: string; path: string }> = [];
  const rounds = join(base, unitRecordPath(STORY_UNIT_DIR), ROUNDS_DIR);
  try {
    for (const d of readdirSync(rounds, { withFileTypes: true })) {
      const r = d.isDirectory() && existsSync(statePath(join(rounds, d.name))) ? parseRoundDirName(d.name) : null;
      if (r) out.push({ ...r, path: join(rounds, d.name) });
    }
  } catch {
    /* no rounds/ */
  }
  return out.sort((a, b) => a.n - b.n);
}
/** Round `n`'s record folder under a story's run-state folder (`_story/rounds/NN-<wf>`). */
export const roundDir = (base: string, n: number, workflow: string) => join(base, roundRecordPath(n, workflow));
/**
 * Where a unit's record is written when it starts: a slice's own folder; for the story, its current
 * round, or round 01 of `workflow` when it has neither a round nor a flat record yet.
 */
export function startDir(base: string, unit: string, workflow: string): string {
  if (unit !== STORY_UNIT_DIR || currentRound(base) || isFlatStoryRecord(base)) return unitDir(base, unit);
  return roundDir(base, 1, workflow);
}
/** A story record kept the old flat way, `_story/state.json` directly in the folder. */
export const isFlatStoryRecord = (base: string) => existsSync(statePath(join(base, unitRecordPath(STORY_UNIT_DIR))));

/**
 * Where a story's run state is read from — the machine dir of `checkout`,
 * or, for a finished story this machine holds no run state of, the record on its archive ref
 * here (`archive`: the checkout's archive refs, `localRecordRefs`, read only when needed), unpacked into the machine dir's cache (`archivedRecordDir`). Never an older norn's
 * `<spec folder>/runs` in any tree, a branch's or the base's. `name` is the root a file error or a
 * receipt names a path from: none (absolute) for both.
 */
export function runStateSource(
  root: string,
  story: RunStory,
  opts: { checkout?: string; archive?: () => ReadonlyMap<string, string> } = {},
): { base: string; name?: string; archive?: string } {
  const checkout = opts.checkout ?? root;
  const machine = storyRunStateDir(checkout, story);
  const sha = opts.archive && !existsSync(machine) ? opts.archive().get(story.key) : undefined;
  if (sha) {
    const dir = archivedRecordDir(checkout, story.key, sha);
    if (dir) return { base: dir, archive: basename(dir) };
  }
  return { base: machine };
}
/** A unit's run-state folder under a source's `base` (`runStateSource`). */
export const runStateDirIn = (base: string, unit: string): string => unitDir(base, unit);
/** Where a unit's run state is written when it starts, under `base` (`startDir`): a record staged empty takes round 01 of `workflow`. */
export const runStateStartDirIn = (base: string, unit: string, workflow: string): string => startDir(base, unit, workflow);
/** The story's rounds under a source's `base`, ascending; [] for a flat record or a story not started. */
export const runStateRoundsIn = (base: string) => (isFlatStoryRecord(base) ? [] : storyRounds(base));
