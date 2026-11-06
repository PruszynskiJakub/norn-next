/**
 * gh-195 prefactor 1 (B2, B4): the run-state resolver. Every reader and writer of a unit's run state
 * (state.json, receipts, pinned workflow, logs, evidence) asks here for `(root, story, unit)`: `root` is
 * a checkout or worktree of the repository, `story` its key and spec folder, `unit` `_story` or
 * `<nn>-<slug>`. S12 (gh-195/05, D1): the folder is `<machine dir>/runs/<story>/<unit>` (the story's
 * current round under `_story/rounds/`), the same for every worktree of one checkout and never in a
 * worktree or on a branch. Nothing outside this module and schema's `ids.ts` joins a story or a spec
 * folder with `runs/` (test/repo/repo.test.ts).
 *
 * The run-state-folder primitives below (`unitDir`, `startDir`, …) take the folder holding a story's
 * units (`storyRunStateDir`); tests use them to name a fixture's files, package sources use the
 * `(root, story, unit)` functions.
 */
import { type Dirent, existsSync, readdirSync } from "node:fs";
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
  treeRunStatePath,
  treeStoryRunStatePath,
  unitRecordPath,
} from "@norn/schema";
import { isErrno } from "./fsx.ts";
import { machineDir, statePath } from "./paths.ts";
import { archivedRecordDir } from "./record-ref.ts";

/** S12: the machine dir's `runs/`, holding every story's run state of the checkout `root` belongs to. */
export const machineRunsDir = (root: string): string => join(machineDir(root), RUNS_DIR);
/** S12: a path decide names relative to the machine dir (`runs/<story>/…`, schema's `runStatePath`) under `root`'s checkout. */
export const runStateFile = (root: string, rel: string): string => join(machineDir(root), rel);

/** S12: the folder holding every unit's run-state folder of a story, `<machine dir>/runs/<story>`. */
export const storyRunStateDir = (root: string, story: RunStory): string => runStateFile(root, storyRunStatePath(story));
/** A unit's run-state folder: a slice's own, the story's current round (or its flat record, or round-less before it starts). */
export const runStateDir = (root: string, story: RunStory, unit: string): string => unitDir(storyRunStateDir(root, story), unit);
/** Where a unit's run state is written when it starts (`startDir`): for the story, round 01 of `workflow` when it has none yet. */
export const runStateStartDir = (root: string, story: RunStory, unit: string, workflow: string): string => startDir(storyRunStateDir(root, story), unit, workflow);
/**
 * gh-195 prefactor 1 (review F2), D7: a run-state folder's record, its path inside the story's run state
 * (`<nn>-<slug>`, `_story/rounds/01-story`): what facts and messages name it by.
 */
export const runStateRecord = (root: string, story: RunStory, dir: string): string => relative(storyRunStateDir(root, story), dir);
/**
 * gh-195/05: the folder of an older norn's tree that held a story's records, `<spec folder>/runs`:
 * read only from a unit worktree's branch, to move it off (B34, D13); on a base or checkout tree it is
 * never read, only noticed (`baseRunStateStories`, D16).
 */
export const treeRunStateDir = (root: string, story: RunStory): string => join(root, treeStoryRunStatePath(story));
/**
 * gh-195/06 (B34, D13): the run-state files an older norn left in the tree of `root` (a unit worktree:
 * `<spec folder>/runs/`, on its branch), absolute and sorted: every file there, the units' old handoffs
 * included (gh-195/07: they move to `handoffs/` with the rest's removal, D13 step 2). [] = none.
 */
export function treeRunStateFiles(root: string, story: RunStory): string[] {
  const base = treeRunStateDir(root, story);
  const entries = (dir: string): Dirent[] => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // no runs/ there; anything else (EACCES, ENOTDIR) is no answer and surfaces
      if (isErrno(e, "ENOENT")) return [];
      throw e;
    }
  };
  const out: string[] = [];
  const walk = (dir: string, list: Dirent[]) => {
    for (const d of list) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p, entries(p));
      else out.push(p);
    }
  };
  walk(base, entries(base));
  return out.sort();
}
/** gh-195/05: a unit's folder in an older norn's tree (`<spec folder>/runs/<unit>`). */
export const treeUnitRunStateDir = (root: string, story: RunStory, unit: string): string => join(root, treeRunStatePath(story, unit));

