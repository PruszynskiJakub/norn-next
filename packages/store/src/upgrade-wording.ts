/**
 * The main checkout's workflow and shared files moved to the new wording, in place, for `norn upgrade`.
 * A file the translation refuses is left as written and reported; it never stops the others, so one
 * stray comment leaves one hand edit, not a stuck repo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { WORKFLOW_EXT } from "./config.ts";
import { atomicWrite, isErrno } from "./fsx.ts";
import { workflowsDir } from "./paths.ts";
import { SHARED_DIR } from "./shared-workflow.ts";
import { translateWording } from "./wording.ts";

export interface WordingRewrite {
  /** files rewritten, relative to the repo root */
  rewritten: string[];
  /** files left as written: the file (relative to the repo root), the line and why */
  refused: Array<{ file: string; line: number; message: string }>;
}

function filesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
  return names
    .filter((n) => !n.startsWith(".") && WORKFLOW_EXT.includes(extname(n)))
    .sort()
    .map((n) => join(dir, n));
}

/** Rewrite every old-wording file in `.agents/workflows/` and its shared folder under `root`; a file already in the new wording is never written. */
export function rewriteWorkflowWording(root: string): WordingRewrite {
  const out: WordingRewrite = { rewritten: [], refused: [] };
  for (const path of [...filesIn(workflowsDir(root)), ...filesIn(join(workflowsDir(root), SHARED_DIR))]) {
    const file = relative(root, path);
    const r = translateWording(readFileSync(path, "utf8"), file);
    if (!r.ok) out.refused.push({ file: r.file, line: r.line, message: r.message });
    else if (r.changed) {
      atomicWrite(path, r.text);
      out.rewritten.push(file);
    }
  }
  return out;
}
