/**
 * gh-195 prefactor 1 (B2, B4): the run-state resolver. Every reader and writer of a unit's run state
 * (state.json, receipts, pinned workflow, logs, evidence) asks here for `(root, story, unit)`: `root` is
 * a checkout or worktree of the repository, `story` its key and spec folder, `unit` `_story` or
 * `<nn>-<slug>`. Today the folder is `<root>/<spec folder>/runs/<unit>` (the story's current round);
 * moving it (S12, gh-195/05) changes this module only. Nothing outside it and schema's `ids.ts` joins a
 * spec folder with `runs/` (test/repo/repo.test.ts).
 *
 * The spec-folder primitives below (`unitDir`, `startDir`, …) are the resolver's own; tests use them to
 * name a fixture's files, package sources use the `(root, story, unit)` functions.
 */
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseRoundDirName, ROUNDS_DIR, RUNS_DIR, type RunStory, roundDirName, roundRecordPath, STORY_UNIT_DIR, unitRecordPath } from "@norn/schema";

const specFolder = (root: string, story: RunStory) => join(root, story.spec_dir);

/** A unit's run-state folder in `root`: a slice's own, the story's current round (or its flat record, or round-less before it starts). */
export const runStateDir = (root: string, story: RunStory, unit: string): string => unitDir(specFolder(root, story), unit);
/** Where a unit's run state is written when it starts (`startDir`): for the story, round 01 of `workflow` when it has none yet. */
export const runStateStartDir = (root: string, story: RunStory, unit: string, workflow: string): string => startDir(specFolder(root, story), unit, workflow);
/** The folder in `root` holding every unit's run-state folder of a story (`runs/`). */
export const storyRunStateDir = (root: string, story: RunStory): string => specRunsDir(specFolder(root, story));
/** gh-71 B29, B30: the story's rounds in `root`, ascending; [] for a flat record or a story not started. */
export const runStateRounds = (root: string, story: RunStory) => storyRounds(specFolder(root, story));
/** gh-71 D7 (B34): whether the story's run state in `root` is still the flat record of an older norn. */
export const isFlatRunState = (root: string, story: RunStory): boolean => isFlatStoryRecord(specFolder(root, story));

/** A spec folder's `runs/`, the parent of every unit's record folder. */
export const specRunsDir = (specDir: string) => join(specDir, RUNS_DIR);
/**
 * The resolver for a unit's record folder (gh-71 D2, B30, B36): a slice's `<spec folder>/runs/<nn>-<slug>`;
 * the story's current round `runs/_story/rounds/NN-<wf>` when the spec folder is absolute and has one, else
 * `runs/_story` (a flat record from an older norn, read as round 1, or a story not started). A repo-relative
 * spec folder is not looked at on disk and gets `runs/<unit>`. Every reader and writer goes through here.
 */
export function unitDir(specDir: string, unit: string): string {
  const base = join(specDir, unitRecordPath(unit));
  // gh-71 D7 (B34, S5): while `runs/_story/state.json` is still flat the record is flat, even when a
  // round.migrate that stopped partway left some entries in rounds/01-<wf>/: state moves last, so the
  // next round.migrate finishes the move.
  if (unit !== STORY_UNIT_DIR || !isAbsolute(specDir) || isFlatStoryRecord(specDir)) return base;
  const round = currentRound(specDir);
  return round ? join(base, ROUNDS_DIR, roundDirName(round.n, round.workflow)) : base;
}
export const storyUnitDir = (specDir: string) => unitDir(specDir, STORY_UNIT_DIR);
/**
 * gh-71 D2 (B30): the story's current round, the highest-numbered `runs/_story/rounds/NN-<wf>/` under an
 * absolute spec folder that has its state; null = none (a flat record, read as round 1 (B36), or a story
 * not started). S5: a round folder is the record only once its state.json is written, so a round.start
 * that stopped after pinning the new round leaves the old round current and the round receipt unapplied.
 */
export function currentRound(specDir: string): { n: number; workflow: string } | null {
  const r = storyRounds(specDir).at(-1);
  return r ? { n: r.n, workflow: r.workflow } : null;
}
/**
 * gh-71 B29, B30: every round folder `runs/_story/rounds/NN-<wf>/` under an absolute spec folder that has
 * its state, ascending by number, with its absolute path; [] for a flat record (read as round 1, B36) or
 * a story not started.
 */
export function storyRounds(specDir: string): Array<{ n: number; workflow: string; path: string }> {
  const out: Array<{ n: number; workflow: string; path: string }> = [];
  const rounds = join(specDir, unitRecordPath(STORY_UNIT_DIR), ROUNDS_DIR);
  try {
    for (const d of readdirSync(rounds, { withFileTypes: true })) {
      const r = d.isDirectory() && existsSync(join(rounds, d.name, "state.json")) ? parseRoundDirName(d.name) : null;
      if (r) out.push({ ...r, path: join(rounds, d.name) });
    }
  } catch {
    /* no rounds/ */
  }
  return out.sort((a, b) => a.n - b.n);
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