/**
 * The resolver for a unit's record folder under a story's run-state folder `base` (gh-71 D2, B30,
 * B36): a slice's `<base>/<nn>-<slug>`; the story's current round `<base>/_story/rounds/NN-<wf>` when it
 * has one, else `<base>/_story` (a flat record from an older norn, read as round 1, or a story not
 * started). Every reader and writer goes through here.
 */
export function unitDir(base: string, unit: string): string {
  const dir = join(base, unitRecordPath(unit));
  // gh-71 D7 (B34, S5): while `_story/state.json` is still flat the record is flat, even when a
  // round.migrate that stopped partway left some entries in rounds/01-<wf>/: state moves last, so the
  // next round.migrate finishes the move.
  if (unit !== STORY_UNIT_DIR || isFlatStoryRecord(base)) return dir;
  const round = currentRound(base);
  return round ? join(dir, ROUNDS_DIR, roundDirName(round.n, round.workflow)) : dir;
}
export const storyUnitDir = (base: string) => unitDir(base, STORY_UNIT_DIR);
/**
 * gh-71 D2 (B30): the story's current round, the highest-numbered `_story/rounds/NN-<wf>/` under a
 * story's run-state folder that has its state; null = none (a flat record, read as round 1 (B36), or a
 * story not started). S5: a round folder is the record only once its state.json is written, so a
 * round.start that stopped after pinning the new round leaves the old round current and the round
 * receipt unapplied.
 */
export function currentRound(base: string): { n: number; workflow: string } | null {
  const r = storyRounds(base).at(-1);
  return r ? { n: r.n, workflow: r.workflow } : null;
}
/**
 * gh-71 B29, B30: every round folder `_story/rounds/NN-<wf>/` under a story's run-state folder that has
 * its state, ascending by number, with its absolute path; [] for a flat record (read as round 1, B36) or
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
/** gh-71 B30: round `n`'s record folder under a story's run-state folder (`_story/rounds/NN-<wf>`). */
export const roundDir = (base: string, n: number, workflow: string) => join(base, roundRecordPath(n, workflow));
/**
 * Where a unit's record is written when it starts: a slice's own folder; for the story, its current
 * round, or round 01 of `workflow` when it has neither a round nor a flat record yet (gh-71 B30).
 */
export function startDir(base: string, unit: string, workflow: string): string {
  if (unit !== STORY_UNIT_DIR || currentRound(base) || isFlatStoryRecord(base)) return unitDir(base, unit);
  return roundDir(base, 1, workflow);
}
/** gh-71 D7 (B34): a story record kept the old flat way, `_story/state.json` directly in the folder. */
export const isFlatStoryRecord = (base: string) => existsSync(statePath(join(base, unitRecordPath(STORY_UNIT_DIR))));

/**
 * gh-195/05, D7, D16 (B29): where a story's run state is read from — the machine dir of `checkout`
 * (S12), or, for a finished story this machine holds no run state of, the record on its archive ref
 * here (`archive`: the checkout's archive refs, `localRecordRefs`, read only when needed), unpacked into the machine dir's cache (`archivedRecordDir`). Never an older norn's
 * `<spec folder>/runs` in a base or checkout tree: a repository still holding those is pointed to
 * `norn upgrade` instead (`baseRunStateStories`). `name` is the root a file error or a receipt names a
 * path from: none (absolute) for both.
 */
export function runStateSource(
  root: string,
  story: RunStory,
  opts: { checkout?: string; archive?: () => ReadonlyMap<string, string> } = {},
): { base: string; name?: string; tree: boolean; archive?: string } {
  const checkout = opts.checkout ?? root;
  const machine = storyRunStateDir(checkout, story);
  const sha = opts.archive && !existsSync(machine) ? opts.archive().get(story.key) : undefined;
  if (sha) {
    const dir = archivedRecordDir(checkout, story.key, sha);
    if (dir) return { base: dir, tree: false, archive: basename(dir) };
  }
  return { base: machine, tree: false };
}
/** A unit's run-state folder under a source's `base` (`runStateSource`). */
export const runStateDirIn = (base: string, unit: string): string => unitDir(base, unit);
/** Where a unit's run state is written when it starts, under `base` (`startDir`): a record staged empty takes round 01 of `workflow` (gh-195/11, B25). */
export const runStateStartDirIn = (base: string, unit: string, workflow: string): string => startDir(base, unit, workflow);
/** The story's rounds under a source's `base`, ascending; [] for a flat record or a story not started. */
export const runStateRoundsIn = (base: string) => (isFlatStoryRecord(base) ? [] : storyRounds(base));
