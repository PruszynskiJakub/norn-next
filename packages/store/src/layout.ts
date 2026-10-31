/**
 * gh-110 D4: which layout a main checkout is on, part by part. Three parts each have an old place
 * (before gh-110) and a new one (D1): the repo config, the repo workflows (a folder with at least one
 * workflow file) and the machine-local files (a non-empty folder). *both*: any part in both places;
 * *old*: not both, and some part at its old place; *new*: otherwise. Reads only; never looks at a unit
 * worktree's own files (B21) — callers pass the main checkout.
 */
import { existsSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { WORKFLOW_EXT } from "./config.ts";
import { machineDir, OLD_CONFIG_FILE, OLD_TRACE_DIR, OLD_WORKFLOWS_DIR, repoConfigPath, workflowsDir } from "./paths.ts";

export type LayoutPart = "config" | "workflows" | "machine files";

export interface LayoutPartPlaces {
  part: LayoutPart;
  /** absolute paths */
  old: string;
  new: string;
  at_old: boolean;
  at_new: boolean;
}

export interface Layout {
  layout: "new" | "old" | "both";
  parts: LayoutPartPlaces[];
}

const entries = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const hasWorkflow = (dir: string) => entries(dir).some((n) => !n.startsWith(".") && WORKFLOW_EXT.includes(extname(n)));
const nonEmpty = (dir: string) => entries(dir).length > 0;

export function repoLayout(root: string): Layout {
  const part = (name: LayoutPart, old: string, now: string, present: (p: string) => boolean): LayoutPartPlaces => ({ part: name, old, new: now, at_old: present(old), at_new: present(now) });
  const parts = [
    part("config", join(root, OLD_CONFIG_FILE), repoConfigPath(root), existsSync),
    part("workflows", join(root, OLD_WORKFLOWS_DIR), workflowsDir(root), hasWorkflow),
    part("machine files", join(root, OLD_TRACE_DIR), machineDir(root), nonEmpty),
  ];
  const layout = parts.some((p) => p.at_old && p.at_new) ? "both" : parts.some((p) => p.at_old) ? "old" : "new";
  return { layout, parts };
}

/** One line per part out of place: an old one `<old>` (old layout), both `<old> and <new>`; paths under `root` relative to it. */
export function layoutProblems(l: Layout, root: string): string[] {
  const show = (p: string) => (p.startsWith(`${root}/`) ? relative(root, p) : p);
  return l.parts.filter((p) => p.at_old).map((p) => (p.at_new ? `${p.part}: ${show(p.old)} and ${show(p.new)}` : `${p.part}: ${show(p.old)}`));
}
