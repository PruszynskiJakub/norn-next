/**
 * The PR body's links to QA evidence by its path in the story's record,
 * `evidence/<unit>/<run_id>/<file>` (`<unit>` is `_story` or `<nn>-<slug>`), rewritten to the file's
 * URL at the record commit `open-pr` just pushed. The record path of `evidence/_story/…` is the story's
 * current round (`_story/rounds/NN-<wf>/evidence/…`); a slice's is `<nn>-<slug>/evidence/…`. A link
 * to a file the record does not hold is left as written and named.
 */
import { statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunStory } from "@norn/schema";
import { runStateDir, storyRunStateDir } from "@norn/store";

/** A record link as a markdown link or image target (`](evidence/…)`) or an HTML `src="evidence/…"`. */
const RECORD_LINK = /(\]\(\s*<?|\bsrc=["'])(evidence\/[^\s)>"']+)/g;

/**
 * Rewrite every record link of `text` whose file `resolve` finds (its path in the record) to `urlOf`
 * that path; the others stay as written and are returned in `missing`, each once, in order.
 */
export async function rewriteRecordLinks(
  text: string,
  resolve: (link: string) => string | null,
  urlOf: (path: string) => Promise<string>,
): Promise<{ text: string; rewritten: string[]; missing: string[] }> {
  const urls = new Map<string, string | null>();
  for (const m of text.matchAll(RECORD_LINK)) {
    const link = m[2] as string;
    if (urls.has(link)) continue;
    const path = resolve(link);
    urls.set(link, path === null ? null : await urlOf(path));
  }
  const out = text.replace(RECORD_LINK, (all, lead: string, link: string) => {
    const url = urls.get(link);
    return url ? `${lead}${url}` : all;
  });
  const entries = [...urls];
  return { text: out, rewritten: entries.filter(([, u]) => u).map(([l]) => l), missing: entries.filter(([, u]) => !u).map(([l]) => l) };
}

/**
 * The record path of a record link, when the story's run-state folder in the machine dir holds that
 * file (what `open-pr` just packed); null otherwise. A link whose segments leave the unit's evidence
 * folder (`.`, `..`, empty) resolves to nothing.
 */
export function recordLinkResolver(root: string, story: RunStory): (link: string) => string | null {
  const base = storyRunStateDir(root, story);
  return (link) => {
    const [, unit, ...rest] = link.split("/");
    if (!unit || rest.length < 2 || [unit, ...rest].some((s) => s === "" || s === "." || s === "..")) return null;
    const unitPath = relative(base, runStateDir(root, story, unit));
    if (unitPath.startsWith("..")) return null;
    const path = [unitPath, "evidence", ...rest].join("/");
    try {
      return statSync(join(base, path)).isFile() ? path : null;
    } catch {
      return null;
    }
  };
}
