/**
 * S12 (gh-195/05): name a fixture's run-state folder from the spec folder a test already has. A unit's
 * run state is `<machine dir>/runs/<story>/<unit>` of the checkout the spec folder's root belongs to
 * (store's `runStateDir`); the story's key comes from the spec folder's name.
 */
import { basename, relative } from "node:path";
import { parseSpecDirName, SPECS_DIR, STORY_UNIT_DIR, type RunStory } from "@norn/schema";
import { runStateDir, storyRunStateDir } from "@norn/store";

/** The checkout root and the story of an absolute spec folder `<root>/.agents/specs/<id>-<slug>`. */
export function specStory(specPath: string): { root: string; story: RunStory } {
  const at = specPath.lastIndexOf(`/${SPECS_DIR}/`);
  if (at < 0) throw new Error(`not a spec folder: ${specPath}`);
  const root = specPath.slice(0, at);
  const key = parseSpecDirName(basename(specPath))?.story;
  if (!key) throw new Error(`not a spec folder: ${specPath}`);
  return { root, story: { key, spec_dir: relative(root, specPath) } };
}

/** A unit's run-state folder (the story's current round for `_story`) for the spec folder `specPath`. */
export function runStateOf(specPath: string, unit: string = STORY_UNIT_DIR): string {
  const { root, story } = specStory(specPath);
  return runStateDir(root, story, unit);
}

/** The folder holding every unit's run state of the story of `specPath`, `<machine dir>/runs/<story>`. */
export function storyRunStateOf(specPath: string): string {
  const { root, story } = specStory(specPath);
  return storyRunStateDir(root, story);
}
