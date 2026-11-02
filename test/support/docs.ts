/**
 * The doc set and the doc-text helpers the repo lints share (gh-162 prefactor): which files are docs,
 * and how a line's prose is told from its URLs and inline code.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
export const CODE_SPAN = /`[^`\n]*`/g;

/** Folders never walked: dependencies, git, build output, coverage and agent worktrees. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "worktrees"]);

/** Text files under `dir` (any depth) with one of the extensions; skips SKIPPED_DIRS and never follows a symlinked folder. */
export function textFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return SKIPPED_DIRS.has(e.name) ? [] : textFiles(p, exts);
    if (e.isSymbolicLink() && (!existsSync(p) || statSync(p).isDirectory())) return [];
    return exts.some((x) => p.endsWith(x)) ? [p] : [];
  });
}

/** The rules file: every id'd rule. */
export const RULES_FILE = ".agents/RULES.md";

/** Docs for people: the README, CONTRIBUTING, everything under docs/ and the Herdr plugin's README. */
export function userDocs(root: string): string[] {
  return [join(root, "README.md"), join(root, "CONTRIBUTING.md"), ...textFiles(join(root, "docs"), [".md"]), join(root, "plugins", "herdr", "README.md")];
}

/** Every doc a person or agent reads about norn: the user docs, AGENTS.md and the rules file. */
export function allDocs(root: string): string[] {
  return [...userDocs(root), join(root, "AGENTS.md"), join(root, RULES_FILE)];
}
