/**
 * Where norn creates a checkout's unit worktrees. Tests name a worktree only through here, so
 * moving the folder changes store's `worktreesDir` and no test.
 */
import { join } from "node:path";
import { worktreesDir } from "@norn/store";

/** The folder holding every unit worktree of the checkout at `root` (its machine dir's `worktrees/`; the home must be bound). */
export const worktreesOf = (root: string): string => worktreesDir(root);

/** The unit worktree named `dirName` (`<story>-<slug>`, or `<story dir>--<nn>-<slug>` for a slice) of the checkout at `root`. */
export const worktreeOf = (root: string, dirName: string): string => join(worktreesOf(root), dirName);

