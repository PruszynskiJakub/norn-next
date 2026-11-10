/**
 * Where norn creates a checkout's unit worktrees. Tests name a worktree only through here, so
 * moving the folder changes this file and no test.
 */
import { join } from "node:path";

/** The folder holding every unit worktree of the checkout at `root`. */
export const worktreesOf = (root: string): string => `${root}-worktrees`;

/** The unit worktree named `dirName` (`<story>-<slug>`, or `<story dir>--<nn>-<slug>` for a slice) of the checkout at `root`. */
export const worktreeOf = (root: string, dirName: string): string => join(worktreesOf(root), dirName);
