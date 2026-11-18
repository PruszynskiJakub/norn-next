/**
 * What norn may overwrite or delete, stated once as a closed set of ownership marks. Everything norn
 * writes in a worktree or removes from the machine dir is under exactly one of them, and nothing else
 * is norn's: a path no mark claims belongs to the repo or the person and is left as it is.
 *
 * - `ignoreAll`: a folder whose `.gitignore` is a plain `*` is norn's whole (the input folder, a
 *   story's spec folder), so writing anywhere under it is allowed.
 * - `skillMark`: a pack skill's folder, or the harness's skills folder, whose `.gitignore` starts with
 *   the owner mark; a link at a skill's name is norn's only when it points at norn's copy.
 * - `tickId`: a trace file named by a tick id; any other name in the trace folder is someone else's.
 * - `unitRuns`: a log keyed by a run the unit's record started.
 * - `harnessHeld`: the harness's hook files; the harness's `install` makes the check.
 * - `vcsHeld`: a unit's worktree; the vcs's `worktree.remove` makes the check.
 *
 * The runtime asks the first four before it writes or deletes and never second-guesses the last two.
 */
import type { HostFiles } from "@norn/plugin-api";

export type OwnershipMark = "ignoreAll" | "skillMark" | "tickId" | "unitRuns" | "harnessHeld" | "vcsHeld";

const IGNORE_FILE = ".gitignore";

async function readOr(files: HostFiles, path: string): Promise<string | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

/** A folder norn owns whole: its `.gitignore` is a plain `*`, so nothing in it is ever committed. */
export const ignoreAll = {
  text: "*\n",
  /** Mark `folder` as norn's; everything written under it afterwards is norn's to rewrite. */
  mark: (files: HostFiles, folder: string): Promise<void> => files.write(`${folder}/${IGNORE_FILE}`, ignoreAll.text),
};

const OWNER_MARK = "# norn: pack skills, rewritten before every launch; edit the pack, not these copies";
const marked = (text: string | null): boolean => text?.startsWith(OWNER_MARK) === true;

/** The pack skills' mark: the first line of the `.gitignore` norn writes in each folder it owns. */
export const skillMark = {
  ignoreFile: IGNORE_FILE,
  /** A skill folder's `.gitignore`. */
  folderText: `${OWNER_MARK}\n*\n`,
  /** The harness's skills folder's `.gitignore`, naming norn's links there. */
  linksText: (names: readonly string[]): string => `${OWNER_MARK}\n/${IGNORE_FILE}\n${names.map((n) => `/${n}`).join("\n")}\n`,
  /**
   * Whether norn may write the skill folder `dir`: it is empty, or its `.gitignore` carries the mark.
   * The mark is written first (see `folderText`), so a copy a crash cut short is still norn's.
   */
  async mayWriteFolder(files: HostFiles, dir: string): Promise<boolean> {
    if (marked(await readOr(files, `${dir}/${IGNORE_FILE}`))) return true;
    return (await files.list(dir)).length === 0;
  },
  /** Whether norn may write the `.gitignore` at `path`: none is there, or the one there is marked. */
  async mayWriteIgnore(files: HostFiles, path: string): Promise<boolean> {
    const current = await readOr(files, path);
    return current === null || marked(current);
  },
  /**
   * Who holds the name `<dir>/<name>` that norn links to `target`: norn when its link is there, free
   * when nothing is, and the repo when anything else is (another link, a file or a folder).
   */
  async linkHolder(files: Required<Pick<HostFiles, "readLink">> & HostFiles, dir: string, name: string, target: string): Promise<"norn" | "free" | "repo"> {
    const current = await files.readLink(`${dir}/${name}`);
    if (current === target) return "norn";
    if (current !== null || (await files.list(dir)).includes(name)) return "repo";
    return "free";
  },
};

const TRACE_NAME = /^([0-9A-HJKMNP-TV-Z]{26})\.json$/;

/** A trace file is norn's when its name is a tick id: answers that id, or null for a name that is someone else's. */
export const tickId = {
  of: (name: string): string | null => TRACE_NAME.exec(name)?.[1] ?? null,
};

/** A unit's logs are norn's when keyed by a run its record started. */
export const unitRuns = {
  /** Whether a check log or exit named `name` (`<run>-…`) belongs to one of `runs`. */
  owns: (name: string, runs: ReadonlySet<string>): boolean => [...runs].some((r) => name.startsWith(`${r}-`)),
};

/** The harness's hook files: `harness.install` decides what in them is norn's, so the runtime only delegates. */
export const harnessHeld = { heldBy: "harness.install" } as const;
